'use strict';
// Read UTF-8 JSON without corrupting Japanese text when a multibyte character
// arrives across network chunks. Limit is measured in received bytes.
const { StringDecoder } = require('node:string_decoder');

async function readJsonBody(req, limit = 256 * 1024) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) {
    throw Object.assign(Error(), { status: 415 });
  }
  const decoder = new StringDecoder('utf8');
  let text = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(Error(), { status: 413 });
    text += decoder.write(chunk);
  }
  text += decoder.end();
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch (_) {
    throw Object.assign(Error(), { status: 400 });
  }
}
module.exports = { readJsonBody };
