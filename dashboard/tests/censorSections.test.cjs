// The editor's list must match word_censor.sections (tests/custom/test_word_censor.py).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const vm = require('node:vm');
const result = buildSync({entryPoints:[require('node:path').join(__dirname,'../src/lib/censorSections.js')],bundle:true,write:false,format:'cjs'});
const sandbox = {module:{exports:{}}};
vm.runInNewContext(result.outputFiles[0].text, sandbox);
const {censorSections, adjust, moveEdge, resetWord, normalizeWord, parseWords} = sandbox.module.exports;

// Objects come from the vm sandbox's realm, so compare as JSON.
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const WORDS = [{w:'hello',s:0,e:1},{w:'Shit!',s:1,e:1.5},{w:'ship',s:2,e:3}];

test('default padding starts the section before the transcript timing', () => {
  const [sec] = censorSections(WORDS, ['shit'], [{start:0,end:3}], 0.15, 0.05, {});
  assert.deepEqual([sec.key, sec.start, sec.end], ['1.000', 0.85, 1.55]);
});

test('nudges, clamping and skip mirror the server', () => {
  let adj = adjust({}, '1.000', 'before', 0.2);
  adj = adjust(adj, '1.000', 'after', -0.1);
  const [sec] = censorSections(WORDS, ['shit'], [{start:0,end:3}], 0.1, 0, adj);
  assert.deepEqual([sec.start, sec.end], [0.7, 1.4]);
  assert.equal(censorSections(WORDS, ['shit'], [{start:0.9,end:3}], 1, 0.05, {})[0].start, 0.9);
  const skipped = adjust({}, '1.000', 'skip', true);
  assert.equal(censorSections(WORDS, ['shit'], [{start:0,end:3}], 0.15, 0.05, skipped)[0].skip, true);
  // Back to zero drops the entry, so an untouched word sends nothing.
  same(adjust(adj, '1.000', 'before', 0), {'1.000': {before: 0, after: -0.1, skip: false}});
  same(adjust(adjust({}, '1.000', 'after', 0.05), '1.000', 'after', 0), {});
});

test('clip timeline follows segment order', () => {
  const two = [{w:'shit',s:1,e:1.5},{w:'shit',s:5,e:5.5}];
  const secs = censorSections(two, ['shit'], [{start:4,end:6},{start:0,end:2}], 0, 0, {});
  same(secs.map((s) => [s.key, s.clipStart]), [['5.000', 1], ['1.000', 3]]);
});

test('word normalisation matches word_censor.normalize', () => {
  assert.equal(normalizeWord("'Scheiße!'"), 'scheiße');
  assert.equal(normalizeWord("Don't,"), "don't");
  same(parseWords(' fuck, ,shit '), ['fuck', 'shit']);
});

test('the reported crossed case is flagged, and reset or widening repairs it', () => {
  // "fuck" 238.08-238.20, lead 0.5, start 1.0 s later, end 0.85 s earlier.
  const word = [{w:'fuck', s:238.08, e:238.2}];
  const seg = [{start:157.74, end:239.369}];
  const broken = {'238.080': {before:-1, after:-0.85, skip:false}};
  const [sec] = censorSections(word, ['fuck'], seg, 0.5, 0.05, broken);
  assert.equal(sec.crossed, true);
  // Shrinking further is refused; widening is allowed.
  assert.equal(moveEdge(broken, sec, 'start', 0.05), null);
  assert.notEqual(moveEdge(broken, sec, 'start', -0.05), null);
  const [fixed] = censorSections(word, ['fuck'], seg, 0.5, 0.05, resetWord(broken, '238.080'));
  assert.deepEqual([fixed.crossed, fixed.start, fixed.end], [false, 237.58, 238.25]);
});

test('edge moves stop at the minimum length; move shifts both edges', () => {
  const [sec] = censorSections(WORDS, ['shit'], [{start:0,end:3}], 0, 0, {});   // 0.5 s long, 0.05 s steps
  let adj = {};
  let current = sec;
  for (let i = 0; i < 20; i++) {
    const next = moveEdge(adj, current, 'start', 0.05);
    if (!next) break;
    adj = next;
    [current] = censorSections(WORDS, ['shit'], [{start:0,end:3}], 0, 0, adj);
  }
  // 0.05 s steps stop at 0.05 s (one more would reach zero); 0.01 s steps go to 0.01 s.
  assert.ok(Math.abs(current.end - current.start - 0.05) < 1e-9);
  const fine = moveEdge(adj, current, 'end', -0.01);
  [current] = censorSections(WORDS, ['shit'], [{start:0,end:3}], 0, 0, fine);
  assert.ok(Math.abs(current.end - current.start - 0.04) < 1e-9);
  const [moved] = censorSections(WORDS, ['shit'], [{start:0,end:3}], 0, 0, moveEdge({}, sec, 'move', 0.05));
  assert.deepEqual([moved.start, moved.end], [1.05, 1.55]);
});

test('per-word moves go past one second', () => {
  const [sec] = censorSections(WORDS, ['shit'], [{start:0,end:3}], 0, 0, {});
  let adj = {};
  let cur = sec;
  for (let i = 0; i < 30; i++) { adj = moveEdge(adj, cur, 'end', 0.05); [cur] = censorSections(WORDS, ['shit'], [{start:0,end:3}], 0, 0, adj); }
  assert.equal(adj['1.000'].after, 1.5);
  assert.equal(cur.end, 3);   // clamped by the segment, not by a nudge limit
});

test('a 0.07 s section shrinks to 0.02 s and is still applied', () => {
  const word = [{w:'shit', s:80.9, e:80.95}];
  const seg = [{start:0, end:100}];
  let [sec] = censorSections(word, ['shit'], seg, 0.01, 0.01, {});   // 80.89-80.96
  assert.deepEqual([sec.start, sec.end], [80.89, 80.96]);
  let adj = {};
  for (const [edge, d] of [['start', 0.01], ['start', 0.01], ['end', -0.01], ['end', -0.01], ['end', -0.01]]) {
    adj = moveEdge(adj, sec, edge, d);
    [sec] = censorSections(word, ['shit'], seg, 0.01, 0.01, adj);
  }
  assert.deepEqual([sec.start, sec.end, sec.crossed, sec.tooShort], [80.91, 80.93, false, false]);
  assert.equal(moveEdge(adj, sec, 'end', -0.02), null);   // would leave nothing
});
