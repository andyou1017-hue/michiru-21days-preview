// 2026-11-01 オーナー指示：「命の瞑想」への画面誘導の差し替え。
// 正式教材の生成ファイルや原文は変更しない。招待制（API取得）・試作版の双方で適用。
(function () {
  'use strict';
  function apply(content) {
    if (!content || !content.meditation) return content;
    content.meditation.note = '命の瞑想。ゆっくり吸って、吐いて。手首にそっと指を当て、脈を感じましょう。感じられないときは呼吸に意識を向けるだけでも大丈夫です。痛みや不快感があれば中断してください。';
    content.meditation.phases = [
      { from: 0, to: 11, text: 'ゆっくり息を吸って、吐きます。もう一度、吸って、吐きましょう。' },
      { from: 11, to: 22, text: '手首に指をそっと当てて、脈を感じます。トクン、トクン。' },
      { from: 22, to: 33, text: '鼓動にだけ意識を向けましょう。あなたの中に、命が在る。' }
    ];
    return content;
  }
  window.MichiruLifeMeditation = { apply: apply };
})();
