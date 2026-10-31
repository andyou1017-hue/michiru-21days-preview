'use strict';
const { createGateway } = require('./gateway');
const [command, email] = process.argv.slice(2);
if (!['invite', 'revoke'].includes(command) || !email) throw Error('Usage: node runtime/manage.js invite|revoke email');
const gateway = createGateway({ databasePath: process.env.MICHIRU_DB, origin: process.env.MICHIRU_ORIGIN });
try {
  if (command === 'invite') process.stdout.write(gateway.createInvite(email) + '\n');
  else gateway.revoke(email);
} finally { gateway.server.emit('close'); }
