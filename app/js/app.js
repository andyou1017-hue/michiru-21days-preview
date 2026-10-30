// 満ちる眼｜在るを生きる21日間 — 画面
// 試作版：ログインなし・端末内保存。本番：server/ が配信し、ログインと購入確認のあと記録をサーバーにも保存する。
(function () {
  'use strict';

  var C = null;          // 教材（受講者に見せる内容だけ）
  var store = null;
  var api = null;        // 本番のみ（js/api.js）
  var account = null;    // 本番のみ：{ email, access }
  var timer = null;
  var view = document.getElementById('view');
  var statusEl = document.getElementById('save-status');

  var STEPS = ['朝の気分', '33秒の静かな時間', '今日のお話と問い', '今日の行動', '夜のふりかえり'];
  var STATUS_TEXT = {
    saved: '保存しました',
    saving: '保存中…',
    memory: 'この端末に保存できません（画面を閉じると消えます）',
    offline: '端末には保存済み。通信が戻ったら送信します'
  };

  // ---------- 小さな道具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dayOf(n) { return C.days[n - 1]; }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function setTitle(t) { document.title = t ? t + '｜在るを生きる21日間' : '満ちる眼｜在るを生きる21日間'; }
  function focusHeading() {
    var h = view.querySelector('h1, h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }
  // 確認は画面の中で行う（ブラウザの確認ダイアログは端末や表示環境によって出ないことがあるため）
  function askConfirm(message, okLabel) {
    return new Promise(function (resolve) {
      var back = document.activeElement;
      var wrap = document.createElement('div');
      wrap.className = 'confirm-backdrop';
      wrap.innerHTML = '<div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">' +
        '<p id="confirm-msg">' + esc(message) + '</p>' +
        '<p class="row"><button type="button" class="btn" id="confirm-cancel">やめる</button>' +
        '<button type="button" class="btn danger" id="confirm-ok">' + esc(okLabel) + '</button></p></div>';
      document.body.appendChild(wrap);
      function done(v) {
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        if (back && back.focus) back.focus();
        resolve(v);
      }
      function onKey(ev) { if (ev.key === 'Escape') done(false); }
      document.addEventListener('keydown', onKey);
      wrap.querySelector('#confirm-cancel').addEventListener('click', function () { done(false); });
      wrap.querySelector('#confirm-ok').addEventListener('click', function () { done(true); });
      wrap.querySelector('#confirm-cancel').focus();
    });
  }
  function moodText(v) { return v === null || v === undefined ? '未記録' : String(v); }

  function showStatus(s) {
    statusEl.textContent = STATUS_TEXT[s] || '';
    statusEl.setAttribute('data-state', s);
  }

  // ---------- 画面：はじめに（S01） ----------
  function renderIntro() {
    setTitle('はじめに');
    var i = C.intro;
    var consented = !!store.state.consentedAt;
    view.innerHTML =
      '<section class="card intro">' +
      '<p class="eyebrow">満ちる眼</p>' +
      '<h1>' + esc(i.title) + '</h1>' +
      '<p class="lead">' + esc(i.lead) + '</p>' +
      '<p>' + esc(i.heart) + '</p>' +
      '<h2>毎日の進め方</h2><ol class="flow">' + i.flow.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ol>' +
      '<p class="muted">' + esc(i.time) + '</p>' +
      '<h2>大切なこと</h2><ul class="notice">' + i.notices.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' +
      '<h2>記録の扱い</h2>' + privacyHtml() +
      (consented ? '<p><a class="btn" href="#/">21日の一覧へ</a></p>' :
        '<label class="check"><input type="checkbox" id="agree"> 上の内容を読みました</label>' +
        '<button class="btn primary" id="start" disabled>はじめる</button>' +
        '<p class="muted">以前の記録のファイル（バックアップ）がある方は、<a href="#/settings">設定</a>から戻せます。</p>') +
      '</section>';
    if (!consented) {
      var agree = document.getElementById('agree');
      var start = document.getElementById('start');
      agree.addEventListener('change', function () { start.disabled = !agree.checked; });
      start.addEventListener('click', function () {
        store.setMeta(function (s) { s.consentedAt = new Date().toISOString(); });
        store.flush();
        if (api) api.consent(); // 本番：同意を記録する
        go('#/');
      });
    }
  }

  function privacyHtml() {
    if (api) {
      return '<ul class="notice"><li>記録は、あなたのアカウントにだけ保存されます。運営者があなたの書いた文章を、同意なく読んだり公開したりすることはありません。</li>' +
        '<li>記録は「設定」からファイルに保存したり、すべて削除したりできます。</li>' +
        '<li>病名や治療の内容、他の人が特定できる情報は書かないでください。</li></ul>';
    }
    return '<ul class="notice"><li>これは試作版です。記録はこの端末のブラウザの中にだけ保存され、外部には送信されません。</li>' +
      '<li>ブラウザの履歴やデータを消すと、記録も消えます。「設定」からファイルに保存（バックアップ）できます。</li>' +
      '<li>病名や治療の内容、他の人が特定できる情報など、機微な情報は入力しないでください。</li></ul>';
  }

  // ---------- 画面：21日の一覧（S02） ----------
  // 今日の扉で開く日：前回開いた日。完了していれば、その次の未完了の日（なければ最初の未完了の日）
  function doorDay() {
    var last = store.state.progress.lastOpenDay || 1;
    function open(d) { return !(store.state.entries[d] && store.state.entries[d].completed_at); }
    if (open(last)) return last;
    for (var d = last + 1; d <= 21; d++) if (open(d)) return d;
    for (d = 1; d < last; d++) if (open(d)) return d;
    return null;
  }

  function renderHome() {
    setTitle('');
    var done = store.completedDays();
    var door = doorDay();
    var cards = C.days.map(function (d) {
      var st = store.state.entries[d.day] && store.state.entries[d.day].completed_at ? 'done' : (store.hasEntry(d.day) ? 'started' : 'todo');
      var label = st === 'done' ? '✓ 完了' : (st === 'started' ? '✎ 記入あり' : '未着手');
      return '<li><a class="day-card" data-state="' + st + '" href="#/day/' + d.day + '/1">' +
        '<span class="day-no">Day ' + pad(d.day) + '</span>' +
        '<span class="day-title">' + esc(d.title) + '</span>' +
        '<span class="day-state">' + label + '</span></a></li>';
    }).join('');
    // 今日の扉（ChatGPT の試作を統合）。「前回の続き」の入口を兼ねる
    var doorHtml = door
      ? '<section class="daily-door" aria-labelledby="daily-door-title">' +
        '<p class="eyebrow">DAY ' + pad(door) + ' / 21</p>' +
        '<h2 id="daily-door-title">今日も、あなたの中に。</h2>' +
        '<p>昨日は見えなかったものが、今日は見えるかもしれません。</p>' +
        '<p class="daily-door-label">今日のテーマ：' + esc(dayOf(door).title) + '</p>' +
        '<a class="btn primary" id="door-open" href="#/day/' + door + '/1" aria-label="今日の扉をひらく（Day ' + pad(door) + '「' + esc(dayOf(door).title) + '」）">今日の扉をひらく</a>' +
        '<p class="muted">どの日からでも、あなたのペースで。</p>' +
        '</section>'
      : '<section class="daily-door" aria-labelledby="daily-door-title">' +
        '<p class="eyebrow">DAY 21 / 21</p>' +
        '<h2 id="daily-door-title">21日間を、歩き終えました。</h2>' +
        '<a class="btn primary" id="door-open" href="#/complete">21日間のおわりに</a>' +
        '<p class="muted">どの日も、いつでも開き直せます。</p>' +
        '</section>';
    view.innerHTML =
      '<section class="home">' +
      '<h1>在るを生きる21日間</h1>' +
      doorHtml +
      '<p class="progress-text">完了 <strong>' + done.length + '</strong> / 21日</p>' +
      '<div class="bar" role="progressbar" aria-label="完了した日数" aria-valuemin="0" aria-valuemax="21" aria-valuenow="' + done.length + '"><span id="bar-fill"></span></div>' +
      '<p class="muted">どの日からでも開けます。とばした日にも、あとから戻れます。</p>' +
      '<ol class="day-list">' + cards + '</ol>' +
      '</section>';
    // style属性はセキュリティ設定（CSP）で使えないため、あとから幅を設定する
    document.getElementById('bar-fill').style.width = (done.length / 21 * 100) + '%';
  }

  // ---------- 画面：1日の流れ（S03〜S07） ----------
  function stepNav(n, step) {
    var prev = step > 1 ? '<a class="btn" href="#/day/' + n + '/' + (step - 1) + '">← 戻る</a>' : '<a class="btn" href="#/">← 一覧</a>';
    var next = step < 5 ? '<a class="btn primary" href="#/day/' + n + '/' + (step + 1) + '" id="next">次へ →</a>' : '';
    return '<nav class="step-nav" aria-label="この日の移動">' + prev + next + '</nav>' +
      '<p class="pause-link"><a href="#/" id="pause">今日はここまでにする</a><span class="muted">（記録は保存されています。いつでも続きから再開できます）</span></p>';
  }

  function stepHeader(d, step) {
    var dots = STEPS.map(function (s, i) {
      var cur = i + 1 === step;
      return '<li' + (cur ? ' aria-current="step"' : '') + '><a href="#/day/' + d.day + '/' + (i + 1) + '">' +
        '<span class="dot">' + (i + 1) + '</span><span class="sr-only">' + esc(s) + '</span></a></li>';
    }).join('');
    return '<header class="day-head"><p class="eyebrow">Day ' + pad(d.day) + ' / 21</p>' +
      '<h1>' + esc(d.title) + '</h1>' +
      '<ol class="steps" aria-label="この日の流れ">' + dots + '</ol>' +
      '<p class="step-name">' + step + '. ' + esc(STEPS[step - 1]) + '</p></header>';
  }

  function moodHtml(id, label, value) {
    var has = value !== null && value !== undefined;
    return '<div class="mood" data-recorded="' + has + '">' +
      '<label for="' + id + '">' + esc(label) + '</label>' +
      '<div class="mood-row"><span aria-hidden="true">0</span>' +
      '<input type="range" id="' + id + '" min="0" max="10" step="1" value="' + (has ? value : 5) + '" aria-valuetext="' + (has ? value : '未記録') + '">' +
      '<span aria-hidden="true">10</span></div>' +
      '<p class="mood-value" aria-live="polite">いま：<output id="' + id + '-out">' + moodText(value) + '</output></p>' +
      '<button type="button" class="btn small" id="' + id + '-clear"' + (has ? '' : ' hidden') + '>記録を消す（未記録にする）</button>' +
      '<p class="muted">数字に良い・悪いはありません。記録しなくても先へ進めます。</p></div>';
  }

  function bindMood(day, id, field) {
    var input = document.getElementById(id);
    var out = document.getElementById(id + '-out');
    var clear = document.getElementById(id + '-clear');
    var box = input.closest('.mood');
    function set(v) {
      var patch = {}; patch[field] = v; store.updateEntry(day, patch);
      out.textContent = moodText(v);
      input.setAttribute('aria-valuetext', moodText(v));
      box.setAttribute('data-recorded', v !== null);
      clear.hidden = v === null;
    }
    input.addEventListener('input', function () { set(parseInt(input.value, 10)); });
    // 初期位置（5）のまま記録したい人のために、触れただけでも記録する
    input.addEventListener('pointerdown', function () { if (box.getAttribute('data-recorded') === 'false') set(parseInt(input.value, 10)); });
    input.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && box.getAttribute('data-recorded') === 'false') { ev.preventDefault(); set(parseInt(input.value, 10)); }
    });
    clear.addEventListener('click', function () { set(null); input.value = 5; });
  }

  function bindText(day, el, toPatch) {
    el.addEventListener('input', function () { store.updateEntry(day, toPatch(el.value)); });
  }

  function renderDay(n, step) {
    var d = dayOf(n);
    if (!d || step < 1 || step > 5) return go('#/');
    store.setMeta(function (s) { s.progress.lastOpenDay = n; });
    setTitle('Day ' + pad(n) + ' ' + d.title);
    var e = store.entry(n);
    var body = '';

    if (step === 1) {
      body = '<p>今日のはじまりの気分を、0〜10で眺めてみましょう。</p>' + moodHtml('mood-am', '朝の気分', e.mood_am);
    } else if (step === 2) {
      var m = C.meditation;
      body = '<div class="meditation">' +
        '<p class="muted">' + esc(m.note) + ' 目を閉じなくてもかまいません。</p>' +
        '<div class="timer" aria-live="polite"><span id="t-sec" class="t-sec">' + m.seconds + '</span><span class="t-unit">秒</span></div>' +
        '<p id="t-guide" class="t-guide">準備ができたら「はじめる」を押してください。</p>' +
        '<ol class="phases">' + m.phases.map(function (p) { return '<li>' + p.from + '〜' + p.to + '秒：' + esc(p.text) + '</li>'; }).join('') + '</ol>' +
        '<div class="timer-ctrl">' +
        '<button type="button" class="btn primary" id="t-start">はじめる</button>' +
        '<button type="button" class="btn" id="t-pause" hidden>一時停止</button>' +
        '<button type="button" class="btn" id="t-resume" hidden>再開</button>' +
        '<button type="button" class="btn" id="t-reset" hidden>最初から</button>' +
        '<a class="btn" href="#/day/' + n + '/3" id="t-skip">とばして次へ</a>' +
        '</div></div>';
    } else if (step === 3) {
      body = '<div class="story"><p>' + esc(d.intro) + '</p></div>' +
        '<p class="muted">書ける分だけで大丈夫です。空欄のままでも先へ進めます。</p>' +
        d.prompts.map(function (p, i) {
          return '<div class="field"><label for="ans-' + i + '">' + esc(p) + '</label>' +
            '<textarea id="ans-' + i + '" rows="4" maxlength="4000">' + esc(e.answers[i] || '') + '</textarea></div>';
        }).join('') +
        (d.compare_with_day ? compareInline(d.compare_with_day) : '');
    } else if (step === 4) {
      body = '<div class="story"><p class="label">今日の小さな実践</p><p>' + esc(d.action) + '</p></div>' +
        '<div class="field"><label for="act">自分の行動のメモ（任意）</label><textarea id="act" rows="3" maxlength="2000">' + esc(e.action_text) + '</textarea></div>' +
        '<fieldset class="choice"><legend>今日の行動は</legend>' +
        radio('act-st', 'done', 'できた', e.action_status) + radio('act-st', 'skipped', '今日は見送り', e.action_status) + radio('act-st', '', 'まだ決めていない', e.action_status || '') +
        '</fieldset><p class="muted">できない日があっても大丈夫です。明日に持ち越しても、見送ってもかまいません。</p>';
    } else {
      var completed = !!e.completed_at;
      body = letterReadHtml(n) + moodHtml('mood-pm', '夜の気分', e.mood_pm) +
        '<div class="field"><label for="refl">' + esc(d.reflection) + '<span class="muted">（発見を一言でも）</span></label>' +
        '<textarea id="refl" rows="4" maxlength="4000">' + esc(e.reflection) + '</textarea></div>' +
        discoveryFormHtml(n, '今日の発見から、残しておきたい一言（任意）') +
        (n === 1 ? letterWriteHtml() : '') +
        '<div class="complete-box" data-done="' + completed + '">' +
        (completed
          ? '<p class="done-mark">✓ この日は完了しています</p><p class="muted">あとから書き足すこともできます。</p>' +
            (n < 21 ? '<a class="btn primary" href="#/day/' + (n + 1) + '/1">Day ' + pad(n + 1) + 'へ</a>' : '<a class="btn primary" href="#/complete">21日間のおわりに</a>') +
            '<button type="button" class="btn small" id="undo">完了を取り消す</button>'
          : '<button type="button" class="btn primary" id="complete">この日を完了にする</button><p class="muted">気分や答えが空欄でも完了にできます。</p>') +
        '</div>';
    }

    view.innerHTML = '<article class="day">' + stepHeader(d, step) + '<div class="step-body">' + body + '</div>' + stepNav(n, step) + '</article>';

    if (step === 1) bindMood(n, 'mood-am', 'mood_am');
    if (step === 2) bindTimer(n);
    if (step === 3) {
      d.prompts.forEach(function (p, i) {
        bindText(n, document.getElementById('ans-' + i), function () {
          var arr = d.prompts.map(function (_, j) { return document.getElementById('ans-' + j).value; });
          return { answers: arr };
        });
      });
    }
    if (step === 4) {
      bindText(n, document.getElementById('act'), function (v) { return { action_text: v }; });
      Array.prototype.forEach.call(document.querySelectorAll('input[name="act-st"]'), function (r) {
        r.addEventListener('change', function () { store.updateEntry(n, { action_status: r.value || null }); });
      });
    }
    if (step === 5) {
      bindMood(n, 'mood-pm', 'mood_pm');
      bindText(n, document.getElementById('refl'), function (v) { return { reflection: v }; });
      bindDiscoveryForm(n);
      if (n === 1) bindLetterWrite();
      bindLetterRead(n);
      var c = document.getElementById('complete');
      if (c) c.addEventListener('click', function () {
        c.disabled = true; // 二重押しを防ぐ
        store.toggleComplete(n, true);
        if (n === 21) go('#/complete'); else render();
      });
      var u = document.getElementById('undo');
      if (u) u.addEventListener('click', function () { u.disabled = true; store.toggleComplete(n, false); render(); });
    }
    focusHeading();
  }

  // ---------- 私の発見（P2） ----------
  // 本人が選んだ一言だけを残す。数・連続日数・点数は出さない。
  function discoveryFormHtml(day, label) {
    var saved = store.discoveriesOf(day);
    return '<div class="discovery-form">' +
      '<label for="disc-text">' + esc(label) + '</label>' +
      '<textarea id="disc-text" rows="2" maxlength="' + window.MichiruStore.DISCOVERY_MAX + '"></textarea>' +
      '<p class="row"><button type="button" class="btn" id="disc-add">私の発見に残す</button>' +
      '<span id="disc-msg" role="status" class="muted"></span></p>' +
      (saved.length ? '<ul class="disc-mini" aria-label="この日に残した言葉">' + saved.map(function (x) { return '<li>' + nl2br(x.text) + '</li>'; }).join('') + '</ul>' : '') +
      '</div>';
  }
  function bindDiscoveryForm(day) {
    var t = document.getElementById('disc-text');
    var b = document.getElementById('disc-add');
    var msg = document.getElementById('disc-msg');
    b.addEventListener('click', function () {
      if (!t.value.trim()) { msg.textContent = '残したい言葉を書いてから押してください。'; t.focus(); return; }
      b.disabled = true; // 二重押しを防ぐ
      store.addDiscovery(day, t.value);
      t.value = '';
      msg.innerHTML = '残しました。<a href="#/discoveries">私の発見を見る</a>';
      var list = b.closest('.discovery-form').querySelector('.disc-mini');
      var items = store.discoveriesOf(day);
      if (!list) { list = document.createElement('ul'); list.className = 'disc-mini'; list.setAttribute('aria-label', 'この日に残した言葉'); b.closest('.discovery-form').appendChild(list); }
      list.innerHTML = items.map(function (x) { return '<li>' + nl2br(x.text) + '</li>'; }).join('');
      setTimeout(function () { b.disabled = false; }, 300);
    });
  }

  function renderDiscoveries() {
    setTitle('私の発見');
    var items = store.state.discoveries.slice().reverse();
    view.innerHTML = '<section class="discoveries"><h1>私の発見</h1>' +
      '<p>自分で選んだ言葉だけが、ここに残ります。</p>' +
      (items.length ? '<ul class="disc-list">' + items.map(function (x) {
        var d = new Date(x.created_at);
        return '<li><blockquote>' + nl2br(x.text) + '</blockquote>' +
          '<p class="disc-meta">' + (x.day ? '<a href="#/records/' + x.day + '">Day ' + pad(x.day) + '「' + esc(dayOf(x.day).title) + '」</a>　' : '') +
          d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + '</p>' +
          '<button type="button" class="btn small danger" data-del="' + esc(x.id) + '">この言葉を消す</button></li>';
      }).join('') + '</ul>'
        : '<p class="muted">まだありません。各日の「夜のふりかえり」や、記録の画面から、残したい一言を選べます。</p>') +
      (store.hasFutureLetter() || store.hasLegacyLetter() ? '<h2>未来からの手紙</h2><p><a href="#/letter">未来のあなたからの手紙を開く</a></p>' : '') +
      '</section>';
    Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        askConfirm('この言葉を「私の発見」から消します。元に戻せません。', '消す').then(function (ok) {
          if (ok) { store.deleteDiscovery(b.getAttribute('data-del')); renderDiscoveries(); }
        });
      });
    });
    focusHeading();
  }

  // ---------- 未来からの手紙（P3） ----------
  // 未来の自分になったつもりで、今の自分に宛てて書く手紙（オーナー訂正 2026-10-31）。
  // 書く日（Day 01）・読み返す日（Day 07・14・21）・案内の文言は暫定。docs/future-letter-design-v0.1.md
  function letterWriteHtml() {
    var l = store.state.futureLetter;
    return '<details class="letter-box"' + (l && l.text ? ' open' : '') + '><summary>未来からの手紙（任意）</summary>' +
      '<p class="letter-lead">未来のあなたは、今のあなたに何を伝えたいでしょう。</p>' +
      '<p class="muted">21日を歩いた先のあなたになったつもりで、今日のあなたへ書いてみましょう。書かなくてもかまいません。' +
      'この手紙は、Day 07・14・21 に、読みたいときだけ読み返せます。</p>' +
      '<label for="letter-text" class="sr-only">未来のあなたから、今のあなたへ</label>' +
      '<textarea id="letter-text" rows="5" maxlength="4000" placeholder="今のあなたへ。">' + esc(l ? l.text : '') + '</textarea></details>';
  }
  function bindLetterWrite() {
    var t = document.getElementById('letter-text');
    t.addEventListener('input', function () { store.setFutureLetter(t.value); });
  }

  // Day 7・14・21：本人が「読む」を選んだときだけ表示する
  function letterReadHtml(day) {
    if (window.MichiruStore.LETTER_DAYS.indexOf(day) < 0 || !store.hasFutureLetter()) return '';
    var skipped = !!store.state.futureSkipped[day];
    return '<section class="letter-read" aria-labelledby="letter-read-title" id="letter-read">' +
      '<h2 id="letter-read-title">未来のあなたから、手紙が届いています</h2>' +
      (skipped ? '<p class="muted">今は読まないことにしました。読みたくなったら、いつでも開けます。</p>' : '<p class="muted">読むかどうかは、あなたが選べます。</p>') +
      '<p class="row"><button type="button" class="btn" id="letter-open">手紙を読む</button>' +
      (skipped ? '' : '<button type="button" class="btn" id="letter-skip">今は読まない</button>') + '</p>' +
      '<div id="letter-body" hidden></div></section>';
  }
  function writtenOn(l) {
    var wd = l.written_at ? new Date(l.written_at) : null;
    return wd ? wd.getFullYear() + '/' + (wd.getMonth() + 1) + '/' + wd.getDate() : '';
  }
  function letterBodyHtml(day) {
    var l = store.state.futureLetter;
    var r = store.state.futureReplies[day];
    return '<blockquote class="letter-quote">' + nl2br(l.text) + '</blockquote>' +
      '<p class="disc-meta">' + (writtenOn(l) ? writtenOn(l) + '、' : '') + '未来のあなたになって書いた手紙</p>' +
      '<div class="field"><label for="letter-reply">手紙を受け取った今のあなたから、ひとこと（任意）</label>' +
      '<textarea id="letter-reply" rows="3" maxlength="4000">' + esc(r ? r.text : '') + '</textarea></div>' +
      '<p><button type="button" class="btn small" id="letter-close">手紙を閉じる</button></p>';
  }
  function bindLetterRead(day) {
    var open = document.getElementById('letter-open');
    if (!open) return;
    var body = document.getElementById('letter-body');
    var skip = document.getElementById('letter-skip');
    open.addEventListener('click', function () {
      store.setFutureSkipped(day, false);
      body.innerHTML = letterBodyHtml(day);
      body.hidden = false;
      open.hidden = true;
      if (skip) skip.hidden = true;
      var reply = document.getElementById('letter-reply');
      reply.addEventListener('input', function () { store.setFutureReply(day, reply.value); });
      document.getElementById('letter-close').addEventListener('click', function () {
        body.hidden = true; body.innerHTML = ''; open.hidden = false; open.focus();
      });
      body.querySelector('.letter-quote').setAttribute('tabindex', '-1');
      body.querySelector('.letter-quote').focus();
    });
    if (skip) skip.addEventListener('click', function () {
      store.setFutureSkipped(day, true);
      var sec = document.getElementById('letter-read');
      sec.outerHTML = letterReadHtml(day);
      bindLetterRead(day);
      document.getElementById('letter-open').focus();
    });
  }

  function legacyLetterHtml() {
    if (!store.hasLegacyLetter()) return '';
    var l = store.state.letter;
    var replies = window.MichiruStore.LETTER_DAYS.filter(function (d) { return store.state.letterReplies[d] && store.state.letterReplies[d].text; });
    return '<details class="letter-box legacy"><summary>以前の形式で書いた手紙（21日後の自分へ）</summary>' +
      '<p class="muted">試作の途中で書いた、今の自分から未来の自分への手紙です。消さずに残しています。</p>' +
      '<blockquote class="letter-quote">' + nl2br(l.text) + '</blockquote>' +
      (replies.length ? '<dl class="record">' + replies.map(function (d) {
        return '<dt>Day ' + pad(d) + '</dt><dd>' + nl2br(store.state.letterReplies[d].text) + '</dd>';
      }).join('') + '</dl>' : '') + '</details>';
  }

  function renderLetter() {
    setTitle('未来からの手紙');
    if (!store.hasFutureLetter()) {
      view.innerHTML = '<section class="letter-page"><h1>未来からの手紙</h1><p class="muted">手紙はまだありません。Day 01 の「夜のふりかえり」で、書きたいときに書けます。</p>' +
        '<p><a href="#/day/1/5">Day 01 の夜のふりかえりへ</a></p>' + legacyLetterHtml() + '</section>';
      return focusHeading();
    }
    var l = store.state.futureLetter;
    var replies = window.MichiruStore.LETTER_DAYS.filter(function (d) { return store.state.futureReplies[d] && store.state.futureReplies[d].text; });
    view.innerHTML = '<section class="letter-page"><h1>未来からの手紙</h1>' +
      '<p class="muted">' + (writtenOn(l) ? writtenOn(l) + '、' : '') + '未来のあなたになって、今のあなたへ書いた手紙</p>' +
      '<blockquote class="letter-quote">' + nl2br(l.text) + '</blockquote>' +
      (replies.length ? '<h2>手紙を受け取った、今のあなたから</h2><dl class="record">' + replies.map(function (d) {
        return '<dt>Day ' + pad(d) + '</dt><dd>' + nl2br(store.state.futureReplies[d].text) + '</dd>';
      }).join('') + '</dl>' : '') +
      '<p class="row"><a class="btn" href="#/day/1/5">手紙を書き直す（Day 01）</a><a class="btn" href="#/discoveries">← 私の発見</a></p>' +
      legacyLetterHtml() + '</section>';
    focusHeading();
  }

  function radio(name, value, label, current) {
    var id = name + '-' + (value || 'none');
    return '<label class="radio" for="' + id + '"><input type="radio" name="' + name + '" id="' + id + '" value="' + value + '"' + (current === value ? ' checked' : '') + '> ' + esc(label) + '</label>';
  }

  function compareInline(otherDay) {
    var od = dayOf(otherDay);
    var oe = store.entry(otherDay);
    var items = od.prompts.map(function (p, i) {
      return '<dt>' + esc(p) + '</dt><dd>' + (oe.answers[i] ? nl2br(oe.answers[i]) : '<span class="muted">（記入なし）</span>') + '</dd>';
    }).join('');
    return '<details class="compare-inline"><summary>Day ' + pad(otherDay) + '「' + esc(od.title) + '」の記録を見る</summary><dl>' + items + '</dl>' +
      '<p><a href="#/compare">2つの日を並べて見る</a></p></details>';
  }

  function bindTimer(n) {
    var m = C.meditation;
    var sec = document.getElementById('t-sec');
    var guide = document.getElementById('t-guide');
    var bStart = document.getElementById('t-start'), bPause = document.getElementById('t-pause'),
      bResume = document.getElementById('t-resume'), bReset = document.getElementById('t-reset'), bSkip = document.getElementById('t-skip');
    function phaseText(ms) {
      var s = ms / 1000;
      for (var i = 0; i < m.phases.length; i++) if (s < m.phases[i].to) return m.phases[i].text;
      return m.phases[m.phases.length - 1].text;
    }
    function show() {
      var st = timer.state;
      bStart.hidden = st !== 'idle';
      bPause.hidden = st !== 'running';
      bResume.hidden = st !== 'paused';
      bReset.hidden = st === 'idle';
      bSkip.textContent = st === 'done' ? '次へ →' : 'とばして次へ';
      bSkip.classList.toggle('primary', st === 'done');
    }
    timer = new window.MichiruTimer(m.seconds, function (remain, ms) {
      sec.textContent = remain;
      if (timer.state === 'paused') guide.textContent = '一時停止中です。再開できます。';
      else if (timer.state !== 'idle') guide.textContent = phaseText(ms);
    }, function () {
      guide.textContent = '33秒が終わりました。おつかれさまでした。';
      show();
    });
    bStart.addEventListener('click', function () { timer.start(); show(); });
    bPause.addEventListener('click', function () { timer.pause(); show(); });
    bResume.addEventListener('click', function () { timer.start(); show(); });
    bReset.addEventListener('click', function () { timer.reset(); guide.textContent = '準備ができたら「はじめる」を押してください。'; show(); });
    show();
  }

  // ---------- 画面：記録（S08） ----------
  function entrySummary(n) {
    var d = dayOf(n), e = store.entry(n);
    var ans = d.prompts.map(function (p, i) {
      return '<dt>' + esc(p) + '</dt><dd>' + (e.answers[i] ? nl2br(e.answers[i]) : '<span class="muted">（記入なし）</span>') + '</dd>';
    }).join('');
    var act = e.action_status === 'done' ? 'できた' : (e.action_status === 'skipped' ? '見送り' : '未選択');
    return '<dl class="record">' +
      '<dt>朝の気分</dt><dd>' + moodText(e.mood_am) + '</dd>' + ans +
      '<dt>今日の行動</dt><dd>' + act + (e.action_text ? '<br>' + nl2br(e.action_text) : '') + '</dd>' +
      '<dt>夜の気分</dt><dd>' + moodText(e.mood_pm) + '</dd>' +
      '<dt>' + esc(d.reflection) + '</dt><dd>' + (e.reflection ? nl2br(e.reflection) : '<span class="muted">（記入なし）</span>') + '</dd>' +
      '<dt>状態</dt><dd>' + (e.completed_at ? '✓ 完了' : '未完了') + '</dd></dl>';
  }

  function renderRecords() {
    setTitle('記録');
    var days = [];
    for (var n = 1; n <= 21; n++) if (store.hasEntry(n)) days.push(n);
    view.innerHTML = '<section class="records"><h1>これまでの記録</h1>' +
      '<p class="muted">記録はあなただけが見るためのものです。</p>' +
      '<p class="row"><a class="btn" href="#/compare">Day 05 と Day 20 を並べて見る</a><a class="btn" href="#/discoveries">私の発見</a>' +
      (store.hasFutureLetter() || store.hasLegacyLetter() ? '<a class="btn" href="#/letter">未来からの手紙</a>' : '') + '</p>' +
      (days.length ? '<ul class="record-list">' + days.map(function (n) {
        return '<li><a href="#/records/' + n + '">Day ' + pad(n) + '「' + esc(dayOf(n).title) + '」' + (store.entry(n).completed_at ? ' ✓ 完了' : '') + '</a></li>';
      }).join('') + '</ul>' : '<p>まだ記録はありません。</p>') +
      '<p><a href="#/settings">バックアップ・すべての記録の削除は「設定」へ</a></p></section>';
  }

  function renderRecord(n) {
    var d = dayOf(n);
    if (!d) return go('#/records');
    setTitle('Day ' + pad(n) + 'の記録');
    var e = store.entry(n);
    var picks = d.prompts.map(function (p, i) { return e.answers[i] && e.answers[i].trim() ? e.answers[i] : null; }).concat([e.reflection && e.reflection.trim() ? e.reflection : null]);
    var pickBtns = picks.map(function (t, i) {
      return t ? '<button type="button" class="btn small" data-pick="' + i + '">' + (i < d.prompts.length ? '問い' + (i + 1) + 'の答え' : 'ふりかえり') + 'を写す</button>' : '';
    }).join('');
    view.innerHTML = '<section class="records"><p class="eyebrow">Day ' + pad(n) + '</p><h1>' + esc(d.title) + 'の記録</h1>' + entrySummary(n) +
      (pickBtns ? '<p class="muted">書いた言葉を写して、残したい部分だけに整えてから「私の発見」に残せます。</p><p class="row">' + pickBtns + '</p>' : '') +
      discoveryFormHtml(n, 'この日の言葉から、残しておきたい一言') +
      '<p class="row"><a class="btn primary" href="#/day/' + n + '/3">書き足す・直す</a>' +
      '<button type="button" class="btn danger" id="del-day">この日の記録を削除</button></p>' +
      '<p><a href="#/records">← 記録の一覧</a></p></section>';
    bindDiscoveryForm(n);
    Array.prototype.forEach.call(view.querySelectorAll('[data-pick]'), function (b) {
      b.addEventListener('click', function () {
        var t = document.getElementById('disc-text');
        t.value = picks[Number(b.getAttribute('data-pick'))].slice(0, window.MichiruStore.DISCOVERY_MAX);
        t.focus();
      });
    });
    document.getElementById('del-day').addEventListener('click', function () {
      askConfirm('Day ' + pad(n) + ' の記録を削除します。元に戻せません。（「私の発見」に残した言葉は消えません）', '削除する').then(function (ok) {
        if (!ok) return;
        store.deleteDay(n);
        go('#/records');
      });
    });
    focusHeading();
  }

  function renderCompare() {
    setTitle('Day 05 と Day 20');
    var a = 5, b = 20;
    function col(n) {
      var d = dayOf(n), e = store.entry(n);
      return '<div class="cmp-col"><h2>Day ' + pad(n) + '「' + esc(d.title) + '」</h2><dl>' +
        d.prompts.map(function (p, i) {
          return '<dt>' + esc(p) + '</dt><dd>' + (e.answers[i] ? nl2br(e.answers[i]) : '<span class="muted">（記入なし）</span>') + '</dd>';
        }).join('') +
        '<dt>' + esc(d.reflection) + '</dt><dd>' + (e.reflection ? nl2br(e.reflection) : '<span class="muted">（記入なし）</span>') + '</dd>' +
        '</dl></div>';
    }
    view.innerHTML = '<section class="compare"><h1>同じワーク、二つの日</h1>' +
      '<p>Day 05 と Day 20 は、同じ「人の美点発見」のワークです（ワーク番号 ' + esc(dayOf(a).work_id) + '）。比べるのは点数ではなく、自分の見つめ方です。</p>' +
      '<div class="cmp">' + col(a) + col(b) + '</div>' +
      '<p class="row"><a class="btn" href="#/day/20/3">Day 20 を開く</a><a class="btn" href="#/records">← 記録</a></p></section>';
    focusHeading();
  }

  // ---------- 画面：21日間のおわりに（S09） ----------
  function renderComplete() {
    setTitle('21日間のおわりに');
    var c = C.closing;
    var consultUrl = window.MICHIRU_CONFIG && window.MICHIRU_CONFIG.consultUrl;
    view.innerHTML = '<section class="card closing"><h1>' + esc(c.title) + '</h1>' +
      '<p class="lead">' + esc(c.text) + '</p>' +
      '<p>完了した日：' + store.completedDays().length + ' / 21日（完了していない日があっても、この21日間はここで完結しています）</p>' +
      '<details class="optional"><summary>このあとの学びについて（読まなくてもかまいません）</summary>' +
      '<p>' + esc(c.next_optional) + '</p><p>' + esc(c.consult_optional) + '</p>' +
      (consultUrl ? '<p><a class="btn" href="' + esc(consultUrl) + '" rel="noopener" target="_blank">面談を希望する</a></p>'
        : '<p class="muted">面談の申込み先は準備中です。</p>') +
      '</details>' +
      '<p class="row"><a class="btn primary" href="#/records">記録を見返す</a><a class="btn" href="#/">一覧へ戻る</a></p></section>';
    focusHeading();
  }

  // ---------- 画面：設定（S10） ----------
  function renderSettings() {
    setTitle('設定');
    var fs = store.state.settings.fontSize;
    function fsBtn(v, label) { return '<button type="button" class="btn small" data-fs="' + v + '" aria-pressed="' + (fs === v) + '">' + label + '</button>'; }
    view.innerHTML = '<section class="settings"><h1>設定</h1>' +
      '<h2>文字の大きさ</h2><p class="row">' + fsBtn('s', '小') + fsBtn('m', '標準') + fsBtn('l', '大') + fsBtn('xl', '特大') + '</p>' +
      '<h2>バックアップ</h2><p class="muted">記録をファイルにして保存できます。機種変更のときや、念のための保管に使ってください。ファイルには書いた文章が入っています。取り扱いに気をつけてください。</p>' +
      '<p class="row"><button type="button" class="btn" id="export">記録をファイルに保存</button>' +
      '<label class="btn" for="import-file">ファイルから記録を戻す</label><input type="file" id="import-file" accept="application/json,.json" class="sr-only"></p>' +
      '<p id="import-msg" role="status"></p>' +
      '<h2>記録の削除</h2><p><button type="button" class="btn danger" id="delete-all">すべての記録を削除</button></p>' +
      '<h2>記録の扱い</h2>' + privacyHtml() +
      accountHtml() +
      '<h2>ヘルプ</h2><ul class="notice"><li>どの日からでも始められます。とばした日には、あとから戻れます。</li>' +
      '<li>「完了」は、あとから取り消したり書き足したりできます。</li>' +
      '<li>つらくなったときは、その日のワークを中断してかまいません。強いつらさが続くときは、医療機関や公的な相談窓口に相談してください。</li></ul>' +
      '<p><a href="#/intro">はじめにの説明をもう一度読む</a></p></section>';

    Array.prototype.forEach.call(view.querySelectorAll('[data-fs]'), function (b) {
      b.addEventListener('click', function () {
        store.setMeta(function (s) { s.settings.fontSize = b.getAttribute('data-fs'); });
        applyFont(); renderSettings();
      });
    });
    document.getElementById('export').addEventListener('click', function () {
      var data = JSON.stringify(store.exportBackup(), null, 2);
      var blob = new Blob([data], { type: 'application/json' });
      var a = document.createElement('a');
      var d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = 'michiru-21days-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    document.getElementById('import-file').addEventListener('change', function (ev) {
      var f = ev.target.files[0];
      var msg = document.getElementById('import-msg');
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { msg.textContent = 'ファイルが大きすぎます。'; return; }
      var r = new FileReader();
      r.onload = function () {
        try {
          var raw = JSON.parse(r.result);
          window.MichiruStore.normalizeState(raw);
          askConfirm('いまの記録を、ファイルの内容で置き換えます。', '置き換える').then(function (ok) {
            if (!ok) { msg.textContent = '取り消しました。'; return; }
            store.importBackup(raw);
            applyFont();
            msg.textContent = '記録を戻しました。';
          });
        } catch (e) {
          msg.textContent = '読み込めませんでした：' + (e.message || 'ファイルの形式が違います。');
        }
        ev.target.value = '';
      };
      r.readAsText(f);
    });
    document.getElementById('delete-all').addEventListener('click', function () {
      askConfirm('すべての記録を削除します。元に戻せません。', 'すべて削除する').then(function (ok) {
        if (ok) store.deleteAll().then(function () { go('#/intro'); });
      });
    });
    bindAccount();
    focusHeading();
  }

  function accountHtml() {
    if (!api || !account) return '';
    return '<h2>アカウント</h2><p>' + esc(account.email) + ' でログインしています。</p>' +
      '<p class="row"><button type="button" class="btn" id="logout">ログアウト</button>' +
      '<button type="button" class="btn danger" id="delete-account">アカウントを削除</button></p>';
  }
  function bindAccount() {
    if (!api || !account) return;
    document.getElementById('logout').addEventListener('click', function () {
      store.flush();
      api.logout().then(function () { store.detach(); location.reload(); });
    });
    document.getElementById('delete-account').addEventListener('click', function () {
      askConfirm('アカウントと、サーバーに保存したすべての記録を削除します。元に戻せません。', 'アカウントを削除する').then(function (ok) {
        if (ok) api.deleteAccount().then(function () { store.detach(); location.reload(); });
      });
    });
  }

  function applyFont() {
    document.documentElement.setAttribute('data-font', store.state.settings.fontSize || 'm');
  }

  // ---------- 振り分け ----------
  function render() {
    if (timer) { timer.dispose(); timer = null; }
    store.flush();
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('/').filter(Boolean);
    updateNav(parts[0] || '');
    // 設定（バックアップから戻す）は、はじめの確認の前でも開ける（機種変更のとき）
    if (!store.state.consentedAt && parts[0] !== 'intro' && parts[0] !== 'settings') return renderIntro();
    if (parts[0] === 'intro') return renderIntro();
    if (parts[0] === 'day') return renderDay(parseInt(parts[1], 10), parseInt(parts[2] || '1', 10));
    if (parts[0] === 'records' && parts[1]) return renderRecord(parseInt(parts[1], 10));
    if (parts[0] === 'records') return renderRecords();
    if (parts[0] === 'compare') return renderCompare();
    if (parts[0] === 'discoveries') return renderDiscoveries();
    if (parts[0] === 'letter') return renderLetter();
    if (parts[0] === 'complete') return renderComplete();
    if (parts[0] === 'settings') return renderSettings();
    renderHome();
  }

  function updateNav(section) {
    Array.prototype.forEach.call(document.querySelectorAll('.app-nav a'), function (a) {
      var target = a.getAttribute('data-section');
      if (section === 'letter') section = 'discoveries';
      if (target === section || (target === '' && (section === '' || section === 'day'))) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function start(content, opts) {
    C = content;
    store = new window.MichiruStore.Store(opts);
    store.onStatus(showStatus);
    applyFont();
    window.addEventListener('hashchange', render);
    // 画面を閉じる・裏に回るときは、待たずに保存する
    window.addEventListener('pagehide', function () { store.flush(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') store.flush(); });
    render();
    return store;
  }

  // ---------- 起動 ----------
  function boot() {
    // 本番：server/ が window.MICHIRU_CONFIG.server = true を渡す
    if (window.MICHIRU_CONFIG && window.MICHIRU_CONFIG.server && window.MichiruApi) {
      api = window.MichiruApi;
      api.boot(view).then(function (res) {
        if (!res) return; // ログイン画面・購入案内を表示中
        account = res.account;
        var s = start(res.content, { key: 'michiru21.u.' + res.account.id, remote: api.remote() });
        s.mergeRemote(res.entries);
      });
      return;
    }
    if (!window.MICHIRU_CONTENT) { view.textContent = '教材を読み込めませんでした。'; return; }
    start(window.MICHIRU_CONTENT, {});
  }

  window.MichiruApp = { boot: boot };
  boot();
})();
