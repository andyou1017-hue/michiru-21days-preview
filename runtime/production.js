'use strict';
const { createGateway } = require('./gateway');
function productionOptions(env) {
  if (env.MICHIRU_RELEASE_APPROVED !== 'yes') throw Error('正式公開は未承認です。オーナーの最終承認後にのみ起動してください。');
  if (!env.MICHIRU_ORIGIN || !env.MICHIRU_DB) throw Error('HTTPSドメインと永続DBの設定が必要です。');
  if (env.RENDER && (!env.MICHIRU_DB.startsWith('/var/data/') || env.MICHIRU_PERSISTENT_DISK_CONFIRMED !== 'yes')) {
    throw Error('Renderでは永続ディスク /var/data と確認フラグが必須です。無料の一時ディスクでは起動しません。');
  }
  return { origin: env.MICHIRU_ORIGIN, databasePath: env.MICHIRU_DB };
}
if (require.main === module) {
  const { server } = createGateway(productionOptions(process.env));
  const render = Boolean(process.env.RENDER);
  const port = render ? Number(process.env.PORT) : 8341;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORTが不正です。');
  server.listen(port, render ? '0.0.0.0' : '127.0.0.1');
  function shutdown() { server.close(); }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
module.exports = { productionOptions };
