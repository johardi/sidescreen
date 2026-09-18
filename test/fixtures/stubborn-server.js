// A server shaped like sidescreen's health answer that ignores SIGTERM, so a
// test can watch `stop` give up without killing it.
import http from 'node:http';

const [port, stateDir] = process.argv.slice(2);
process.on('SIGTERM', () => {});

const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'sidescreen', version: '0.0.0', pid: process.pid, stateDir }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(Number(port), '127.0.0.1', () => {
  process.stdout.write(`listening on ${port}\n`);
});
