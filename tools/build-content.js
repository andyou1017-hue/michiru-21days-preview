// 受講者に見せる項目だけを content/days.yellow.json から取り出し、
// 端末だけで動く試作版（ログインなし）用の app/js/content.js を作る。
// 本番（server/）ではこのファイルを配信せず、購入者だけに /api/content で渡す。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DAY_FIELDS = ['day', 'work_id', 'title', 'intro', 'prompts', 'action', 'reflection', 'compare_with_day'];

function publicContent(src) {
  return {
    program: src.program,
    course_variant: src.course_variant,
    content_version: src.content_version,
    intro: src.intro,
    meditation: src.meditation,
    days: src.days.map((d) => {
      const out = {};
      for (const k of DAY_FIELDS) if (d[k] !== undefined) out[k] = d[k];
      return out;
    }),
    closing: src.closing,
  };
}

function readSource() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'days.yellow.json'), 'utf8'));
}

if (require.main === module) {
  const body = JSON.stringify(publicContent(readSource()), null, 2);
  const out = '// 自動生成：node tools/build-content.js（直接編集しない）\nwindow.MICHIRU_CONTENT = ' + body + ';\n';
  fs.writeFileSync(path.join(ROOT, 'app', 'js', 'content.js'), out);
  console.log('app/js/content.js を作成しました');
}

module.exports = { publicContent, readSource, DAY_FIELDS };
