const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
let SubtitleModal, directory, container, root, submitted;
const saved = {style:'karaoke',position:'top',font_size:16,font_name:'Arial',font_color:'#ABCDEF',
  border_color:'#123456',border_width:0,bg_color:'#000000',bg_opacity:0,highlight_color:'#FFFFFF',
  effect:'none',base_opacity:1,uppercase:false,reveal:false,shadow:1,horizontal_padding:20,max_chars:23,max_duration:1.8};

before(async () => {
  const cache = path.join(__dirname, '../node_modules/.cache');
  fs.mkdirSync(cache, { recursive:true });
  directory = fs.mkdtempSync(path.join(cache,'caption-test-'));
  const outfile = path.join(directory,'modal.cjs');
  await build({ entryPoints:[path.join(__dirname,'../src/components/SubtitleModal.jsx')],
    outfile,bundle:true,platform:'node',format:'cjs',external:['react'],
    plugins:[{name:'caption-test-adapters',setup(builder) {
      builder.onLoad({filter:/\/lib\/api\.js$/},()=>({contents:'export const apiFetch = (...args) => globalThis.captionTestFetch(...args);'}));
      builder.onLoad({filter:/\/components\/.+\.jsx$/}, args => {
        const name = path.basename(args.path);
        if (name==='SubtitleModal.jsx') return;
        if (name==='RemotionPreview.jsx') return {contents:'export default function Stub(props) {globalThis.captionPreview=props.subtitles; return null;}'};
        if (name==='Modal.jsx') return {contents:"import React from 'react'; export default props => props.isOpen ? React.createElement('div',null,props.children) : null;"};
        return {contents:'export default function Stub() {return null;}'};
      });
    }}],
  });
  SubtitleModal = require(outfile).default;
});
after(()=>{fs.rmSync(directory,{recursive:true,force:true});dom.window.close();});
beforeEach(()=>{
  submitted=null;
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  global.captionTestFetch=async()=>({ok:true,json:async()=>({
    captions:[{text:'Corrected',startMs:0,endMs:900}],durationSec:2,captionStyle:saved,
  })});
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();delete global.captionTestFetch;});
function render(open=true,key='same') {
  root.render(React.createElement(SubtitleModal,{key,isOpen:open,jobId:'job',clipIndex:0,
    onGenerate:value=>{submitted=value;},onClose:()=>{},isProcessing:false}));
}
function applyButton(){return [...container.querySelectorAll('button')].find(button=>button.textContent==='apply to this clip');}

test('saved caption settings survive closing and a hook-triggered remount',async()=>{
  await act(async()=>render());
  await act(async()=>applyButton().click());
  const first=submitted;
  assert.equal(first.fontSize,16);
  assert.equal(first.fontName,'Arial');
  assert.equal(first.borderWidth,0);
  assert.equal(first.shadow,1);
  assert.equal(first.horizontalPadding,20);
  assert.equal(first.remotion.horizontalPadding,20);
  assert.equal(first.uppercase,false);
  assert.equal(first.position,'top');
  assert.equal(first.fontColor,'#ABCDEF');
  assert.equal(first.maxChars,23);
  assert.equal(first.maxDuration,1.8);
  assert.equal(first.effect,'none');
  await act(async()=>render(false));
  await act(async()=>render(true,'after-hook'));
  await act(async()=>applyButton().click());
  assert.deepEqual(submitted,first);
  assert.equal(submitted.remotion.captions[0].text,'Corrected');
});

test('saved-settings fetch failure blocks applying defaults',async()=>{
  global.captionTestFetch=async()=>({ok:false});
  await act(async()=>render());
  assert.equal(applyButton().disabled,true);
  assert.match(container.textContent,/Could not load saved captions/);
  assert.equal(submitted,null);
});

test('apply stays disabled until saved settings arrive',async()=>{
  let resolve;
  global.captionTestFetch=()=>new Promise(done=>{resolve=done;});
  await act(async()=>render());
  assert.equal(applyButton().disabled,true);
  await act(async()=>resolve({ok:true,json:async()=>({captions:[],captionStyle:saved})}));
  assert.equal(applyButton().disabled,false);
  await act(async()=>applyButton().click());
  assert.equal(submitted.fontSize,16);
});


test('preview honors saved font geometry, zero outline and Classic static color',async()=>{
  global.captionTestFetch=async()=>({ok:true,json:async()=>({
    captions:[{text:'Test',startMs:0,endMs:900}],durationSec:2,
    captionStyle:{...saved,style:'classic',effect:'pop',highlight_color:'#FF0000'},
  })});
  await act(async()=>render());
  const preview=global.captionPreview;
  assert.equal(preview.position,'top');
  assert.equal(preview.style.animation,'none');
  assert.equal(preview.style.highlightColor,saved.font_color);
  assert.equal(preview.style.borderWidth,0);
  assert.ok(preview.style.fontSize>77 && preview.style.fontSize<78);
  await act(async()=>applyButton().click());
  assert.equal(submitted.fontSize,16);
  assert.equal(submitted.fontName,'Arial');
});

test('highlight can be turned off and regular weight survives apply',async()=>{
  global.captionTestFetch=async()=>({ok:true,json:async()=>({captions:[{text:'Test',startMs:0,endMs:900}],durationSec:2,captionStyle:{...saved,bold:false}})});
  await act(async()=>render());
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='No highlight').click());
  await act(async()=>applyButton().click());
  assert.equal(submitted.highlightEnabled,false);
  assert.equal(submitted.bold,false);
  assert.equal(submitted.remotion.style.bold,false);
  assert.equal(submitted.remotion.style.highlightColor,submitted.fontColor);
  assert.equal(submitted.remotion.style.animation,'none');
});
