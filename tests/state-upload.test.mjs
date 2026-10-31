import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.join(process.env.ICONLAB_TEST_DEPS||process.cwd(),'package.json'));
const {Window}=await import(pathToFileURL(require.resolve('happy-dom')).href);
const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('State upload condition timed out');};
test('state cards open the matching existing input and dropped SVG updates only that endpoint, persisting the animation pair',async()=>{
 const w=new Window({url:'http://localhost/',settings:{disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true,disableCSSFileLoading:true}});
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');w.document.documentElement.innerHTML=html.replace(/<!doctype html>/i,'').replace(/<html[^>]*>|<\/html>/g,'');
 for(const name of ['window','document','navigator','localStorage','sessionStorage','DOMParser','XMLSerializer','CustomEvent','FormData','File','Event'])Object.defineProperty(globalThis,name,{value:name==='window'?w:w[name],configurable:true,writable:true});
 globalThis.matchMedia=w.matchMedia.bind(w);globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w);globalThis.fetch=async url=>new Response(await fs.readFile(new URL('../'+url,import.meta.url)));
 try{
  await import('../app.js');const d=w.document;
  await wait(()=>w.iconflow&&d.querySelector('.catalog-card'));
  await wait(()=>JSON.parse(w.localStorage.getItem('iconflow-v1')).custom.favoriteOn);
  d.querySelector('[data-mode="state"]').click();
  const cards=()=>d.querySelectorAll('.state-source');
  assert.equal(cards().length,2);assert.equal(cards()[0].tagName,'BUTTON');assert.equal(cards()[0].type,'button');assert.match(cards()[0].textContent,/上传.*替换/);
  const clicked=[];d.getElementById('from-input').click=()=>clicked.push('from');d.getElementById('to-input').click=()=>clicked.push('to');
  cards()[0].click();cards()[1].click();assert.deepEqual(clicked,['from','to']);
  const fromBefore=w.iconflow.state.from,toBefore=w.iconflow.state.to;
  const drop=async(side,name,markup)=>{const card=d.querySelector(`[data-side="${side}"]`);const event=new w.Event('drop',{bubbles:true,cancelable:true});event.dataTransfer={files:[new w.File([markup],name,{type:'image/svg+xml'})]};card.dispatchEvent(event);assert.equal(event.defaultPrevented,true);};
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2L22 2L12 22Z" fill="#ff4466"/></svg>';
  await drop('from','起始测试.svg',svg);await wait(()=>w.iconflow.state.from!==fromBefore);
  assert.equal(w.iconflow.state.to,toBefore);assert.match(cards()[0].textContent,/起始测试/);assert.match(d.getElementById('icon-stage').innerHTML,/#ff4466/);
  const uploadedFrom=w.iconflow.state.from;
  await drop('to','目标测试.svg',svg.replace('#ff4466','#3478ff'));await wait(()=>w.iconflow.state.to!==toBefore);
  assert.equal(w.iconflow.state.from,uploadedFrom);assert.match(cards()[1].textContent,/目标测试/);
  const stored=JSON.parse(w.localStorage.getItem('iconflow-v1'));
  assert.deepEqual(stored.state.statePair,[w.iconflow.state.from,w.iconflow.state.to]);assert.match(stored.custom[stored.state.from].markup,/#ff4466/);assert.match(stored.custom[stored.state.to].markup,/#3478ff/);
  const before=w.iconflow.state.to;await drop('to','损坏.svg','<svg>');await wait(()=>d.getElementById('toast').textContent.includes('SVG'));assert.equal(w.iconflow.state.to,before,'invalid upload retains the old endpoint');
  d.getElementById('swap').click();assert.equal(w.iconflow.state.to,uploadedFrom);assert.match(cards()[1].textContent,/起始测试/);
  const progress=d.getElementById('progress');progress.value='500';progress.dispatchEvent(new w.Event('input'));assert.equal(d.getElementById('progress-label').textContent,'50%');assert.ok(d.getElementById('icon-stage').querySelector('svg'));
  w.iconflow.stop();
 }finally{await w.happyDOM.abort();}
});
