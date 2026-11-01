'use strict';
const { createGateway } = require('./gateway');
function productionOptions(env) {
  if (env.MICHIRU_RELEASE_APPROVED !== 'yes') throw Error('正式公開は未承認です。オーナーの最終承認後にのみ起動してください。');
  if (!env.MICHIRU_ORIGIN || !env.MICHIRU_DB) throw Error('HTTPSドメインと永続DBの設定が必要です。');
  return { origin: env.MICHIRU_ORIGIN, databasePath: env.MICHIRU_DB };
}
if (require.main === module) {
  const { server } = createGateway(productionOptions(process.env));
  server.listen(8341, '127.0.0.1');
  function shutdown() { server.close(); }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
module.exports = { productionOptions };
