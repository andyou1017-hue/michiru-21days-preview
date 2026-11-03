// 21日それぞれの花（デザイン用の仮イラスト。植物画の正式素材ではない）。
// 花の割り当て：Drive「10時 新デザイン確定方針・21日花割当」（オーナー意向：クリームイエロー＋毎日違う花）。
// 外部の画像に頼らず、その場で描く（通信が遅くても、画像が読めなくても花の名前は出る）。
(function () {
  'use strict';

  var FLOWERS = [
    null,
    { name: 'マーガレット', kind: 'ring', petals: 16, len: 34, wid: 7, color: '#FFFFFF', edge: '#E8DFC4', center: '#F2C53D', cr: 11 },
    { name: 'チューリップ', kind: 'tulip', color: '#F49AA8', edge: '#E07C8D' },
    { name: 'コスモス', kind: 'ring', petals: 8, len: 34, wid: 13, notch: true, color: '#F6B3CB', edge: '#E592B1', center: '#E9B93A', cr: 8 },
    { name: 'ミモザ', kind: 'cluster', color: '#F5CF3A', edge: '#E3B51E', count: 15, r: 6.5 },
    { name: 'ガーベラ', kind: 'ring', petals: 22, len: 33, wid: 6, color: '#F7A35C', edge: '#E5853A', layer2: '#FBC48C', center: '#7A5A2A', cr: 10 },
    { name: 'ひまわり', kind: 'ring', petals: 20, len: 30, wid: 8, point: true, color: '#F7C928', edge: '#E3AE10', center: '#7A5226', cr: 15 },
    { name: 'すずらん', kind: 'bells', color: '#FFFFFF', edge: '#D9D3BD' },
    { name: 'デイジー', kind: 'ring', petals: 14, len: 28, wid: 7, color: '#FFFFFF', tip: '#F3B8C8', edge: '#E8DFC4', center: '#F2C53D', cr: 10 },
    { name: 'ラナンキュラス', kind: 'layers', color: '#F9BFA0', edge: '#EC9F7C', rings: 5 },
    { name: 'フリージア', kind: 'freesia', color: '#F6D04D', edge: '#E2B52A' },
    { name: 'カモミール', kind: 'ring', petals: 13, len: 22, wid: 7, color: '#FFFFFF', edge: '#E8DFC4', center: '#F0C030', cr: 13 },
    { name: 'スイートピー', kind: 'sweetpea', color: '#C9B3E6', edge: '#AB92D3' },
    { name: 'スミレ', kind: 'violet', color: '#8E78C8', edge: '#7360AE', center: '#F4D35E' },
    { name: 'ポピー', kind: 'ring', petals: 4, len: 30, wid: 26, color: '#F28A5E', edge: '#DE6E44', center: '#4A3A2A', cr: 8 },
    { name: 'ジャスミン', kind: 'ring', petals: 5, len: 30, wid: 12, point: true, color: '#FFFFFF', edge: '#E3DCC2', center: '#F3E2A0', cr: 5 },
    { name: 'アネモネ', kind: 'ring', petals: 6, len: 30, wid: 20, color: '#D9748E', edge: '#C25A76', center: '#3E3550', cr: 10 },
    { name: 'ネモフィラ', kind: 'ring', petals: 5, len: 28, wid: 22, color: '#9DCBF0', edge: '#79B0DE', center: '#FFFFFF', cr: 9 },
    { name: 'ダリア', kind: 'dahlia', color: '#E07AA6', edge: '#C85E8C' },
    { name: 'カスミソウ', kind: 'cluster', color: '#FFFFFF', edge: '#E3DCC2', count: 22, r: 4.5 },
    { name: 'キンモクセイ', kind: 'cluster', color: '#F4A23C', edge: '#DE8A24', count: 16, r: 5.5, star: true },
    { name: '黄金色のバラ', kind: 'rose', color: '#F2C14E', edge: '#D9A22C' }
  ];

  var LEAF = '#8FAE84';
  var STEM = '#7C9A72';

  function f(n) { return Math.round(n * 10) / 10; }
  function rot(x, y, a) { var r = a * Math.PI / 180; return [f(x * Math.cos(r) - y * Math.sin(r)), f(x * Math.sin(r) + y * Math.cos(r))]; }

  // 中心(0,0)から上に伸びる花びら1枚の形
  function petalPath(len, wid, opt) {
    if (opt.point) return 'M0 0 C' + f(wid) + ' ' + f(-len * 0.35) + ' ' + f(wid * 0.6) + ' ' + f(-len * 0.8) + ' 0 ' + f(-len) + ' C' + f(-wid * 0.6) + ' ' + f(-len * 0.8) + ' ' + f(-wid) + ' ' + f(-len * 0.35) + ' 0 0Z';
    if (opt.notch) return 'M0 0 C' + f(wid) + ' ' + f(-len * 0.3) + ' ' + f(wid * 1.1) + ' ' + f(-len * 0.95) + ' ' + f(wid * 0.45) + ' ' + f(-len) +
      ' L0 ' + f(-len * 0.9) + ' L' + f(-wid * 0.45) + ' ' + f(-len) + ' C' + f(-wid * 1.1) + ' ' + f(-len * 0.95) + ' ' + f(-wid) + ' ' + f(-len * 0.3) + ' 0 0Z';
    return 'M0 0 C' + f(wid) + ' ' + f(-len * 0.25) + ' ' + f(wid) + ' ' + f(-len) + ' 0 ' + f(-len) + ' C' + f(-wid) + ' ' + f(-len) + ' ' + f(-wid) + ' ' + f(-len * 0.25) + ' 0 0Z';
  }

  function ring(fl) {
    var out = '';
    var layers = fl.layer2 ? [[fl.layer2, 0.72, 360 / fl.petals / 2]] : [];
    layers.unshift([fl.color, 1, 0]);
    for (var L = 0; L < layers.length; L++) {
      var col = layers[L][0], scale = layers[L][1], off = layers[L][2];
      for (var i = 0; i < fl.petals; i++) {
        var a = off + i * 360 / fl.petals;
        out += '<path d="' + petalPath(fl.len * scale, fl.wid * scale, fl) + '" transform="rotate(' + f(a) + ')" fill="' + col + '" stroke="' + fl.edge + '" stroke-width="1"/>';
        if (fl.tip && L === 0) {
          var p = rot(0, -fl.len * 0.88, a);
          out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + f(fl.wid * 0.45) + '" fill="' + fl.tip + '"/>';
        }
      }
    }
    out += '<circle r="' + fl.cr + '" fill="' + fl.center + '"/>';
    for (var d = 0; d < 7; d++) { var q = rot(0, fl.cr * 0.5, d * 51); out += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="1.3" fill="rgba(0,0,0,.18)"/>'; }
    return out;
  }

  function cluster(fl) {
    var out = '<path d="M0 46 C-2 20 2 6 0 -6" stroke="' + STEM + '" stroke-width="3" fill="none"/>';
    // 黄金角で丸く並べる（どの花も同じ並びになり、毎回同じ絵になる）
    for (var i = 0; i < fl.count; i++) {
      var r = 8 + 26 * Math.sqrt((i + 0.5) / fl.count), a = i * 137.5;
      var p = rot(0, -r, a);
      var x = p[0], y = f(p[1] - 6);
      if (fl.star) {
        for (var k = 0; k < 4; k++) out += '<ellipse cx="' + x + '" cy="' + f(y - fl.r * 0.6) + '" rx="' + f(fl.r * 0.5) + '" ry="' + f(fl.r * 0.75) + '" transform="rotate(' + (k * 90 + i * 10) + ' ' + x + ' ' + y + ')" fill="' + fl.color + '"/>';
      } else {
        out += '<circle cx="' + x + '" cy="' + y + '" r="' + fl.r + '" fill="' + fl.color + '" stroke="' + fl.edge + '" stroke-width="1"/>';
      }
    }
    return out;
  }

  function stem(h) {
    return '<path d="M0 ' + h + ' C-3 28 3 18 0 6" stroke="' + STEM + '" stroke-width="3.2" fill="none"/>' +
      '<path d="M0 34 C-16 26 -20 14 -22 8 C-10 10 -2 20 0 30Z" fill="' + LEAF + '"/>';
  }

  function draw(fl) {
    switch (fl.kind) {
      case 'ring': return ring(fl);
      case 'cluster': return cluster(fl);
      case 'tulip':
        return stem(48) + '<path d="M-17 -2 C-20 -24 -10 -36 0 -30 C10 -36 20 -24 17 -2 C12 10 -12 10 -17 -2Z" fill="' + fl.color + '" stroke="' + fl.edge + '"/>' +
          '<path d="M0 -30 C-6 -18 -6 -4 0 6 C6 -4 6 -18 0 -30Z" fill="' + fl.edge + '" opacity=".45"/>';
      case 'bells':
        var b = '<path d="M-14 44 C-12 14 0 -12 18 -24" stroke="' + STEM + '" stroke-width="2.6" fill="none"/>' +
          '<path d="M-14 44 C-30 20 -26 -10 -18 -24 C-8 0 -8 24 -14 44Z" fill="' + LEAF + '"/>';
        var pts = [[-8, 12], [0, -2], [9, -13], [17, -22]];
        for (var i = 0; i < pts.length; i++) {
          var x = pts[i][0], y = pts[i][1];
          b += '<path d="M' + (x - 7) + ' ' + (y + 12) + ' C' + (x - 8) + ' ' + y + ' ' + (x + 8) + ' ' + y + ' ' + (x + 7) + ' ' + (y + 12) + ' C' + (x + 4) + ' ' + (y + 15) + ' ' + (x - 4) + ' ' + (y + 15) + ' ' + (x - 7) + ' ' + (y + 12) + 'Z" fill="' + fl.color + '" stroke="' + fl.edge + '"/>';
        }
        return b;
      case 'layers':
        // 丸い花びらが幾重にも重なる
        var o = '';
        for (var r = 0; r < fl.rings; r++) {
          var cnt = 11 - r * 1.5 | 0, ln = 36 - r * 6.5, wd = 11 - r * 1.2;
          for (var q = 0; q < cnt; q++) o += '<path d="' + petalPath(ln, wd, {}) + '" transform="rotate(' + f(q * 360 / cnt + r * 17) + ')" fill="' + (r % 2 ? '#FBD3BE' : fl.color) + '" stroke="' + fl.edge + '" stroke-width=".9"/>';
        }
        return o + '<circle r="4" fill="' + fl.edge + '" opacity=".7"/>';
      case 'freesia':
        var s = '<path d="M-26 40 C-10 22 8 6 30 -12" stroke="' + STEM + '" stroke-width="3" fill="none"/>';
        var fp = [[-14, 26, 1], [0, 13, 0.95], [14, 0, 0.85], [26, -10, 0.65]];
        for (var j = 0; j < fp.length; j++) {
          var sc = fp[j][2];
          s += '<g transform="translate(' + fp[j][0] + ' ' + fp[j][1] + ') scale(' + sc + ') rotate(-30)">' +
            '<path d="M0 0 C-14 -6 -16 -26 0 -30 C16 -26 14 -6 0 0Z" fill="' + fl.color + '" stroke="' + fl.edge + '"/>' +
            '<path d="M0 -4 C-6 -10 -6 -22 0 -26" stroke="' + fl.edge + '" fill="none"/></g>';
        }
        return s;
      case 'sweetpea':
        return stem(48) + '<path d="M0 0 C-30 -4 -34 -34 -10 -36 C0 -36 2 -20 0 0Z" fill="' + fl.color + '" stroke="' + fl.edge + '"/>' +
          '<path d="M0 0 C30 -4 34 -34 10 -36 C0 -36 -2 -20 0 0Z" fill="#D9C8F0" stroke="' + fl.edge + '"/>' +
          '<path d="M-8 4 C-4 -14 4 -14 8 4 C4 10 -4 10 -8 4Z" fill="' + fl.edge + '" opacity=".8"/>';
      case 'violet':
        var v = stem(48);
        var vp = [[-30, 18, 22], [30, 18, 22], [-70, 22, 18], [70, 22, 18], [180, 26, 20]];
        for (var k = 0; k < vp.length; k++) v += '<path d="' + petalPath(vp[k][1], vp[k][2] * 0.6, {}) + '" transform="rotate(' + vp[k][0] + ')" fill="' + (k === 4 ? '#A895DA' : fl.color) + '" stroke="' + fl.edge + '"/>';
        return v + '<circle r="4.5" fill="' + fl.center + '"/>';
      case 'dahlia':
        var dd = '';
        var lay = [[16, 36, 8, fl.color], [16, 27, 7, '#EB98BC'], [12, 18, 6, '#F3B6D0'], [8, 10, 4.5, '#F8CFE0']];
        for (var m = 0; m < lay.length; m++) {
          for (var n = 0; n < lay[m][0]; n++) dd += '<path d="' + petalPath(lay[m][1], lay[m][2], { point: true }) + '" transform="rotate(' + f(n * 360 / lay[m][0] + m * 11) + ')" fill="' + lay[m][3] + '" stroke="' + fl.edge + '" stroke-width=".8"/>';
        }
        return dd;
      case 'rose':
        var ro = '<path d="M0 50 C-3 32 3 24 0 16" stroke="' + STEM + '" stroke-width="3.2" fill="none"/>' +
          '<path d="M0 38 C14 32 22 22 24 14 C12 16 4 24 0 34Z" fill="' + LEAF + '"/>';
        var rl = [[5, 32, 19, fl.color, 0], [5, 24, 15, '#F7D27A', 36], [4, 16, 11, '#F9DD94', 10]];
        for (var t = 0; t < rl.length; t++) {
          for (var u = 0; u < rl[t][0]; u++) ro += '<path d="' + petalPath(rl[t][1], rl[t][2], {}) + '" transform="rotate(' + f(u * 360 / rl[t][0] + rl[t][4]) + ')" fill="' + rl[t][3] + '" stroke="' + fl.edge + '" stroke-width="1"/>';
        }
        return ro + '<path d="M-6 2 C-8 -6 0 -10 5 -6 C9 -2 6 4 1 5" fill="none" stroke="' + fl.edge + '" stroke-width="2"/>' +
          '<path d="M-2 1 C-2 -3 2 -4 3 -1" fill="none" stroke="' + fl.edge + '" stroke-width="1.6"/>';
    }
    return '';
  }

  // 読み上げでは、花の名前を文字で伝える（絵そのものは読み上げない）
  function flowerSvg(day, size) {
    var fl = FLOWERS[day];
    if (!fl) return '';
    size = size || 96;
    return '<svg class="flower" viewBox="-50 -50 100 100" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false">' +
      '<circle r="48" fill="#FFF3C8" opacity=".7"/>' + draw(fl) + '</svg>';
  }

  function flowerName(day) { return FLOWERS[day] ? FLOWERS[day].name : ''; }

  window.MichiruFlowers = { svg: flowerSvg, name: flowerName, count: FLOWERS.length - 1 };
})();
