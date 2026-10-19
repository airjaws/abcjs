/**
 * devstudio 포팅(RTM R-J27) — 악보 편집 명령 다리. window.__score
 * score.html 의 ABCJS.Editor(문자 악보 ↔ 오선보)를 평범한 값으로 부르는 명령으로 노출한다(devstudio 어댑터 abcjs → MCP 도구 · BYOAI).
 * MIDI 는 abcjs 가 만들고, 소리(wav) 렌더는 연결부(fluidsynth) 몫.
 */
(function (w) {
  var ta = function () { return document.getElementById('abc'); };
  var ed = function () { return w.scoreEditor; };
  var tune = function () { var t = ed() && ed().tunes && ed().tunes[0]; if (!t) { throw new Error('악보가 없습니다 — abc_set 먼저'); } return t; };
  // 편집기는 바뀐 글을 비동기로 다시 그린다 — 새 곡 객체가 생길 때까지 기다린 뒤 정보를 돌려준다
  async function setText(text) {
    var old = ed().tunes && ed().tunes[0];
    ta().value = text;
    ed().fireChanged();   // 사람이 친 것과 같은 경로
    for (var i = 0; i < 100 && ed().tunes && ed().tunes[0] === old; i++) { await new Promise(function (r) { setTimeout(r, 30); }); }
    return api.info();
  }
  function warnings() {
    var out = [];
    (ed().tunes || []).forEach(function (t) { (t.warnings || []).forEach(function (x) { out.push(String(x).replace(/<[^>]+>/g, '')); }); });
    return out.slice(0, 30);
  }
  var api = {
    ready: function () { return !!(w.ABCJS && ed() && ed().tunes && ed().tunes.length); },
    get: function () { return ta().value; },
    set: function (text) { return setText(String(text)); },
    patch: function (find, repl, all) {
      var v = ta().value;
      if (v.indexOf(find) < 0) { throw new Error('찾는 글이 악보에 없습니다: ' + find.slice(0, 60)); }
      return setText(all ? v.split(find).join(repl) : v.replace(find, repl));
    },
    info: function () {
      var t = tune(), m = t.getMeterFraction ? t.getMeterFraction() : null, k = t.getKeySignature ? t.getKeySignature() : null, bars = 0;
      (t.lines || []).forEach(function (l) { (l.staff || []).slice(0, 1).forEach(function (s) { (s.voices || []).slice(0, 1).forEach(function (v) { v.forEach(function (el) { if (el.el_type === 'bar') { bars++; } }); }); }); });
      return {
        title: (t.metaText && t.metaText.title) || '', meter: m ? m.num + '/' + m.den : null, key: k ? (k.root + (k.acc === 'sharp' ? '#' : k.acc === 'flat' ? 'b' : '') + (k.mode || '')) : null,
        tempo: t.getBpm ? Math.round(t.getBpm()) : null, seconds: t.millisecondsPerMeasure ? Math.round(t.millisecondsPerMeasure() * bars / 100) / 10 : null, bars: bars,
        voices: (t.lines && t.lines[0] && t.lines[0].staff) ? t.lines[0].staff.length : 0, tunes: ed().tunes.length, warnings: warnings()
      };
    },
    transpose: function (semis) {
      var out = w.ABCJS.strTranspose(ta().value, ed().tunes, semis);
      return setText(out);
    },
    // 오선보 PNG — 그려진 SVG 를 그림으로(흰 바탕)
    preview: function (width) {
      var svgs = document.querySelectorAll('#paper svg'); if (!svgs.length) { throw new Error('그려진 악보가 없습니다'); }
      var svg = svgs[0], box = svg.getBoundingClientRect(), W = Math.round(width || Math.max(800, box.width)), H = Math.round(W * box.height / Math.max(1, box.width));
      var clone = svg.cloneNode(true); clone.setAttribute('width', W); clone.setAttribute('height', H);
      if (!clone.getAttribute('viewBox')) { clone.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height); }
      var xml = new XMLSerializer().serializeToString(clone);
      return new Promise(function (ok, no) {
        var img = new Image();
        img.onload = function () { var c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); ok(c.toDataURL('image/png').split(',')[1]); };
        img.onerror = function () { no(new Error('악보 그림 변환 실패')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      });
    },
    svg: function () { var s = document.querySelector('#paper svg'); if (!s) { throw new Error('그려진 악보가 없습니다'); } return new XMLSerializer().serializeToString(s); },
    // 미니 피아노 입력(사람이 건반을 누른 것과 같은 함수) — keys: [{pitch, len, dot}] 또는 {rest:true,len} 또는 {bar:true}
    piano: async function (keys) {
      var p = w.scorePiano, old = ed().tunes && ed().tunes[0], out = [];
      p.state.play = false;   // 화면 없는 편집기에서는 소리 안 냄
      try {
        (keys || []).forEach(function (k) { out.push(k.bar ? p.bar() : k.rest ? p.rest(k.len, k.dot) : p.press(k.pitch, k.len, k.dot)); });
      } finally { p.state.play = true; }
      for (var i = 0; i < 100 && ed().tunes && ed().tunes[0] === old; i++) { await new Promise(function (r) { setTimeout(r, 30); }); }
      return { inserted: out.map(function (x) { return x.inserted; }).join(''), info: api.info() };
    },
    midi: function () {
      var bin = w.ABCJS.synth.getMidiFile(ta().value, { midiOutputType: 'binary' })[0];
      var s = ''; for (var i = 0; i < bin.length; i++) { s += String.fromCharCode(bin[i]); }
      return btoa(s);
    }
  };
  Object.keys(api).forEach(function (k) {
    var f = api[k];
    api[k] = function () { try { var r = f.apply(this, arguments); return r && r.then ? r.catch(function (e) { throw new Error(String((e && e.message) || e)); }) : r; } catch (e) { throw new Error(String((e && e.message) || e)); } };
  });
  w.__score = api;
})(window);
