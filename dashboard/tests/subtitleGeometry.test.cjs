const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const vm = require('node:vm');
const result = buildSync({entryPoints:[require('node:path').join(__dirname,'../src/lib/subtitleGeometry.js')],bundle:true,write:false,format:'cjs'});
const sandbox = {module:{exports:{}}};
vm.runInNewContext(result.outputFiles[0].text,sandbox);
const {subtitleFontPixels, subtitleShadowCss, customCaptionBottom} = sandbox.module.exports;
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

test('sizes below Native remain distinct and match ASS sizing',()=>{
  assert.ok(subtitleFontPixels(6,'Arial') < subtitleFontPixels(8,'Arial'));
  assert.ok(subtitleFontPixels(8,'Arial') < subtitleFontPixels(16,'Arial'));
  assert.equal(subtitleFontPixels(8,'Arial'),6*1920/288*2048/2288);
});

test('preview shadow mirrors the burned shadow layer: direction, blur, colour, opacity', () => {
  const s = 1920 / 288;
  // Default 45 degrees keeps the old equal x/y offset of `shadow` units.
  assert.equal(subtitleShadowCss({shadow: 2}), `${(2 * s).toFixed(1)}px ${(2 * s).toFixed(1)}px 0.0px rgba(0,0,0,0.55)`);
  const left = subtitleShadowCss({shadow: 3, shadowAngle: 180, shadowBlur: 4, shadowColor: '#FF0000', shadowOpacity: 1});
  assert.match(left, /^-28\.3px 0\.0px 53\.3px rgba\(255,0,0,1\)$/);
  assert.match(subtitleShadowCss({shadow: 0, shadowBlur: 2}), /^0\.0px 0\.0px 26\.7px/);
  assert.equal(subtitleShadowCss({shadow: 0, shadowBlur: 0}), '');
});

test('custom caption height uses the burn margin rounding', () => {
  assert.equal(customCaptionBottom(25), 72 / 288 * 100);
  assert.equal(customCaptionBottom(500), Math.round(288 * 0.9) / 288 * 100);
});
