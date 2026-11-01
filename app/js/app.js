// 満ちる眼｜在るを生きる21日間 — 画面
// 試作版：ログインなし・端末内保存。本番：server/ が配信し、ログインと購入確認のあと記録をサーバーにも保存する。
(function () {
  'use strict';

  var C = null;          // 教材（受講者に見せる内容だけ）
  var store = null;
  var api = null;        // 本番のみ（js/api.js）
  var account = null;    // 本番のみ：{ email, access }
  var timer = null;
  var guidancePlayer = null;
  var guidanceCleanup = null;
  var lessonReader = null;
  var readerCleanup = null;
  var view = document.getElementById('view');
  var statusEl = document.getElementById('save-status');

  var STEPS = ['朝の気分', '33秒の静かな時間', '今日のお話と問い', '今日の行動', '夜のふりかえり'];
  var STATUS_TEXT = {
    saved: '保存しました',
    saving: '保存中…',
    memory: 'この端末に保存できません（画面を閉じると消えます）',
    recovery: '記録を読み取れません。元データを保護しています',
    error: '保存できませんでした。画面を閉じる前に「設定」からファイルに保存してください',
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
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); done(false); return; }
        if (ev.key !== 'Tab') return;
        var first = wrap.querySelector('#confirm-cancel');
        var last = wrap.querySelector('#confirm-ok');
        if (ev.shiftKey && (document.activeElement === first || !wrap.contains(document.activeElement))) {
          ev.preventDefault(); last.focus();
        } else if (!ev.shiftKey && (document.activeElement === last || !wrap.contains(document.activeElement))) {
          ev.preventDefault(); first.focus();
        }
      }
      document.addEventListener('keydown', onKey);
      wrap.querySelector('#confirm-cancel').addEventListener('click', function () { done(false); });
      wrap.querySelector('#confirm-ok').addEventListener('click', function () { done(true); });
      wrap.querySelector('#confirm-cancel').focus();
    });
  }
  function moodText(v) { return v === null || v === undefined ? '未記録' : String(v); }

  function pauseNote(st) {
    return st === 'error' || st === 'memory' || st === 'recovery' ? '（いまは端末に保存できていません。右上の表示をご確認ください）'
      : '（ここまでの記録は、この端末に保存されます。いつでも続きから再開できます）';
  }
  function showStatus(s) {
    statusEl.textContent = STATUS_TEXT[s] || '';
    statusEl.setAttribute('data-state', s);
    var note = document.getElementById('pause-note');
    if (note && s !== 'saving') note.textContent = pauseNote(s);
  }

  // ---------- 画面：はじめに（S01） ----------
  function renderIntro() {
    setTitle('はじめに');
    var i = C.intro;
    var consented = !!store.state.consentedAt;
    view.innerHTML =
      '<section class="card intro">' +
      '<p class="eyebrow">満ちる眼</p>' +
      '<div class="intro-flower">' + flower(1, 132) + '</div>' +
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
    if (api && !(window.MICHIRU_CONFIG && window.MICHIRU_CONFIG.localOnly)) {
      return '<ul class="notice"><li>記録は、あなたのアカウントにだけ保存されます。運営者があなたの書いた文章を、同意なく読んだり公開したりすることはありません。</li>' +
        '<li>記録は「設定」からファイルに保存したり、すべて削除したりできます。</li>' +
        '<li>病名や治療の内容、他の人が特定できる情報は書かないでください。</li></ul>';
    }
    return '<ul class="notice"><li>' + (api ? '記録はログインした利用者ごとに、この端末のブラウザの中だけに保存されます。自動同期はありません。ログアウトしても記録は残り、同じアカウントで再開できます。' : 'これは試作版です。記録はこの端末のブラウザの中にだけ保存され、外部には送信されません。') + '</li>' +
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
        '<span class="day-state">' + label + '</span>' +
        '<span class="card-flower">' + flower(d.day, 40) + '</span></a></li>';
    }).join('');
    // 今日の扉（ChatGPT の試作を統合）。「前回の続き」の入口を兼ねる
    var doorHtml = door
      ? '<section class="daily-door" aria-labelledby="daily-door-title">' +
        '<p class="eyebrow">DAY ' + pad(door) + ' / 21</p>' +
        '<div class="door-flower">' + flower(door, 132) + '<p class="flower-name">今日の花：' + esc(flowerName(door)) + '</p></div>' +
        '<h2 id="daily-door-title">今日も、あなたの中に。</h2>' +
        (door === 1 && done.length === 0
          ? '<p>ここから、あなたの21日間が始まります。</p>'
          : '<p>昨日は見えなかったものが、今日は見えるかもしれません。</p>') +
        '<p class="daily-door-label">今日のテーマ：' + esc(dayOf(door).title) + '</p>' +
        '<a class="btn primary" id="door-open" href="#/day/' + door + '/1" aria-label="今日の扉をひらく（Day ' + pad(door) + '「' + esc(dayOf(door).title) + '」）">今日の扉をひらく</a>' +
        '<p class="door-time">目安 10〜15分。できるところまでで大丈夫です。</p>' +
        doorGuideHtml(door) +
        '<p class="door-action"><strong>今日の小さな実践</strong><br>' + esc(dayOf(door).action) + '</p>' +
        '<p class="muted">どの日からでも、あなたのペースで。</p>' +
        '</section>'
      : '<section class="daily-door" aria-labelledby="daily-door-title">' +
        '<p class="eyebrow">DAY 21 / 21</p>' +
        '<div class="door-flower">' + flower(21, 132) + '<p class="flower-name">' + esc(flowerName(21)) + '</p></div>' +
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
    if (store.isSealed() && !store.isOpened()) {
      var homeView = view.firstChild;
      window.MichiruClock.trustedNow().then(function (now) {
        if (!store.canOpen(now) || view.firstChild !== homeView) return;
        var p = document.createElement('p');
        p.className = 'letter-arrived';
        p.innerHTML = '<a href="#/letter">✉ ' + esc(LETTER_ARRIVED) + '</a>';
        homeView.querySelector('.daily-door').insertAdjacentElement('afterend', p);
      });
    }
  }

  // ---------- 画面：1日の流れ（S03〜S07） ----------
  function stepNav(n, step) {
    var prev = step > 1 ? '<a class="btn" href="#/day/' + n + '/' + (step - 1) + '">← 戻る</a>' : '<a class="btn" href="#/">← 一覧</a>';
    var next = step < 5 ? '<a class="btn primary" href="#/day/' + n + '/' + (step + 1) + '" id="next">次へ →</a>' : '';
    return '<nav class="step-nav" aria-label="この日の移動">' + prev + next + '</nav>' +
      '<p class="pause-link"><a href="#/" id="pause">今日はここまでにする</a><span class="muted" id="pause-note">' + pauseNote(store.status) + '</span></p>';
  }

  function stepHeader(d, step) {
    var dots = STEPS.map(function (s, i) {
      var cur = i + 1 === step;
      return '<li' + (cur ? ' aria-current="step"' : '') + '><a href="#/day/' + d.day + '/' + (i + 1) + '">' +
        '<span class="dot">' + (i + 1) + '</span><span class="sr-only">' + esc(s) + '</span></a></li>';
    }).join('');
    return '<header class="day-head"><p class="eyebrow">Day ' + pad(d.day) + ' / 21</p>' +
      '<div class="head-flower">' + flower(d.day, 64) + '<p class="flower-name">' + esc(flowerName(d.day)) + '</p></div>' +
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
    // 初期位置（5）のまま記録したい人のために、軽く押しただけでも記録する。
    // pointerdown だと、スマホで画面を送るときに指が触れただけで記録されてしまうため、click（指を離したとき）にする
    input.addEventListener('click', function () { if (box.getAttribute('data-recorded') === 'false') set(parseInt(input.value, 10)); });
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
      body = miniGuideHtml(n) + '<div class="story"><p>' + esc(d.intro) + '</p></div>' +
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

    view.innerHTML = '<article class="day">' + stepHeader(d, step) + '<div class="step-body">' + (step >= 3 ? lessonReadHtml() : '') + body + '</div>' + stepNav(n, step) + '</article>';

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
      fillLetterRead(n);
      var c = document.getElementById('complete');
      if (c) c.addEventListener('click', function () {
        c.disabled = true; // 二重押しを防ぐ
        store.toggleComplete(n, true);
        if (n === 21) go('#/complete'); else render();
      });
      var u = document.getElementById('undo');
      if (u) u.addEventListener('click', function () { u.disabled = true; store.toggleComplete(n, false); render(); });
    }
    if (step >= 3) bindLessonRead(d, step);
    focusHeading();
  }

  function lessonReadHtml() {
    return '<section class="lesson-reader" aria-label="教材の読み上げ"><p class="row">' +
      '<button type="button" class="btn small" id="lesson-read">教材を読み上げる</button>' +
      '<button type="button" class="btn small" id="lesson-read-pause" hidden>一時停止</button>' +
      '<button type="button" class="btn small" id="lesson-read-resume" hidden>再開する</button>' +
      '<button type="button" class="btn small" id="lesson-read-stop" hidden>停止する</button></p>' +
      '<p class="muted">端末の日本語音声を使います。書き込んだ記録は読み上げません。</p><p id="lesson-read-status" role="status"></p></section>';
  }
  function disposeReader() {
    if (lessonReader) lessonReader.stop(); lessonReader = null;
    if (readerCleanup) readerCleanup(); readerCleanup = null;
  }
  function bindLessonRead(day, step) {
    if (!window.MichiruFutureGuidance) return;
    var start = document.getElementById('lesson-read'), pause = document.getElementById('lesson-read-pause');
    var resume = document.getElementById('lesson-read-resume'), stop = document.getElementById('lesson-read-stop');
    var status = document.getElementById('lesson-read-status');
    var paragraphs = [day.title];
    if (step === 3) {
      var guide = C.mini_guides && C.mini_guides.days && C.mini_guides.days[day.day];
      if (guide) paragraphs.push(guide);
      paragraphs.push(day.intro); paragraphs = paragraphs.concat(day.prompts);
    } else paragraphs.push(step === 4 ? day.action : day.reflection);
    lessonReader = new window.MichiruFutureGuidance.Reader(paragraphs, function (state) {
      pause.hidden = state !== 'playing'; resume.hidden = state !== 'paused' && state !== 'error';
      stop.hidden = ['playing', 'paused', 'error'].indexOf(state) < 0;
      status.textContent = state === 'playing' ? '読み上げています。' : state === 'paused' ? '一時停止中です。再開すると、その段落の最初から読み上げます。' :
        state === 'done' ? '読み上げが終わりました。' : state === 'error' ? '読み上げを続けられませんでした。再開するか、文章を読んで進められます。' :
        state === 'unsupported' ? 'このブラウザでは読み上げを使えません。文章を読んで進められます。' : '';
    });
    start.disabled = !lessonReader.supported();
    if (start.disabled) status.textContent = 'このブラウザでは読み上げを使えません。';
    start.addEventListener('click', function () { if (guidancePlayer) guidancePlayer.stop(); lessonReader.start(); });
    pause.addEventListener('click', function () { lessonReader.pause(); });
    resume.addEventListener('click', function () { if (guidancePlayer) guidancePlayer.stop(); lessonReader.resume(); });
    stop.addEventListener('click', function () { lessonReader.stop(); });
    function hidden() { if (document.visibilityState === 'hidden' && lessonReader) lessonReader.pause(); }
    document.addEventListener('visibilitychange', hidden);
    readerCleanup = function () { document.removeEventListener('visibilitychange', hidden); };
  }

  // ---------- 私の発見（P2） ----------
  // 本人が選んだ一言だけを残す。数・連続日数・点数は出さない。
  function discoveryFormHtml(day, label) {
    var saved = store.discoveriesOf(day);
    return '<div class="discovery-form">' +
      '<label for="disc-text">' + esc(label) + '</label>' +
      '<textarea id="disc-text" rows="2" maxlength="' + window.MichiruStore.DISCOVERY_MAX + '">' + esc(store.state.drafts[day] || '') + '</textarea>' +
      '<p class="row"><button type="button" class="btn" id="disc-add">私の発見に残す</button>' +
      '<span id="disc-msg" role="status" class="muted"></span></p>' +
      (saved.length ? '<ul class="disc-mini" aria-label="この日に残した言葉">' + saved.map(function (x) { return '<li>' + nl2br(x.text) + '</li>'; }).join('') + '</ul>' : '') +
      '</div>';
  }
  function bindDiscoveryForm(day) {
    var t = document.getElementById('disc-text');
    var b = document.getElementById('disc-add');
    var msg = document.getElementById('disc-msg');
    t.addEventListener('input', function () { store.setDraft(day, t.value); });
    b.addEventListener('click', function () {
      if (!t.value.trim()) { msg.textContent = '残したい言葉を書いてから押してください。'; t.focus(); return; }
      b.disabled = true; // 二重押しを防ぐ
      store.addDiscovery(day, t.value);
      store.setDraft(day, '');
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
      (store.hasFutureLetter() || store.hasLegacyLetter() ? '<h2>未来からの手紙</h2><p><a href="#/letter">未来からの手紙を見る</a></p>' : '') +
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
  // 21日間を歩き終えた未来の自分になったつもりで、今の自分に宛てて書く手紙（オーナー仕様 2026-10-31）。
  // Day 1 に書いて封をする → 封をしてから7日後（サーバー時刻で判断）に開封できる（開けずに取っておける）→ 一度開いたら、いつでも読み返せる。
  // Day 7・14・21 では、読んだあとにその日に感じたことを記録できる。導入と誘導の文はオーナーの原文のまま。
  var LETTER_INTRO = ['私たちは普段、今の自分から未来を見ています。', 'でも今日は、少しだけ反対のことをしてみます。',
    'あなたが望んだ未来。', '幸せで、喜びに満ち、心から「ありがとう」と感じているあなた。',
    'その未来の自分になったつもりで、今のあなたを見てみましょう。', '今のあなたは、どんなふうに見えますか。', '何を伝えてあげたいですか。',
    '何かが足りない自分ではなく、すでに素晴らしいものを持っている自分が見えてくるかもしれません。',
    'その未来のあなたから、今のあなたへ。', '一通の手紙を届けてください。'];
  var LETTER_GUIDE = ['少し目を閉じて、21日間を歩み終えた自分をイメージしてみましょう。', 'そのあなたは、今のあなたに何を伝えたいでしょうか。',
    '未来のあなたになったつもりで、今のあなたへ手紙を書いてみましょう。', 'うまく書こうとしなくて大丈夫です。',
    '未来のあなたから、今のあなたへ。', 'その言葉を、自由に綴ってください。'];
  // 案内文（オーナー指定 2026-10-31）
  var LETTER_BEFORE_SEAL = '書き終えたら、そっと封をしましょう。未来のあなたからの手紙は、7日後に届きます。書かなくてもかまいません。';
  var LETTER_SEAL_CONFIRM = '封をすると、7日間は開けることも、書き直すこともできません。今の言葉を大切に、そのまま残しておきましょう。';
  var LETTER_ARRIVED = '未来のあなたから、手紙が届いています。';
  var LETTER_ARRIVED_NOTE = '今、開いても、もう少し後に開いてもかまいません。';
  var LETTER_REREAD = '一度開いた手紙は、いつでも読み返せます。';
  // 未来の自分の心を体感する誘導（仮・オーナー確認待ち）。瞑想のあと、書く前に出す
  var FUTURE_FEEL = ['21日間を歩き終えたあなたは、どんな表情をしていますか。', 'どんな気持ちで、毎日を過ごしていますか。',
    '胸のあたりに、どんなあたたかさがありますか。', 'その心のまま、今のあなたを見てみましょう。'];
  function unlockText() {
    var t = store.unlockAt();
    if (!isFinite(t)) return '7日後';
    var d = new Date(t);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + '時ごろ';
  }
  // 「答えから見る」の解説（仮・オーナー確認待ち。2026-10-31 オーナー指示で追加）
  var ANSWER_VIEW = ['「答えから見る」とは、望んだ未来がすでにかなった場所に立って、そこから今を見ることです。',
    '今の自分から未来を見ると、足りないものや、これからしなければならないことに目が向きやすくなります。',
    '満たされた未来の自分から今を見ると、すでに在るもの、ここまで歩いてきた道、今のあなたの素晴らしさに気づきやすくなります。',
    '未来のあなたは、今のあなたを責めたり、急かしたりしません。あたたかく見守り、伝えたいことがあるはずです。'];
  // 書く前に心を整える瞑想。33秒は既存の仮の誘導を使う。感謝の瞑想は仮の誘導（正式原稿が決まるまで仮）
  var GRATITUDE_MEDITATION = { seconds: 60, phases: [
    { from: 0, to: 15, text: 'ゆっくり息をして、肩や顔の力をゆるめます。' },
    { from: 15, to: 30, text: '今ここに在るものを一つ思い浮かべ、心の中で「ありがとう」と言います。' },
    { from: 30, to: 45, text: '21日間を歩き終え、満たされて、心から「ありがとう」と感じているあなたを思い浮かべます。' },
    { from: 45, to: 60, text: 'そのあなたの表情、まなざし、胸のあたたかさを、そのまま感じます。' }] };
  var prepTimer = null;
  function lines(arr) { return arr.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join(''); }

  function futureGuidanceHtml() {
    var g = window.MichiruFutureGuidance;
    if (!g) return '';
    return '<section class="future-audio" aria-labelledby="future-audio-title"><h4 id="future-audio-title">33秒瞑想（33秒×3回）</h4>' +
      '<p class="muted">端末の日本語読み上げを使います。声は端末によって異なります。途中に33秒の無音が3回あります。</p>' +
      '<p class="muted">座って安全に過ごせる場所で使ってください。目を開けたままでも、途中でやめてもかまいません。</p>' +
      '<label for="guidance-voice">読み上げの声</label><select id="guidance-voice"><option value="">端末の日本語音声</option></select>' +
      '<p class="row"><button class="btn" type="button" id="guidance-start">音声をはじめる・最初から</button>' +
      '<button class="btn" type="button" id="guidance-pause" hidden>一時停止</button>' +
      '<button class="btn" type="button" id="guidance-resume" hidden>再開する</button>' +
      '<button class="btn" type="button" id="guidance-stop" hidden>停止する</button></p>' +
      '<p id="guidance-status" role="status">音声は自動では流れません。</p><p id="guidance-seconds" aria-live="off"></p>' +
      '<details class="guidance-transcript"><summary>音声の原稿を読む</summary>' + g.sections.map(function (s) {
        return '<h4>' + esc(s.title) + '</h4>' + lines(s.text) + (s.silence ? '<p>【ここで33秒間、無言】</p>' : '');
      }).join('') + '</details></section>';
  }

  function disposeGuidance() {
    if (guidancePlayer) guidancePlayer.stop();
    guidancePlayer = null;
    if (guidanceCleanup) guidanceCleanup();
    guidanceCleanup = null;
  }

  function bindFutureGuidance(reveal) {
    var start = document.getElementById('guidance-start');
    if (!start) return;
    disposeGuidance();
    var g = window.MichiruFutureGuidance, synth = window.speechSynthesis;
    var status = document.getElementById('guidance-status'), seconds = document.getElementById('guidance-seconds');
    var pause = document.getElementById('guidance-pause'), resume = document.getElementById('guidance-resume');
    var stop = document.getElementById('guidance-stop'), select = document.getElementById('guidance-voice');
    var voices = [];
    function updateVoices() {
      var previous = select.value;
      voices = synth ? synth.getVoices().filter(function (v) { return /^ja(?:-|$)/i.test(v.lang); }) : [];
      select.innerHTML = '<option value="">端末の日本語音声</option>' + voices.map(function (v) {
        return '<option value="' + esc(v.name) + '">' + esc(v.name) + '</option>';
      }).join('');
      if (voices.some(function (v) { return v.name === previous; })) select.value = previous;
    }
    guidancePlayer = new g.Player(function (s) {
      pause.hidden = s.state !== 'playing';
      resume.hidden = s.state !== 'paused' && s.state !== 'error';
      stop.hidden = ['playing', 'paused', 'error'].indexOf(s.state) < 0;
      var section = g.sections[s.index];
      var text = s.state === 'playing' ? (section ? section.title : '') + (s.phase === 'silence' ? '：静かに感じる時間です。' : '：読み上げています。') :
        s.state === 'paused' ? '一時停止中です。読み上げ中の再開は、その段階の最初からになります。' :
        s.state === 'error' ? '読み上げを続けられませんでした。再開するか、原稿を読みながら進められます。' :
        s.state === 'done' ? '33秒瞑想が終わりました。感じたことを、書き残してみましょう。' :
        s.state === 'unsupported' ? 'このブラウザでは読み上げを使えません。下の原稿を読んで進められます。' : '音声は停止しています。';
      if (status.textContent !== text) status.textContent = text;
      seconds.textContent = s.phase === 'silence' && s.remaining !== undefined ? '無音の時間：あと' + s.remaining + '秒' : '';
    }, function () { reveal(); document.getElementById('letter-text').focus(); });
    start.disabled = !guidancePlayer.supported();
    if (start.disabled) status.textContent = 'このブラウザでは読み上げを使えません。下の原稿を読んで進められます。';
    updateVoices();
    start.addEventListener('click', function () {
      if (lessonReader) lessonReader.stop();
      if (prepTimer) prepTimer.dispose();
      document.getElementById('prep-player').hidden = true;
      guidancePlayer.start(voices.filter(function (v) { return v.name === select.value; })[0]);
    });
    pause.addEventListener('click', function () { guidancePlayer.pause(); });
    resume.addEventListener('click', function () { if (lessonReader) lessonReader.stop(); guidancePlayer.resume(); });
    stop.addEventListener('click', function () { guidancePlayer.stop(); });
    function onHidden() { if (document.visibilityState === 'hidden' && guidancePlayer) guidancePlayer.pause(); }
    document.addEventListener('visibilitychange', onHidden);
    if (synth) synth.addEventListener('voiceschanged', updateVoices);
    guidanceCleanup = function () {
      document.removeEventListener('visibilitychange', onHidden);
      if (synth) synth.removeEventListener('voiceschanged', updateVoices);
    };
  }

  function letterWriteHtml() {
    var l = store.state.futureLetter;
    var head = '<summary>未来からの手紙（任意）</summary>';
    if (store.isOpened()) {
      return '<details class="letter-box" open>' + head +
        '<p class="seal-state">✉ ' + esc(LETTER_REREAD) + '</p><p><a class="btn small" href="#/letter">手紙を読み返す</a></p></details>';
    }
    if (store.isSealed()) {
      return '<details class="letter-box" open>' + head +
        '<p class="seal-state">✉ 封をしました。未来のあなたからの手紙は、' + esc(unlockText()) + 'に届きます。</p></details>';
    }
    var ready = !!(l && l.text) || letterPrepDone;
    return '<details class="letter-box"' + (l && l.text ? ' open' : '') + '>' + head +
      '<div class="letter-intro"><h3>答えから、今を見てみましょう</h3>' + lines(LETTER_INTRO) + '</div>' +
      '<details class="answer-view"><summary>「答えから見る」という考え方</summary>' + lines(ANSWER_VIEW) + '</details>' +
      '<section class="letter-prep" aria-labelledby="prep-title"><h3 id="prep-title">書く前に、心を整えましょう</h3>' +
      '<p class="muted">満たされた未来の自分を感じてから書くと、言葉が自然に出てきやすくなります。音声や静かな時間を選べます。</p>' +
      futureGuidanceHtml() +
      '<p class="row"><button type="button" class="btn" id="prep-33">33秒の静かな時間</button>' +
      '<button type="button" class="btn" id="prep-thanks">感謝の瞑想（約1分）</button></p>' +
      '<div id="prep-player" hidden><div class="timer" aria-live="polite"><span id="prep-sec" class="t-sec"></span><span class="t-unit">秒</span></div>' +
      '<p id="prep-guide" class="t-guide"></p>' +
      '<p class="row"><button type="button" class="btn" id="prep-pause">一時停止</button><button type="button" class="btn" id="prep-resume" hidden>再開</button>' +
      '<button type="button" class="btn" id="prep-stop">終える</button></p></div>' +
      '<div id="prep-done"' + (letterPrepDone ? '' : ' hidden') + '><div class="future-feel">' + lines(FUTURE_FEEL) + '</div>' +
      '<p class="seal-state">心が整ったら、その満たされた感覚のまま、手紙を書いてみましょう。</p></div>' +
      '<p><button type="button" class="btn small" id="prep-skip"' + (ready ? ' hidden' : '') + '>瞑想をせずに書く</button></p></section>' +
      '<div id="letter-write"' + (ready ? '' : ' hidden') + '>' +
      '<div class="letter-guide">' + lines(LETTER_GUIDE) + '</div>' +
      '<label for="letter-text" class="sr-only">未来のあなたから、今のあなたへの手紙</label>' +
      '<textarea id="letter-text" rows="7" maxlength="4000">' + esc(l ? l.text : '') + '</textarea>' +
      '<p class="muted">' + esc(LETTER_BEFORE_SEAL) + '</p>' +
      '<p><button type="button" class="btn primary" id="letter-seal"' + (l && l.text.trim() ? '' : ' disabled') + '>封をする</button></p>' +
      '<p id="seal-msg" class="warn-msg" role="alert"></p></div></details>';
  }
  var letterPrepDone = false; // この画面で瞑想を終えたか（保存はしない）

  function bindLetterPrep() {
    var b33 = document.getElementById('prep-33');
    if (!b33) return;
    var player = document.getElementById('prep-player');
    var sec = document.getElementById('prep-sec');
    var guide = document.getElementById('prep-guide');
    var pause = document.getElementById('prep-pause');
    var resume = document.getElementById('prep-resume');
    function reveal() {
      letterPrepDone = true;
      document.getElementById('prep-done').hidden = false;
      document.getElementById('prep-skip').hidden = true;
      document.getElementById('letter-write').hidden = false;
    }
    function play(m) {
      if (lessonReader) lessonReader.stop();
      if (guidancePlayer) guidancePlayer.stop();
      if (prepTimer) prepTimer.dispose();
      player.hidden = false; pause.hidden = false; resume.hidden = true;
      prepTimer = new window.MichiruTimer(m.seconds, function (remain, ms) {
        sec.textContent = remain;
        var t = ms / 1000, txt = m.phases[m.phases.length - 1].text;
        for (var i = 0; i < m.phases.length; i++) if (t < m.phases[i].to) { txt = m.phases[i].text; break; }
        if (prepTimer && prepTimer.state === 'paused') guide.textContent = '一時停止中です。再開できます。'; else guide.textContent = txt;
      }, function () {
        guide.textContent = 'おつかれさまでした。';
        pause.hidden = true; resume.hidden = true;
        reveal();
        document.getElementById('prep-done').setAttribute('tabindex', '-1');
        document.getElementById('prep-done').focus();
      });
      sec.textContent = m.seconds;
      prepTimer.start();
    }
    b33.addEventListener('click', function () { play(C.meditation); });
    bindFutureGuidance(reveal);
    document.getElementById('prep-thanks').addEventListener('click', function () { play(GRATITUDE_MEDITATION); });
    pause.addEventListener('click', function () { prepTimer.pause(); pause.hidden = true; resume.hidden = false; });
    resume.addEventListener('click', function () { prepTimer.start(); pause.hidden = false; resume.hidden = true; });
    document.getElementById('prep-stop').addEventListener('click', function () {
      if (prepTimer) prepTimer.dispose();
      player.hidden = true;
      reveal();
    });
    document.getElementById('prep-skip').addEventListener('click', function () {
      if (guidancePlayer) guidancePlayer.stop();
      document.getElementById('letter-write').hidden = false;
      document.getElementById('prep-skip').hidden = true;
      document.getElementById('letter-text').focus();
    });
  }
  function bindLetterWrite() {
    var t = document.getElementById('letter-text');
    if (!t) return;
    bindLetterPrep();
    var seal = document.getElementById('letter-seal');
    t.addEventListener('input', function () { store.setFutureLetter(t.value); seal.disabled = !t.value.trim(); });
    seal.addEventListener('click', function () {
      askConfirm(LETTER_SEAL_CONFIRM, '封をする').then(function (ok) {
        if (!ok) return null;
        seal.disabled = true;
        return window.MichiruClock.trustedNow().then(function (now) { return { now: now }; });
      }).then(function (r) {
        if (!r) return;
        store.setFutureLetter(t.value);
        if (!store.sealFutureLetter(r.now)) {
          seal.disabled = false;
          var m = document.getElementById('seal-msg');
          if (m) m.textContent = '端末に保存できなかったため、封をしていません。容量などを確かめて、もう一度お試しください。';
          return;
        }
        var box = document.querySelector('.letter-box');
        disposeGuidance();
        box.outerHTML = letterWriteHtml();
        var st = document.querySelector('.seal-state');
        st.setAttribute('tabindex', '-1'); st.focus();
      });
    });
  }

  // Day 7・14・21：封をした手紙。開封できるかは、サーバー時刻で「封の時刻＋7日」を過ぎたかで決める
  function letterReadHtml(day) {
    if (window.MichiruStore.LETTER_DAYS.indexOf(day) < 0 || !store.isSealed()) return '';
    return '<section class="letter-read" aria-labelledby="letter-read-title" id="letter-read" aria-busy="true">' +
      '<h2 id="letter-read-title">未来のあなたからの手紙</h2><p class="muted">確かめています…</p></section>';
  }
  // 状態：opened（開封済み）／ready（届いている）／locked（まだ7日たっていない）／unknown（時刻を確かめられない）
  function letterStatus(now) {
    if (store.isOpened()) return 'opened';
    if (typeof now !== 'number') return 'unknown';
    return store.canOpen(now) ? 'ready' : 'locked';
  }
  function letterStateHtml(status, day) {
    if (status === 'opened') {
      return '<h2 id="letter-read-title">未来のあなたからの手紙</h2><p class="seal-state">✉ 開封済み</p>' +
        '<p class="muted">' + esc(LETTER_REREAD) + '</p>' +
        '<p class="row"><button type="button" class="btn" id="letter-open">手紙を読む</button></p><div id="letter-body" hidden></div>';
    }
    if (status === 'ready') {
      var kept = !!(day && store.state.futureSkipped[day]);
      return '<h2 id="letter-read-title">' + esc(LETTER_ARRIVED) + '</h2><p class="seal-state">✉ 封をしたまま</p>' +
        '<p class="muted">' + esc(LETTER_ARRIVED_NOTE) + '</p>' +
        '<p class="row"><button type="button" class="btn" id="letter-open">封を開ける</button>' +
        (kept ? '' : '<button type="button" class="btn" id="letter-skip">もう少し後に開く</button>') + '</p><div id="letter-body" hidden></div>';
    }
    if (status === 'locked') {
      return '<h2 id="letter-read-title">未来のあなたからの手紙</h2><p class="seal-state">✉ 封をしたまま</p>' +
        '<p class="muted">封をしてから7日後、' + esc(unlockText()) + 'に届きます。それまでは、そっと取っておきましょう。</p>';
    }
    return '<h2 id="letter-read-title">未来のあなたからの手紙</h2><p class="seal-state">✉ 封をしたまま</p>' +
      '<p class="muted">手紙が届いているかを、通信できるときに確かめます。インターネットにつながった状態で、もう一度開いてください。</p>';
  }
  // 画面に描いたあと、時刻を確かめて手紙の欄を埋める
  function fillLetterRead(day) {
    var sec = document.getElementById('letter-read');
    if (!sec) return;
    window.MichiruClock.trustedNow().then(function (now) {
      if (!document.body.contains(sec)) return; // 画面を移ったあと
      store.rebaseSeal(now);
      sec.removeAttribute('aria-busy');
      sec.innerHTML = letterStateHtml(letterStatus(now), day);
      bindLetterRead(day, now);
    });
  }
  function writtenOn(l) {
    var wd = l.written_at ? new Date(l.written_at) : null;
    return wd ? wd.getFullYear() + '/' + (wd.getMonth() + 1) + '/' + wd.getDate() : '';
  }
  function letterBodyHtml(day) {
    var l = store.state.futureLetter;
    var r = day ? store.state.futureReplies[day] : null;
    return '<blockquote class="letter-quote">' + nl2br(l.text) + '</blockquote>' +
      '<p class="disc-meta">' + (writtenOn(l) ? writtenOn(l) + '、' : '') + '未来のあなたになって書いた手紙</p>' +
      (day ? '<div class="field"><label for="letter-reply">手紙を読んで、今日のあなたが感じたこと（任意）</label>' +
        '<textarea id="letter-reply" rows="3" maxlength="4000">' + esc(r ? r.text : '') + '</textarea></div>' : '') +
      '<p><button type="button" class="btn small" id="letter-close">手紙を閉じる</button></p>';
  }
  function showLetterBody(day) {
    var body = document.getElementById('letter-body');
    var open = document.getElementById('letter-open');
    body.innerHTML = letterBodyHtml(day);
    body.hidden = false;
    open.hidden = true;
    var reply = document.getElementById('letter-reply');
    if (reply) reply.addEventListener('input', function () { store.setFutureReply(day, reply.value); });
    document.getElementById('letter-close').addEventListener('click', function () {
      body.hidden = true; body.innerHTML = ''; open.hidden = false; open.focus();
    });
    var q = body.querySelector('.letter-quote');
    q.setAttribute('tabindex', '-1'); q.focus();
  }
  function bindLetterRead(day, now) {
    var sec = document.getElementById('letter-read');
    var open = document.getElementById('letter-open');
    if (!open) return;
    open.addEventListener('click', function () {
      if (store.isOpened()) { showLetterBody(day); return; }
      open.disabled = true; // 二重押しを防ぐ
      // 押したときにも、もう一度時刻を確かめる
      window.MichiruClock.trustedNow().then(function (t) {
        if (!store.openFutureLetter(t)) {
          sec.innerHTML = letterStateHtml(letterStatus(t), day);
          if (store.canOpen(t)) sec.insertAdjacentHTML('beforeend', '<p class="warn-msg" role="alert">端末に保存できなかったため、まだ開封していません。もう一度お試しください。</p>');
          bindLetterRead(day, t);
          return;
        }
        sec.innerHTML = letterStateHtml('opened', day);
        bindLetterRead(day, t);
        showLetterBody(day);
      });
    });
    var skip = document.getElementById('letter-skip');
    if (skip) skip.addEventListener('click', function () {
      if (day) store.setFutureSkipped(day, true);
      sec.innerHTML = letterStateHtml(letterStatus(now), day);
      bindLetterRead(day, now);
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
    var body;
    if (store.isSealed()) {
      body = '<section class="letter-read" id="letter-read" aria-labelledby="letter-read-title" aria-busy="true">' +
        '<h2 id="letter-read-title">未来のあなたからの手紙</h2><p class="muted">確かめています…</p></section>' +
        '<div id="letter-replies"></div>';
    } else if (store.hasFutureLetter()) {
      body = '<p class="muted">書きかけの手紙があります。Day 01 の「夜のふりかえり」で、書き終えたら封をしてください。</p><p><a class="btn" href="#/day/1/5">Day 01 の夜のふりかえりへ</a></p>';
    } else {
      body = '<p class="muted">手紙はまだありません。Day 01 の「夜のふりかえり」で、書きたいときに書けます。</p><p><a href="#/day/1/5">Day 01 の夜のふりかえりへ</a></p>';
    }
    view.innerHTML = '<section class="letter-page"><h1>未来からの手紙</h1>' + body +
      '<p class="row"><a class="btn" href="#/discoveries">← 私の発見</a></p>' + legacyLetterHtml() + '</section>';
    if (store.isSealed()) fillLetterRead(null);
    var replies = window.MichiruStore.LETTER_DAYS.filter(function (d) { return store.state.futureReplies[d] && store.state.futureReplies[d].text; });
    if (store.isOpened() && replies.length) {
      document.getElementById('letter-replies').innerHTML = '<h2>手紙を読んで、感じたこと</h2><dl class="record">' + replies.map(function (d) {
        return '<dt>Day ' + pad(d) + '</dt><dd>' + nl2br(store.state.futureReplies[d].text) + '</dd>';
      }).join('') + '</dl>';
    }
    focusHeading();
  }

  // 21日の花（絵は読み上げず、名前を文字で示す）
  function flower(day, size) { return window.MichiruFlowers ? window.MichiruFlowers.svg(day, size) : ''; }
  function flowerName(day) { return window.MichiruFlowers ? window.MichiruFlowers.name(day) : ''; }
  // 今日の扉に出す「今日の小さな理由」（ワークの画面と同じ文）
  function doorGuideHtml(n) {
    var g = C.mini_guides, t = g && g.days && g.days[n];
    return t ? '<p class="door-guide">' + esc(t) +
      (g.status === 'draft' ? '<br><span class="draft-mark">（確認中の文章です）</span>' : '') + '</p>' : '';
  }

  // ワークの前の「今日の小さな理由」（2〜3文）。読まずにすぐワークに進めるよう、折りたためる
  function miniGuideHtml(n) {
    var g = C.mini_guides;
    var t = g && g.days && g.days[n];
    if (!t) return '';
    return '<details class="mini-guide" open><summary>' + esc(g.label || '今日の小さな理由') + '</summary><p>' + esc(t) + '</p>' +
      (g.status === 'draft' ? '<p class="draft-mark">（確認中の文章です）</p>' : '') + '</details>';
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
        store.setDraft(n, t.value);
        t.focus();
      });
    });
    document.getElementById('del-day').addEventListener('click', function () {
      askConfirm('Day ' + pad(n) + ' の記録を削除します。元に戻せません。（「私の発見」に残した言葉は消えません）', '削除する').then(function (ok) {
        if (!ok) return;
        if (!store.deleteDay(n)) return; // 保存できなかった（右上に表示）
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
    view.innerHTML = '<section class="card closing"><div class="closing-flower">' + flower(21, 120) + '</div><h1>' + esc(c.title) + '</h1>' +
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
    if (store.recoveryRequired && location.hash !== '#/settings') history.replaceState(null, '', '#/settings');
    setTitle('設定');
    var fs = store.state.settings.fontSize;
    function fsBtn(v, label) { return '<button type="button" class="btn small" data-fs="' + v + '" aria-pressed="' + (fs === v) + '">' + label + '</button>'; }
    view.innerHTML = '<section class="settings"><h1>設定</h1>' +
      (store.recoveryRequired ? '<section class="card" aria-labelledby="recovery-title"><h2 id="recovery-title">記録を読み取れませんでした</h2>' +
        '<p>元のデータを上書きせずに保護しています。まず退避用ファイルを保存し、お持ちのバックアップから記録を戻してください。</p>' +
        '<p>退避用ファイルは、そのまま復元できるとは限りません。書いた文章が含まれるため、大切に保管してください。</p>' +
        (typeof store.backend.originalText === 'string' ? '<p><button type="button" class="btn" id="export-recovery">元のデータを退避する</button></p>' :
          '<p>ブラウザの保存領域を読み取れません。ブラウザのデータを消さずに、端末の設定を確認してから開き直してください。</p>') +
        '<p>バックアップがなく、最初から始める場合だけ、下の「すべての記録を削除」を選んでください。</p></section>' : '') +
      '<h2>文字の大きさ</h2><p class="row">' + fsBtn('s', '小') + fsBtn('m', '標準') + fsBtn('l', '大') + fsBtn('xl', '特大') + '</p>' +
      '<h2>バックアップ</h2><p class="muted">記録をファイルにして保存できます。機種変更のときや、念のための保管に使ってください。ファイルには書いた文章が入っています。取り扱いに気をつけてください。</p>' +
      '<p class="row"><button type="button" class="btn" id="export"' + (store.recoveryRequired ? ' disabled' : '') + '>記録をファイルに保存</button>' +
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
      b.disabled = !!store.recoveryRequired;
      b.addEventListener('click', function () {
        store.setMeta(function (s) { s.settings.fontSize = b.getAttribute('data-fs'); });
        applyFont(); renderSettings();
      });
    });
    function download(text, filename) {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    var recoveryButton = document.getElementById('export-recovery');
    if (recoveryButton) recoveryButton.addEventListener('click', function () {
      download(store.backend.originalText, 'michiru-21days-recovery-' + Date.now() + '.json');
    });
    document.getElementById('export').addEventListener('click', function () {
      var data = JSON.stringify(store.exportBackup(), null, 2);
      var d = new Date();
      download(data, 'michiru-21days-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json');
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
          var incoming = window.MichiruStore.summarize(window.MichiruStore.normalizeState(raw));
          if (!incoming.days && !incoming.discoveries && !incoming.letter) {
            msg.textContent = 'このファイルには記録が入っていないため、読み込みませんでした（いまの記録はそのままです）。';
            ev.target.value = '';
            return;
          }
          var cur = store.summary();
          function line(x) { return '日々の記録 ' + x.days + '日分・私の発見 ' + x.discoveries + '件・手紙 ' + (x.letter ? 'あり' : 'なし'); }
          var at = typeof raw.exportedAt === 'string' && !isNaN(Date.parse(raw.exportedAt)) ? new Date(raw.exportedAt) : null;
          askConfirm('いまの記録を、ファイルの内容で置き換えます。\n' +
            'ファイル' + (at ? '（' + at.getFullYear() + '/' + (at.getMonth() + 1) + '/' + at.getDate() + ' に保存）' : '') + '：' + line(incoming) + '\n' +
            'いまの記録：' + line(cur), '置き換える').then(function (ok) {
            if (!ok) { msg.textContent = '取り消しました。'; return; }
            var recovering = store.recoveryRequired;
            if (!store.importBackup(raw)) { msg.textContent = '端末に保存できなかったため、記録を戻せませんでした（いまの記録はそのままです）。'; return; }
            applyFont();
            if (recovering) { renderSettings(); msg = document.getElementById('import-msg'); }
            msg.textContent = '記録を戻しました。';
          });
        } catch (e) {
          msg.textContent = '読み込めませんでした：' + (e.message || 'ファイルの形式が違います。');
        }
        ev.target.value = '';
      };
      r.readAsText(f);
      r.onerror = function () {
        msg.textContent = 'ファイルを読み取れませんでした。端末にダウンロードされているか確認して、もう一度選んでください。';
        ev.target.value = '';
      };
    });
    document.getElementById('delete-all').addEventListener('click', function () {
      askConfirm('すべての記録を削除します。元に戻せません。', 'すべて削除する').then(function (ok) {
        if (ok) store.deleteAll().then(function (done) { if (done !== false) go('#/intro'); });
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
      api.logout().then(function () { store.detach(!!(window.MICHIRU_CONFIG && window.MICHIRU_CONFIG.localOnly)); location.reload(); });
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
    disposeReader();
    disposeGuidance();
    if (timer) { timer.dispose(); timer = null; }
    if (prepTimer) { prepTimer.dispose(); prepTimer = null; }
    letterPrepDone = false;
    store.noteDeviceTime();
    store.flush();
    if (store.recoveryRequired) return renderSettings();
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
    // 招待制では教材をAPIから受け取るため、起動後に「命の瞑想」を適用する。
    C = window.MichiruLifeMeditation ? window.MichiruLifeMeditation.apply(content) : content;
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
    if (window.MICHIRU_CONFIG && window.MICHIRU_CONFIG.server) {
      if (!window.MichiruApi) {
        view.textContent = '認証を読み込めませんでした。通信を確認して、もう一度開いてください。';
        return;
      }
      api = window.MichiruApi;
      Promise.resolve().then(function () { return api.boot(view); }).then(function (res) {
        if (!res) return; // ログイン画面・購入案内を表示中
        account = res.account;
        var s = start(res.content, { key: 'michiru21.u.' + res.account.id, remote: api.remote() });
        if (s.remote) s.mergeRemote(res.entries);
      }).catch(function () {
        view.textContent = '認証を確認できませんでした。通信を確認して、もう一度開いてください。';
      });
      return;
    }
    if (!window.MICHIRU_CONTENT) { view.textContent = '教材を読み込めませんでした。'; return; }
    start(window.MICHIRU_CONTENT, {});
  }

  window.MichiruApp = { boot: boot };
  boot();
})();

