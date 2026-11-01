'use strict';
const http = require('node:http');
const origin = new URL(process.env.MICHIRU_ORIGIN);
const req = http.get({ hostname: '127.0.0.1', port: 8341, path: '/healthz', headers: { Host: origin.host }, timeout: 4000 }, response => {
  response.resume(); response.on('end', () => { process.exitCode = response.statusCode === 200 ? 0 : 1; });
});
req.on('error', () => { process.exitCode = 1; });
req.on('timeout', () => { req.destroy(); process.exitCode = 1; });
