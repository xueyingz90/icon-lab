import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.join(process.env.ICONLAB_TEST_DEPS || process.cwd(),'package.json'));
const {Window}=await import(pathToFileURL(require.resolve('happy-dom')).href);
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('DOM condition timed out');};
test('actual page modules boot; local asset registration, search, version update and legacy navigation work',async()=>{
 const w=new Window({url:'http://localhost/',settings:{disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true,disableCSSFileLoading:true}});
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 w.document.documentElement.innerHTML=html.replace(/<!doctype html>/i,'').replace(/<html[^>]*>|<\/html>/g,'');
 for(const name of ['window','document','localStorage','sessionStorage','DOMParser','XMLSerializer','CustomEvent','FormData','File','Event'])Object.defineProperty(globalThis,name,{value:name==='window'?w:w[name],configurable:true,writable:true});
 globalThis.matchMedia=w.matchMedia.bind(w);globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w);globalThis.prompt=()=>null;
 globalThis.fetch=async url=>new Response(await fs.readFile(new URL('../'+url,import.meta.url)));
 const errors=[];const originalError=console.error;console.error=(...args)=>errors.push(args.join(' '));
 try {
  await import('../app.js');
  const d=w.document;
  await wait(()=>d.querySelectorAll('.catalog-card').length>0);
  assert.equal(d.querySelectorAll('.catalog-card').length,6);assert.equal(d.getElementById('catalog-view').hidden,false);
  assert.equal(d.getElementById('catalog-connect'),null);
  assert.equal(d.getElementById('catalog-connection').open,false);
  // Choose a real bundled icon via the existing library and register it into the new catalog.
  d.querySelector('[data-mode="library"]').click();assert.equal(d.getElementById('catalog-view').hidden,true);assert.equal(d.getElementById('library-view').hidden,false);
  Array.from(d.querySelectorAll('.library-actions button')).find(b=>b.textContent==='登记到资产库').click();
  assert.ok(d.getElementById('catalog-upload').open);const form=d.getElementById('catalog-upload-form');form.elements.namedItem('name').value='跨端收藏';form.elements.namedItem('tags').value='书签,收藏';
  form.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
  await wait(()=>d.getElementById('catalog-detail').open);
  assert.equal(d.getElementById('catalog-detail-title').textContent,'跨端收藏');
  const search=d.getElementById('catalog-search');search.value='书签';search.dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('.catalog-card').length,1);
  const edit=Array.from(d.querySelectorAll('#catalog-detail-actions button')).find(b=>b.textContent==='更新版本');edit.click();form.elements.namedItem('note').value='修改后仍保留 v1';form.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
  await wait(()=>d.querySelectorAll('.catalog-history>div').length===2);
  const records=JSON.parse(w.localStorage.getItem('iconlab.catalog.local.v1'));const asset=records.find(a=>a.name==='跨端收藏');assert.equal(asset.version,2);assert.equal(asset.revisions[1].note,'');
  d.getElementById('catalog-detail').close();d.querySelector('[data-mode="state"]').click();assert.equal(d.getElementById('workspace').hidden,false);assert.equal(d.getElementById('state-spec').hidden,false);assert.equal(d.getElementById('catalog-view').hidden,true);
  // Exercise the real connection form and account switching against an explicit mock transport.
  const cloudAsset={...asset,id:'cloud-asset',name:'云端资产',revisions:undefined};
  globalThis.fetch=async(url,opts)=>{
   if(String(url).includes('/auth/v1/token'))return new Response(JSON.stringify({access_token:'user-token',refresh_token:'refresh',expires_in:3600,user:{id:'owner',email:'owner@example.com'}}));
   if(String(url).includes('/auth/v1/logout'))return new Response('{}');
   if(String(url).includes('/il_workspaces'))return new Response(JSON.stringify([{id:'space',name:'共享空间',owner_id:'owner'}]));
   if(String(url).includes('/il_members'))return new Response('[{"role":"owner"}]');
   if(String(url).includes('/il_assets'))return new Response(JSON.stringify([cloudAsset]));
   throw Error('Unexpected request '+url);
  };
  w.location.hash='#account-settings';w.dispatchEvent(new w.Event('hashchange'));
  assert.equal(d.getElementById('catalog-view').hidden,false);
  assert.equal(d.getElementById('catalog-connection').open,true);
  assert.equal(d.getElementById('catalog-advanced').open,false);
  assert.equal(d.getElementById('catalog-config-form').parentElement.id,'catalog-advanced');
  d.getElementById('catalog-advanced').open=true;
  d.getElementById('catalog-url').value='https://test.supabase.co';d.getElementById('catalog-key').value='sb_publishable_test';
  d.getElementById('catalog-config-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  d.getElementById('catalog-email').value='owner@example.com';d.getElementById('catalog-password').value='test-password';
  d.getElementById('catalog-auth-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await wait(()=>d.getElementById('catalog-mode').textContent.includes('已登录'));
  search.value='';search.dispatchEvent(new w.Event('input'));
  await wait(()=>d.querySelectorAll('.catalog-card').length===1);
  assert.match(d.getElementById('catalog-grid').textContent,/云端资产/);
  d.getElementById('catalog-signout').click();
  await wait(()=>d.getElementById('catalog-mode').textContent.includes('本地试用'));
  assert.equal(d.querySelectorAll('.catalog-card').length,7);
  assert.equal(JSON.parse(w.localStorage.getItem('iconlab.catalog.local.v1')).find(a=>a.name==='跨端收藏').version,2);
  assert.ok(w.iconflow.state);assert.deepEqual(errors,[]);
 } catch(e) {originalError('PAGE ERRORS', errors, w.document.getElementById('catalog-message')?.textContent, w.document.getElementById('toast')?.textContent);throw e;} finally {console.error=originalError;await w.happyDOM.abort();}
});
