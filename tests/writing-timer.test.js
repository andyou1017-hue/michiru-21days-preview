'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../app/js/writing-timer.js'),'utf8'),ctx);
const Timer = ctx.window.MichiruWritingTimer;
test('通常ワーク60秒：停止中は進まず、再開後に終了は一度だけ', () => {
 let now=0, ended=0, ticks=[];
 const t=new Timer(60,(s)=>ticks.push(s),()=>ended++,()=>now);
 t.start(); now=12000; t.tick(); assert.equal(t.remaining,48000);
 t.pause(); now=92000; t.resume(); now=140000; t.tick();
 assert.equal(t.remaining,0); assert.equal(ended,1); t.tick(); assert.equal(ended,1);
});
test('手紙180秒：画面復帰時も実経過時間で計算', () => {
 let now=0, ended=0;
 const t=new Timer(180,()=>{},()=>ended++,()=>now);
 t.start(); now=179100; t.tick(); assert.equal(t.remaining,900);
 now=180000; t.tick(); assert.equal(ended,1);
 t.reset(); assert.equal(t.remaining,180000); assert.equal(t.ended,false);
});
test('規定外の時間を拒否',()=>assert.throws(()=>new Timer(10)));
