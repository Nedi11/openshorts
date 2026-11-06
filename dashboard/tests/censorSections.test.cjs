// The editor's list must match word_censor.sections (tests/custom/test_word_censor.py).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const vm = require('node:vm');
const result = buildSync({entryPoints:[require('node:path').join(__dirname,'../src/lib/censorSections.js')],bundle:true,write:false,format:'cjs'});
const sandbox = {module:{exports:{}}};
vm.runInNewContext(result.outputFiles[0].text, sandbox);
const {censorSections, setSkip, moveEdge, resetWord, normalizeWord, parseWords} = sandbox.module.exports;

// Objects come from the vm sandbox's realm, so compare as JSON.
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const WORDS = [{w:'hello',s:0,e:1},{w:'Shit!',s:1,e:1.5},{w:'ship',s:2,e:3}];
const SEG = [{start:0,end:3}];
const one = (pb, pa, adj, segs = SEG, words = WORDS) => censorSections(words, ['shit'], segs, pb, pa, adj)[0];

test('default padding starts the section before the transcript timing', () => {
  const sec = one(0.15, 0.05, {});
  same([sec.key, sec.start, sec.end, sec.manualStart, sec.manualEnd], ['1.000', 0.85, 1.55, false, false]);
});

test('hand-set edges keep their time when the presets change; the other edge follows', () => {
  let sec = one(0.15, 0.05, {});
  const adj = moveEdge({}, sec, 'start', -0.1);        // start 0.85 -> 0.75, by hand
  same(adj, {'1.000': {start: 0.75}});
  sec = one(0.5, 0.3, adj);                             // presets raised afterwards
  same([sec.start, sec.manualStart, sec.end, sec.manualEnd], [0.75, true, 1.8, false]);
  sec = one(0, 0, adj);                                 // and lowered
  same([sec.start, sec.end], [0.75, 1.5]);
  // Moving the whole section fixes both edges.
  const moved = moveEdge(adj, one(0, 0, adj), 'move', 0.05);
  same(moved, {'1.000': {start: 0.8, end: 1.55}});
  same([one(0.4, 0.4, moved).start, one(0.4, 0.4, moved).end], [0.8, 1.55]);
});

test('reset and skip', () => {
  const adj = setSkip(moveEdge({}, one(0.15, 0.05, {}), 'end', 0.25), '1.000', true);
  same(adj, {'1.000': {end: 1.8, skip: true}});
  same(resetWord(adj, '1.000'), {'1.000': {skip: true}});
  same(resetWord(setSkip(adj, '1.000', false), '1.000'), {});
  assert.equal(one(0.15, 0.05, adj).skip, true);
});

test('legacy relative offsets saved before hand-set edges are still read', () => {
  const sec = one(0.1, 0, {'1.000': {before: 0.2, after: -0.1}});
  same([sec.start, sec.end], [0.7, 1.4]);
  near(one(1, 0.05, {}, [{start:0.9,end:3}]).start, 0.9);   // clamped to the segment
});

test('the reported crossed case is flagged, and widening or reset repairs it', () => {
  // "fuck" 238.08-238.20, lead 0.5, legacy start 1.0 s later, end 0.85 s earlier.
  const word = [{w:'shit', s:238.08, e:238.2}];
  const seg = [{start:157.74, end:239.369}];
  const broken = {'238.080': {before:-1, after:-0.85}};
  const sec = one(0.5, 0.05, broken, seg, word);
  assert.equal(sec.crossed, true);
  assert.equal(moveEdge(broken, sec, 'start', 0.05), null);       // shrinking further: refused
  const widened = moveEdge(broken, sec, 'start', -1.3);          // start earlier, by hand
  same(widened, {'238.080': {after: -0.85, start: 237.28}});
  assert.equal(one(0.5, 0.05, widened, seg, word).crossed, false);
  const fixed = one(0.5, 0.05, resetWord(broken, '238.080'), seg, word);
  same([fixed.crossed, fixed.start, fixed.end], [false, 237.58, 238.25]);
});

test('sections shrink to 0.01 s; 0.05 s steps stop before reaching zero', () => {
  let sec = one(0, 0, {});                                        // 0.5 s long
  let adj = {};
  for (let i = 0; i < 20; i++) {
    const next = moveEdge(adj, sec, 'start', 0.05);
    if (!next) break;
    adj = next;
    sec = one(0, 0, adj);
  }
  near(sec.end - sec.start, 0.05);
  sec = one(0, 0, moveEdge(adj, sec, 'end', -0.04));
  near(sec.end - sec.start, 0.01);
  assert.equal(sec.crossed, false);
});

test('a 0.07 s section shrinks to 0.02 s and is still applied', () => {
  const word = [{w:'shit', s:80.9, e:80.95}];
  const seg = [{start:0, end:100}];
  let sec = one(0.01, 0.01, {}, seg, word);
  same([sec.start, sec.end], [80.89, 80.96]);
  let adj = {};
  for (const [edge, d] of [['start', 0.01], ['start', 0.01], ['end', -0.01], ['end', -0.01], ['end', -0.01]]) {
    adj = moveEdge(adj, sec, edge, d);
    sec = one(0.01, 0.01, adj, seg, word);
  }
  same([sec.start, sec.end, sec.crossed, sec.tooShort], [80.91, 80.93, false, false]);
  assert.equal(moveEdge(adj, sec, 'end', -0.02), null);           // would leave nothing
});

test('hand-set edges go well past one second', () => {
  const sec = one(0, 0, moveEdge({}, one(0, 0, {}), 'end', 1.5));
  same([sec.rawEnd, sec.end], [3, 3]);                            // clamped by the segment only
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

test('millisecond steps move an edge by exactly 0.001 s', () => {
  let sec = one(0.15, 0.05, {});                                  // 0.85-1.55
  let adj = {};
  for (let i = 0; i < 3; i++) { adj = moveEdge(adj, sec, 'start', 0.001); sec = one(0.15, 0.05, adj); }
  same(adj, {'1.000': {start: 0.853}});
  adj = moveEdge(adj, sec, 'end', -0.005);
  same([one(0.15, 0.05, adj).start, one(0.15, 0.05, adj).end], [0.853, 1.545]);
});
