// 満ちる眼：書く時間を正確に測る共通タイマー（通常60秒・手紙180秒）
// Date.now() との差分で計測するため、非表示タブから戻っても時間が伸びない。
(function(root) {
  'use strict';
  function WritingTimer(seconds, onTick, onEnd, now) {
    if (seconds !== 60 && seconds !== 180) throw new Error('60秒または180秒を指定してください');
    this.duration = seconds * 1000;
    this.remaining = this.duration;
    this.now = now || Date.now;
    this.onTick = onTick || function(){};
    this.onEnd = onEnd || function(){};
    this.startedAt = null;
    this.running = false;
    this.ended = false;
  }
  WritingTimer.prototype.start = function() {
    if (this.ended || this.running) return;
    this.startedAt = this.now();
    this.running = true;
    this.tick();
  };
  WritingTimer.prototype.tick = function() {
    if (!this.running) return this.remaining;
    this.remaining = Math.max(0, this.remaining - Math.max(0, this.now() - this.startedAt));
    this.startedAt = this.now();
    this.onTick(Math.ceil(this.remaining / 1000), this.remaining);
    if (this.remaining === 0) {
      this.running = false;
      this.ended = true;
      this.onEnd();
    }
    return this.remaining;
  };
  WritingTimer.prototype.pause = function() {
    if (!this.running) return;
    this.tick();
    this.running = false;
  };
  WritingTimer.prototype.resume = function() { this.start(); };
  WritingTimer.prototype.reset = function() {
    this.running = false;
    this.ended = false;
    this.remaining = this.duration;
    this.startedAt = null;
    this.onTick(Math.ceil(this.remaining / 1000), this.remaining);
  };
  root.MichiruWritingTimer = WritingTimer;
})(typeof window !== 'undefined' ? window : globalThis);
