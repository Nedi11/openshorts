const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const vm = require('node:vm');
const result = buildSync({entryPoints:[require('node:path').join(__dirname,'../src/lib/subtitleGeometry.js')],bundle:true,write:false,format:'cjs'});
const sandbox = {module:{exports:{}}};
vm.runInNewContext(result.outputFiles[0].text,sandbox);
const {subtitleFontPixels} = sandbox.module.exports;
test('preview uses actual per-font libass metrics and integer ASS size',()=>{
  // Independent burned-frame measurements for "Subtitle Test", fontsize 34:
  // widths Arial 995, Anton 530, Montserrat 801 pixels. Browser advances at
  // 100px are 592.627, 494.971, 670.299 respectively (within raster rounding).
  for(const [font,advance,width] of [['Arial',592.627,995],['Anton',494.971,530],['Montserrat ExtraBold',670.299,801]]) {
    assert.ok(Math.abs(subtitleFontPixels(34,font)*advance/100-width)<8,font);
  }
  assert.ok(Math.abs(subtitleFontPixels(16,'Arial')-13*1920/288*2048/2288)<1e-10);
  assert.equal(subtitleFontPixels(34,'Impact'),subtitleFontPixels(34,'Anton'));
});

test('thick outlines remain one continuous stroked glyph, with fill on top',()=>{
  const {subtitleOutline} = sandbox.module.exports;
  const outline = subtitleOutline(4*1920/288,'#000000');
  assert.equal(outline.WebkitTextStroke,`${2*4*1920/288}px #000000`);
  assert.equal(outline.paintOrder,'stroke fill');
  assert.equal(outline.textShadow,undefined);
  assert.equal(subtitleOutline(0,'#000000').WebkitTextStroke,'0px #000000');
});
