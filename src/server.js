const http = require('node:http');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const app = createApp();
const server = http.createServer(app);

server.listen(port, () => {
  console.log(`Mash running at http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    app.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
