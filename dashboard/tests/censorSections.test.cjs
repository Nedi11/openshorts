// The editor's list must match word_censor.sections (tests/custom/test_word_censor.py).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const vm = require('node:vm');
const result = buildSync({entryPoints:[require('node:path').join(__dirname,'../src/lib/censorSections.js')],bundle:true,write:false,format:'cjs'});
const sandbox = {module:{exports:{}}};
vm.runInNewContext(result.outputFiles[0].text, sandbox);
const {censorSections, adjust, normalizeWord, parseWords} = sandbox.module.exports;

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
