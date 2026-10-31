import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.env.ICONLAB_TEST_DEPS||process.cwd(),'package.json'));
const {PGlite}=require('@electric-sql/pglite');

test('additive taxonomy migration preserves old assets/history and old upload clients; independent fields persist with RLS',async()=>{
 const db=new PGlite();
 try{
 const owner='11111111-1111-4111-8111-111111111111',viewer='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;insert into auth.users values('${owner}','owner@test.com'),('${viewer}','viewer@test.com'),('${outsider}','outsider@test.com');`);
 await db.exec(await fs.readFile(new URL('../backend/001_asset_library.sql',import.meta.url),'utf8'));
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 await as(owner);const workspace=(await db.query("select public.il_create_workspace('migration') as id")).rows[0].id;
 const svg='<svg viewBox="0 0 24 24"><path d="M1 1L22 22"/></svg>';
 const meta={name:'旧图标',tags:[],platform:'通用',visual_type:'线性',state_name:'默认',source_url:'',source_key:'',note:'保留原内容',width:24,height:24};
 const save=async(m,id=null,version=null,s=svg)=>(await db.query('select public.il_save_asset($1,$2::jsonb,$3,$4,$5) as data',[workspace,JSON.stringify(m),s,id,version])).rows[0].data;
 const fixtures=[meta,{...meta,name:'旧面型',visual_type:'面型',platform:'AI 眼镜'},{...meta,name:'旧彩色',visual_type:'彩色',platform:'通用'},{...meta,name:'旧多色',visual_type:'多色',platform:'App'}];
 const saved=[];for(const fixture of fixtures)saved.push((await save(fixture)).asset);
 const before=(await db.query('select * from public.il_assets order by id')).rows;
 const revisions=(await db.query('select * from public.il_revisions order by id')).rows;
 await db.exec('reset role');await db.exec(await fs.readFile(new URL('../supabase/migrations/20261031125455_asset_taxonomy.sql',import.meta.url),'utf8'));
 await as(owner);const after=(await db.query('select * from public.il_assets order by id')).rows;
 assert.equal(after.length,before.length);
 for(let i=0;i<after.length;i++)for(const key of Object.keys(before[i]))assert.deepEqual(after[i][key],before[i][key],key+' must be retained');
 assert.deepEqual((await db.query('select * from public.il_revisions order by id')).rows,revisions,'immutable history is not backfilled');
 const byName=Object.fromEntries(after.map(a=>[a.name,a]));assert.equal(byName['旧图标'].structure,'Outline');assert.equal(byName['旧面型'].structure,'Filled');assert.equal(byName['旧面型'].target_platform,'Glasses');assert.equal(byName['旧彩色'].structure,null);assert.equal(byName['旧彩色'].color_mode,null);assert.equal(byName['旧多色'].color_mode,'Multicolor');assert.ok(after.every(a=>a.visual_style===null));assert.equal(byName['旧图标'].target_platform,null);
 for(const fixture of fixtures)assert.equal((await save(fixture)).result,'unchanged','old client repeat must not create a version');
 assert.equal((await db.query('select * from public.il_revisions')).rows.length,4);
 const dimensions={structure:'Filled',visual_style:'Glassmorphism',color_mode:'Multicolor',target_platform:'App'};
 const modern={...meta,name:'玻璃图标',visual_type:'面型',platform:'App',...dimensions};
 const created=await save(modern);assert.equal(created.result,'created');for(const [key,value] of Object.entries(dimensions))assert.equal(created.asset[key],value);
 assert.equal((await save(modern)).result,'unchanged');
 const legacyUpdate={...modern,note:'老插件更新备注'};for(const key of Object.keys(dimensions))delete legacyUpdate[key];
 const updated=await save(legacyUpdate,created.asset.id,1);assert.equal(updated.asset.version,2);for(const [key,value] of Object.entries(dimensions))assert.equal(updated.asset[key],value,'old client cannot erase new dimension');
 const cleared=await save({...legacyUpdate,structure:null,visual_style:null,color_mode:null,target_platform:null},created.asset.id,2);assert.equal(cleared.asset.version,3);for(const key of Object.keys(dimensions))assert.equal(cleared.asset[key],null,'explicit null clears classification');
 for(const key of Object.keys(dimensions))await assert.rejects(()=>save({...modern,[key]:'invalid'},created.asset.id,3),/无效/);
 assert.equal((await db.query('select version from public.il_assets where id=$1',[created.asset.id])).rows[0].version,3);
 await db.query('select public.il_add_member($1,$2,$3)',[workspace,'viewer@test.com','viewer']);await as(viewer);
 assert.equal((await db.query("select * from public.il_assets where structure='Filled' and target_platform='Glasses'")).rows.length,1);
 await assert.rejects(()=>save(modern),/编辑权限/);await assert.rejects(()=>db.query("update public.il_assets set structure='Outline'"),/permission denied/);
 await as(outsider);assert.equal((await db.query('select * from public.il_assets')).rows.length,0);await assert.rejects(()=>save(modern),/编辑权限/);
 }finally{await db.close();}
});
