import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {parseProjectBackup,restoreProject,undoProjectRestore,PROJECT_KEY,UNDO_KEY} from '../project-backup.js';
const w=new Window();globalThis.DOMParser=w.DOMParser;globalThis.XMLSerializer=w.XMLSerializer;
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2L20 20"/></svg>';
const fixture=()=>({version:1,state:{project:'我的项目',assets:[{id:1,type:'icon',name:'星星',d:'M2 2L20 20',stroke:2,color:'#252833',cap:'round',join:'round'},{id:2,type:'motion',name:'状态',from:{bitmap:'data:image/png;base64,aGVsbG8='},to:{markup:svg}}],references:[{markup:svg,vb:[0,0,24,24]}],aiSpec:{confirmed:true}},custom:{source:{name:'参考',markup:svg}}});
test('legacy project restores SVG/PNG motion and references with an exact undo; never changes cloud/session keys',()=>{
 const largePNG=fixture();largePNG.state.assets[1].from.bitmap='data:image/png;base64,'+'a'.repeat(4000000);assert.equal(parseProjectBackup(JSON.stringify(largePNG)).state.assets.length,2);
 const original=JSON.stringify({version:1,state:{assets:[]},custom:{}});w.localStorage.setItem(PROJECT_KEY,original);w.localStorage.setItem('cloud','untouched');
 const data=parseProjectBackup(JSON.stringify(fixture()));assert.equal(data.state.aiSpec.confirmed,false);assert.equal(data.state.mode,'assets');
 restoreProject(w.localStorage,data);assert.equal(w.localStorage.getItem(UNDO_KEY),original);assert.equal(JSON.parse(w.localStorage.getItem(PROJECT_KEY)).state.assets.length,2);assert.equal(w.localStorage.getItem('cloud'),'untouched');
 undoProjectRestore(w.localStorage);assert.equal(w.localStorage.getItem(PROJECT_KEY),original);assert.equal(w.localStorage.getItem(UNDO_KEY),null);assert.equal(w.localStorage.getItem('cloud'),'untouched');
});
test('malformed, executable and wrong-domain backups fail before touching the saved project; quota failure preserves original',()=>{
 for(const text of ['{}','bad',JSON.stringify({format:'iconlab-catalog',version:1,assets:[]})])assert.throws(()=>parseProjectBackup(text));
 const cases=[x=>x.custom.source.markup=svg.replace('<path','<script/><path'),x=>x.state.assets[0].d='M2 2" onload="evil()',x=>x.state.assets[0].color='red" onload="evil()',x=>x.state.assets[1].from.bitmap='https://external.test/image.png',x=>x.state.assets[0].stroke='1" onload="evil()',x=>x.state.references[0].vb=null];
 for(const mutate of cases){const x=fixture();mutate(x);assert.throws(()=>parseProjectBackup(JSON.stringify(x)));}
 assert.throws(()=>parseProjectBackup(JSON.stringify(fixture()).replace('"custom":{','"custom":{"__proto__":{},')));
 const values=new Map([[PROJECT_KEY,'original']]);const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(k===PROJECT_KEY)throw Error('quota');values.set(k,v);},removeItem:k=>values.delete(k)};
 assert.throws(()=>restoreProject(storage,parseProjectBackup(JSON.stringify(fixture()))),/quota/);assert.equal(values.get(PROJECT_KEY),'original');assert.equal(values.get(UNDO_KEY),'original');
});
