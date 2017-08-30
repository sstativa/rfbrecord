var rfb = require('rfb2');
var spawn = require('child_process').spawn;
var program = require('commander');
var prompt = require('co-prompt');
var moment = require('moment');
var path = require('path');

program
  .version('0.0.2')
  .option('-p, --port <port>', 'RFB port', parseInt)
  .option('-h, --host <host>', 'RFB host')
  .option('-w, --password <password>', 'password')
  .option('-d, --dest <dest>', 'destination directory')
  .option('-r, --rate <rate>', 'frame rate', parseFloat)
  .parse(process.argv);

var host = program.host || '127.0.0.1';
var port = program.port || 5901;
var rate = program.rate || 20;
var dest = path.resolve(program.dest || '.');

function getPassword(cb) {
  prompt.password('VNC password: ', '')(function (err, password) {
    cb(password);
  });
}

var r = rfb.createConnection({
  host: host,
  port: port,
  password: program.password,
  credentialsCallback: getPassword
});

r.on('connect', () => {
  // http://netpbm.sourceforge.net/doc/ppm.html
  var ppmHeader = new Buffer(['P6', `${r.width} ${r.height}`, '255\n'].join('\n'));

  var screen = new Buffer(r.width * r.height * 3);

  var filename = host.replace(/[^0-9]/g, '_') + '-' + moment().format('YYYYMMDD-HHmmss') + '-%03d.mp4';

  var out = spawn('ffmpeg', [
    '-loglevel', 'panic',
    '-f', 'image2pipe',
    '-vcodec', 'ppm',
    '-r', rate,
    '-i', '-',
    '-r', rate,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', 22,
    '-c:a', 'copy',
    '-f', 'segment',
    '-segment_atclocktime', 1,
    '-segment_time', 1800, // 30 minutes segments
    '-reset_timestamps', 1,
    path.join(dest, filename)
  ]);

  out.stdout.pipe(process.stdout);
  out.stderr.pipe(process.stderr);

  var interval = setInterval(() => {
    out.stdin.write(ppmHeader);
    out.stdin.write(screen);
  }, 1000 / rate);

  process.on('SIGINT', () => {
    clearInterval(interval);
    out.stdin.end();
    r.stream.end();
  });

  r.on('rect', rect => {
    switch (rect.encoding) {
      case rfb.encodings.raw: {
        for (let y = rect.y; y < rect.y + rect.height; y += 1) {
          for (let x = rect.x; x < rect.x + rect.width; x += 1) {
            let idx = ((r.width * y) + x) * 3;
            let bdx = ((rect.width * (y - rect.y)) + (x - rect.x)) << 2;

            screen[idx + 2] = rect.buffer[bdx];
            screen[idx + 1] = rect.buffer[bdx + 1];
            screen[idx] = rect.buffer[bdx + 2];
          }
        }

        break;
      }
      case rfb.encodings.copyRect: {
        let copyRect = new Buffer(rect.width * rect.height * 3);

        // copy rect from the screen to buf
        for (let y = rect.src.y; y < rect.src.y + rect.height; y += 1) {
          let start = ((y * r.width) + rect.src.x) * 3;
          let end = start + (rect.width * 3);

          screen.copy(copyRect, (y - rect.src.y) * rect.width * 3, start, end);
        }

        // copy buf to new position
        for (let y = rect.y; y < rect.y + rect.height; y += 1) {
          let start = (y - rect.y) * rect.width * 3;
          let end = start + (rect.width * 3);

          copyRect.copy(screen, ((y * r.width) + rect.x) * 3, start, end);
        }

        break;
      }
      default: {
        // do nothing
        break;
      }
    }
  });
});
