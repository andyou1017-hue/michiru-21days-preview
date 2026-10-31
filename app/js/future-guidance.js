// オーナー提供原稿（2026-10-31）。既存の教材・33秒誘導とは別の、未来からの手紙用の音声誘導。
(function () {
  'use strict';
  var sections = [
    { title: '① 心と身体を整える', text: ['軽く目を閉じます。', '背筋は、すっと伸ばします。', '目、口、肩の力を抜いて。', '呼吸は、自然に任せます。', '手のひらは、上に向けても、下に向けてもかまいません。'] },
    { title: '② 最高の未来へ', text: ['それでは、少し未来へ行ってみましょう。', 'あなたの夢が、すべて叶っています。', 'あなたは、どこにいますか。', 'どんな暮らしをしていますか。', 'どんな人たちに囲まれていますか。', '周りの人たちは、どんな表情をしていますか。', 'そして、あなたは今、どんな気持ちでしょう。', 'その幸せを、心いっぱいに感じてみてください。'] },
    { title: '③ 1回目の33秒', text: ['それでは、その最高の気持ちを、33秒間感じてみましょう。'], silence: 33 },
    { title: '④ 2回目の33秒', text: ['もう一度、その未来の自分になってみましょう。', '夢が叶ったあなたは、どんな表情をしていますか。', 'その喜びを、身体いっぱいに感じてください。'], silence: 33 },
    { title: '⑤ 3回目の33秒', text: ['最後にもう一度。', 'あなたはもう、夢が叶った最高の自分です。', 'その自分として、今ここにいることを感じてみましょう。'], silence: 33 },
    { title: '⑥ 未来の自分から、今の自分へ', text: ['それでは、最高の未来の自分から、今の自分を見つめてみましょう。', '今のあなたに、どんな言葉をかけてあげたいですか。', 'どんな愛を、伝えてあげたいですか。', 'その言葉を、心で受け取ってください。', 'ゆっくりと、目を開けましょう。'] },
    { title: '⑦ 書き出し', text: ['今、感じた最高の未来の気持ちを書いてみましょう。', 'そして、未来の自分から今の自分へのメッセージも、書き残してみてください。'] }
  ];
  function Player(onChange, onDone) {
    this.onChange = onChange; this.onDone = onDone;
    this.index = 0; this.state = 'idle'; this.phase = 'speech'; this.generation = 0;
    this.timer = null; this.voice = null;
  }
  Player.prototype.supported = function () { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); };
  Player.prototype.emit = function (remaining) { this.onChange({ state: this.state, phase: this.phase, index: this.index, remaining: remaining }); };
  Player.prototype.speak = function () {
    var self = this, generation = ++this.generation;
    var utterance = new window.SpeechSynthesisUtterance(sections[this.index].text.join('\n\n'));
    utterance.lang = 'ja-JP'; utterance.rate = 0.85;
    if (this.voice) utterance.voice = this.voice;
    this.phase = 'speech'; this.state = 'playing'; this.emit();
    utterance.onend = function () {
      if (self.generation !== generation || self.state !== 'playing') return;
      if (sections[self.index].silence) self.silence(); else self.next();
    };
    utterance.onerror = function () {
      if (self.generation !== generation) return;
      self.state = 'error'; self.emit();
    };
    try { window.speechSynthesis.speak(utterance); } catch (_) { this.state = 'error'; this.emit(); }
  };
  Player.prototype.silence = function () {
    var self = this;
    this.phase = 'silence';
    var timer = new window.MichiruTimer(33, function (remain) { self.emit(remain); }, function () {
      if (self.timer !== timer) return;
      self.timer = null;
      if (self.state === 'paused') { self.phase = 'pending'; self.emit(); }
      else if (self.state === 'playing') self.next();
    });
    this.timer = timer;
    this.timer.start();
  };
  Player.prototype.next = function () {
    this.index++;
    if (this.index === sections.length) { this.state = 'done'; this.emit(); this.onDone(); }
    else this.speak();
  };
  Player.prototype.start = function (voice) {
    this.stop(); this.index = 0; this.voice = voice || null;
    if (!this.supported()) { this.state = 'unsupported'; this.emit(); return; }
    this.speak();
  };
  Player.prototype.pause = function () {
    if (this.state !== 'playing') return;
    this.generation++;
    this.state = 'paused';
    if (this.timer) this.timer.pause();
    else window.speechSynthesis.cancel();
    this.emit(this.timer ? this.timer.remainingSeconds() : undefined);
  };
  Player.prototype.resume = function () {
    if (this.state !== 'paused' && this.state !== 'error') return;
    this.state = 'playing';
    if (this.phase === 'pending') this.next();
    else if (this.timer) this.timer.start(); else this.speak();
  };
  Player.prototype.stop = function () {
    this.generation++;
    if (this.timer) this.timer.dispose(); this.timer = null;
    if (this.supported()) window.speechSynthesis.cancel();
    this.state = 'idle'; this.phase = 'speech'; this.emit();
  };
  window.MichiruFutureGuidance = { sections: sections, Player: Player };
})();
