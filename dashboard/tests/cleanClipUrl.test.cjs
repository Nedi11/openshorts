// The hook/caption preview's base video URL must survive "$" in titles.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const vm = require('node:vm');
const result = buildSync({entryPoints:[require('node:path').join(__dirname,'../src/lib/cleanClipUrl.js')],bundle:true,write:false,format:'cjs'});
const sandbox = {module:{exports:{}}};
vm.runInNewContext(result.outputFiles[0].text, sandbox);
const {cleanClipPath} = sandbox.module.exports;

test('titles with $$, $& and $1 keep their file name', () => {
  const job = '/videos/97717385-f515-4b46-a5d9-0251d1c0aad2/';
  // The reported clip: "$$" was collapsed to "$" and the preview video 404ed.
  assert.equal(cleanClipPath(`${job}subtitled_1793990177_hooked_1793990178_THIS_WATCH_BRAND_MAKES_MORE_$$_THAN_ROLEX_clip_1.mp4`),
    `${job}THIS_WATCH_BRAND_MAKES_MORE_$$_THAN_ROLEX_clip_1.mp4`);
  assert.equal(cleanClipPath('/videos/j/hooked_1_A_$&_B_clip_1.mp4'), '/videos/j/A_$&_B_clip_1.mp4');
  assert.equal(cleanClipPath('/videos/j/subtitled_2_$1_off_clip_2.mp4'), '/videos/j/$1_off_clip_2.mp4');
  assert.equal(cleanClipPath(''), '');
});
