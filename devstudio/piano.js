/**
 * devstudio 포팅(RTM R-J27) — 악보 편집 페이지의 미니 피아노(입력 도구).
 * 건반을 누르면 소리를 내고, 문자 악보(ABC)의 커서 위치에 그 음을 넣는다. 길이·점음표·옥타브·쉼표·마디선·지우기 단추.
 * 조표를 따져 「누른 소리 그대로」 적는다 — 조표가 바꾼 음의 흰 건반은 제자리표(=), 검은 건반은 조에 맞춰 #(^)/b(_) 표기.
 * 같은 입력 함수(window.scorePiano.press)를 명령 다리(score-bridge.js → piano_input 도구)가 써서 AI 입력도 같은 경로를 탄다.
 */
(function (w) {
  var LETTERS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
  var BLACK = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
  var FLAT_OF = { 1: 'D', 3: 'E', 6: 'G', 8: 'A', 10: 'B' };   // 검은 건반의 b 표기 글자
  var LENGTHS = [['1/16', '16분'], ['1/8', '8분'], ['1/4', '4분'], ['1/2', '2분'], ['1', '온']];
  var state = { len: '1/8', dot: false, octave: 4, play: true };

  var ta = function () { return document.getElementById('abc'); };
  var frac = function (s) { var p = String(s).split('/'); return p.length > 1 ? +p[0] / +p[1] : +p[0]; };
  var gcd = function (a, b) { return b ? gcd(b, a % b) : a; };
  // 머리의 L:(기본 음 길이) — 없으면 ABC 규칙대로 1/8
  function unitLen() { var m = /^L:\s*(\d+\/\d+|\d+)\s*$/m.exec(ta().value); return m ? frac(m[1]) : 1 / 8; }
  // 길이 배수 → ABC 길이 표기(2, /2, 3/2 …)
  function lenText(len, dotted) {
    var r = frac(len) * (dotted ? 1.5 : 1) / unitLen(), den = 1;
    while (Math.abs(r * den - Math.round(r * den)) > 1e-9 && den < 64) { den *= 2; }
    var num = Math.round(r * den), g = gcd(num, den); num /= g; den /= g;
    if (den === 1) { return num === 1 ? '' : String(num); }
    return (num === 1 ? '' : String(num)) + '/' + (den === 2 && num === 1 ? '' : den);
  }
  // 조표 — 편집기가 읽은 첫 곡의 K: (조표가 바꾸는 글자 → sharp|flat)
  function keyAcc() {
    var out = {}, t = w.scoreEditor && w.scoreEditor.tunes && w.scoreEditor.tunes[0], k = t && t.getKeySignature && t.getKeySignature();
    ((k && k.accidentals) || []).forEach(function (a) { out[String(a.note).toUpperCase()] = a.acc; });
    return out;
  }
  // 같은 마디(커서 앞, 마지막 | 뒤)에서 이 음높이(글자+옥타브 표기)에 붙은 마지막 임시표 — ABC 는 임시표가 마디 끝까지 간다
  function barAcc(noteBody) {
    var el = ta(), v = el.value.slice(0, el.selectionStart === undefined ? el.value.length : el.selectionStart);
    var seg = v.slice(v.lastIndexOf('|') + 1), re = /(\^\^|\^|__|_|=)?([A-Ga-g][,']*)/g, m, last = null;
    while ((m = re.exec(seg))) { if (m[2] === noteBody && m[1]) { last = m[1] === '^' || m[1] === '^^' ? 'sharp' : m[1] === '=' ? 'natural' : 'flat'; } }
    return last;
  }
  // MIDI 음높이 → ABC 음표 — 지금 효력 있는 임시표(같은 마디 > 조표)와 비교해 필요한 표만 붙인다
  function pitchText(midi) {
    var pc = ((midi % 12) + 12) % 12, oct = Math.floor(midi / 12) - 1, acc = keyAcc(), letter, want;
    if (BLACK[pc]) {
      var flatKey = Object.keys(acc).some(function (x) { return acc[x] === 'flat'; });
      if (flatKey) { letter = FLAT_OF[pc]; want = 'flat'; } else { letter = LETTERS[pc]; want = 'sharp'; }
    } else { letter = LETTERS[pc]; want = 'natural'; }
    var body = oct >= 5 ? letter.toLowerCase() + new Array(oct - 4).join("'") : letter + new Array(Math.max(0, 4 - oct) + 1).join(',');
    var now = barAcc(body) || acc[letter] || 'natural';   // 효력 있는 상태
    var mark = now === want ? '' : want === 'sharp' ? '^' : want === 'flat' ? '_' : '=';
    return mark + body;
  }
  // 커서 위치에 넣기 — 앞 글자가 음표면 띄어 쓴다(빔을 원하면 사람이 붙이면 됨)
  function insert(text) {
    var el = ta(), a = el.selectionStart, b = el.selectionEnd, v = el.value;
    if (a === undefined || a === null || (a === 0 && b === 0 && document.activeElement !== el && !state.touched)) { a = b = v.replace(/\s*\|\]\s*$/, '').length; }   // 처음엔 끝(맺음 마디선 앞)에
    var before = v.slice(0, a), sep = /[\w,'\])\/]$/.test(before) && !/^[\s|]/.test(text) ? ' ' : '';
    el.value = before + sep + text + v.slice(b);
    var pos = a + sep.length + text.length; el.selectionStart = el.selectionEnd = pos; state.touched = true;
    w.scoreEditor.fireChanged();
    return { inserted: sep + text, at: pos };
  }
  function play(midi) {
    if (!state.play || !w.ABCJS || !w.ABCJS.synth || !w.ABCJS.synth.playEvent) { return; }
    var len = frac(state.len) * (state.dot ? 1.5 : 1);
    try { w.ABCJS.synth.playEvent([{ pitch: midi, volume: 90, start: 0, duration: Math.min(1, len * 2), instrument: 0 }], [], 1000).catch(function () {}); } catch (e) { /* 소리는 선택 */ }
  }

  var api = {
    state: state,
    pitchText: pitchText,
    lenText: lenText,
    // 건반 누르기(MIDI 음높이) — 길이는 지금 고른 길이, 또는 len·dot 로 지정
    press: function (midi, len, dot) { play(midi); return insert(pitchText(midi) + lenText(len || state.len, dot === undefined ? state.dot : dot)); },
    rest: function (len, dot) { return insert('z' + lenText(len || state.len, dot === undefined ? state.dot : dot)); },
    bar: function () { return insert(' | '); },
    backspace: function () {
      var el = ta(), a = el.selectionStart, v = el.value, before = v.slice(0, a).replace(/\s+$/, ''), m = /(\s*\|\s*|[=^_]*[A-Ga-gz][,']*[\d/]*)$/.exec(before);
      if (!m) { return { removed: '' }; }
      el.value = before.slice(0, before.length - m[0].length) + v.slice(a); el.selectionStart = el.selectionEnd = before.length - m[0].length;
      w.scoreEditor.fireChanged(); return { removed: m[0].trim() };
    },
    setLen: function (len) { state.len = len; render(); },
    setDot: function (on) { state.dot = !!on; render(); },
    setOctave: function (o) { state.octave = Math.max(2, Math.min(6, o)); render(); }
  };

  // ── 화면: 두 옥타브 건반 + 단추 ─────────────────────────
  var root;
  function btn(label, title, on, active) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.className = active ? 'on' : ''; b.addEventListener('click', on); return b; }
  function render() {
    if (!root) { return; }
    root.innerHTML = '';
    var bar = document.createElement('div'); bar.className = 'pbar';
    bar.appendChild(btn('◀', '한 옥타브 아래', function () { api.setOctave(state.octave - 1); }));
    var o = document.createElement('span'); o.className = 'oct'; o.textContent = 'C' + state.octave + '–C' + (state.octave + 2); bar.appendChild(o);
    bar.appendChild(btn('▶', '한 옥타브 위', function () { api.setOctave(state.octave + 1); }));
    LENGTHS.forEach(function (l) { bar.appendChild(btn(l[1], '음 길이 ' + l[0], function () { api.setLen(l[0]); }, state.len === l[0])); });
    bar.appendChild(btn('점', '점음표(1.5배)', function () { api.setDot(!state.dot); }, state.dot));
    bar.appendChild(btn('쉼표', '쉼표 넣기', function () { api.rest(); }));
    bar.appendChild(btn('|', '마디선', function () { api.bar(); }));
    bar.appendChild(btn('⌫', '마지막 음 지우기', function () { api.backspace(); }));
    root.appendChild(bar);
    var kb = document.createElement('div'); kb.className = 'keys';
    var base = (state.octave + 1) * 12, whites = 0;
    for (var i = 0; i < 25; i++) {
      (function (midi) {
        var pc = midi % 12, k = document.createElement('div');
        k.className = BLACK[pc] ? 'k black' : 'k white';
        if (!BLACK[pc]) { k.style.left = (whites * 28) + 'px'; whites++; } else { k.style.left = (whites * 28 - 9) + 'px'; }
        if (pc === 0) { var lab = document.createElement('span'); lab.textContent = 'C' + (Math.floor(midi / 12) - 1); k.appendChild(lab); }
        k.title = pitchText(midi);
        k.addEventListener('mousedown', function (e) { e.preventDefault(); api.press(midi); k.classList.add('down'); setTimeout(function () { k.classList.remove('down'); }, 150); });
        kb.appendChild(k);
      })(base + i);
    }
    kb.style.width = (whites * 28 + 1) + 'px';
    root.appendChild(kb);
  }
  w.scorePiano = api;
  document.addEventListener('DOMContentLoaded', function () { root = document.getElementById('piano'); render(); });
  if (document.readyState !== 'loading') { root = document.getElementById('piano'); render(); }
  // 문자 악보를 클릭하면 그 자리부터 입력(커서를 사람이 정한 것으로)
  document.addEventListener('mouseup', function (e) { if (e.target && e.target.id === 'abc') { state.touched = true; } });
})(window);
