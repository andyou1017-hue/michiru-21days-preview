(function () {
  'use strict';
  function html(id, seconds) {
    return '<section class="writing-time" aria-label="書く時間"><p>' + (seconds === 180 ? '書く時間は3分間です。もう少しゆっくり書きたいときは、タイマーを一時停止してください。時間が終わっても、途中で書くのをやめる必要はありません。' : 'ワークの時間は1分です。時間が終わっても、書き続けられます。') + '</p>' +
      '<p id="' + id + '-remaining" class="t-sec" aria-live="off">' + (seconds === 180 ? '03:00' : '01:00') + '</p>' +
      '<p class="row"><button class="btn small" id="' + id + '-voice" type="button">音声案内から計る</button>' +
      '<button class="btn small" id="' + id + '-start" type="button">音声なしで計る</button>' +
      '<button class="btn small" id="' + id + '-pause" type="button" hidden>時間を一時停止</button>' +
      '<button class="btn small" id="' + id + '-resume" type="button" hidden>時間を再開</button></p>' +
      '<p id="' + id + '-status" role="status">音声案内が終わってから計測します。</p></section>';
  }
  function bind(id, seconds, narration, stopOthers) {
    var out = document.getElementById(id + '-remaining'), status = document.getElementById(id + '-status');
    var pause = document.getElementById(id + '-pause'), resume = document.getElementById(id + '-resume');
    var interval = null, reader = null, paused = false;
    function clear() { clearInterval(interval); interval = null; }
    var timer = new window.MichiruWritingTimer(seconds, function (remaining) {
      out.textContent = String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0');
    }, function () { clear(); pause.hidden = true; resume.hidden = true; status.textContent = '時間になりました。書き続けてもかまいません。記録はそのまま残ります。'; });
    function start() {
      if (timer.running || timer.ended) return;
      timer.start(); paused = false; pause.hidden = false; resume.hidden = true;
      status.textContent = '書く時間です。'; clear(); interval = setInterval(function () { timer.tick(); }, 100);
    }
    function reset() { clear(); timer.reset(); paused = false; pause.hidden = true; resume.hidden = true; }
    document.getElementById(id + '-voice').addEventListener('click', function () {
      stopOthers(); if (reader) reader.stop(); reset();
      reader = new window.MichiruFutureGuidance.Reader(narration, function (state) {
        if (state === 'done') start();
        else if (state === 'playing') { status.textContent = '音声案内中です。計測はまだ始まっていません。'; pause.hidden = false; resume.hidden = true; }
        else if (state === 'paused' || state === 'error' || state === 'unsupported') {
          status.textContent = '案内を再開するか、音声なしで計ることもできます。'; pause.hidden = true; resume.hidden = false;
        }
      });
      reader.start();
    });
    document.getElementById(id + '-start').addEventListener('click', function () { stopOthers(); if (reader) reader.stop(); reset(); start(); });
    pause.addEventListener('click', function () {
      if (reader && reader.state === 'playing') { reader.pause(); return; }
      timer.pause(); clear(); paused = !timer.ended; pause.hidden = true; resume.hidden = !paused;
      if (paused) status.textContent = '時間を一時停止しています。';
    });
    resume.addEventListener('click', function () { if (reader && (reader.state === 'paused' || reader.state === 'error')) reader.resume(); else if (paused) start(); });
    function visible() {
      if (document.visibilityState === 'hidden' && reader && reader.state === 'playing') reader.pause();
      if (document.visibilityState === 'visible' && timer.running) timer.tick();
    }
    document.addEventListener('visibilitychange', visible);
    return { start: start, reset: reset, dispose: function () { clear(); timer.pause(); if (reader) reader.stop(); document.removeEventListener('visibilitychange', visible); } };
  }
  window.MichiruWritingPanel = { html: html, bind: bind };
})();
