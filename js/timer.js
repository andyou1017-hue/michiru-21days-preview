// 33秒の静かな時間のタイマー。経過時間は時刻の差で数えるため、
// 画面の切り替えや端末のスリープで表示が止まっても、ずれない。
(function () {
  'use strict';

  function Timer(seconds, onTick, onDone) {
    this.total = seconds * 1000;
    this.onTick = onTick;
    this.onDone = onDone;
    this.state = 'idle'; // idle | running | paused | done
    this.elapsedBefore = 0;
    this.startedAt = 0;
    this.interval = null;
  }

  Timer.prototype.elapsed = function () {
    if (this.state === 'running') return this.elapsedBefore + (Date.now() - this.startedAt);
    return this.elapsedBefore;
  };

  Timer.prototype.remainingSeconds = function () {
    return Math.max(0, Math.ceil((this.total - this.elapsed()) / 1000));
  };

  Timer.prototype.tick = function () {
    var e = this.elapsed();
    if (e >= this.total) {
      this.elapsedBefore = this.total;
      this.stopInterval();
      this.state = 'done';
      this.onTick(0, this.total);
      this.onDone();
      return;
    }
    this.onTick(this.remainingSeconds(), e);
  };

  Timer.prototype.start = function () {
    if (this.state === 'running' || this.state === 'done') return;
    var self = this;
    this.startedAt = Date.now();
    this.state = 'running';
    this.interval = setInterval(function () { self.tick(); }, 200);
    this.tick();
  };

  Timer.prototype.pause = function () {
    if (this.state !== 'running') return;
    this.elapsedBefore += Date.now() - this.startedAt;
    this.stopInterval();
    this.state = 'paused';
    this.tick();
  };

  Timer.prototype.reset = function () {
    this.stopInterval();
    this.state = 'idle';
    this.elapsedBefore = 0;
    this.onTick(this.remainingSeconds(), 0);
  };

  Timer.prototype.stopInterval = function () {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  };

  Timer.prototype.dispose = function () { this.stopInterval(); };

  window.MichiruTimer = Timer;
})();
