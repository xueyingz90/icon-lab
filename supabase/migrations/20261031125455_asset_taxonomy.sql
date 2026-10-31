-- Additive migration: legacy fields, IDs, SVGs, timestamps and history are retained.
begin;
alter table public.il_assets add column structure text check(structure in ('Outline','Filled','Hybrid'));
alter table public.il_assets add column visual_style text check(visual_style in ('Flat','Gradient','Glassmorphism','Volumetric'));
alter table public.il_assets add column color_mode text check(color_mode in ('Monochrome','Duotone','Multicolor'));
alter table public.il_assets add column target_platform text check(target_platform in ('App','Glasses','Other'));
update public.il_assets set
 structure=case visual_type when '线性' then 'Outline' when 'Outline' then 'Outline' when '面型' then 'Filled' when 'Filled' then 'Filled' when 'Hybrid' then 'Hybrid' else null end,
 color_mode=case visual_type when '单色' then 'Monochrome' when 'Monochrome' then 'Monochrome' when '双色' then 'Duotone' when 'Duotone' then 'Duotone' when '多色' then 'Multicolor' when 'Multicolor' then 'Multicolor' else null end,
 target_platform=case platform when 'App' then 'App' when 'AI 眼镜' then 'Glasses' when 'Glasses' then 'Glasses' when '其他设备' then 'Other' when 'Other' then 'Other' else null end;
-- visual_style stays NULL: old categories do not determine style.
create index il_assets_taxonomy on public.il_assets(workspace_id,structure,visual_style);

-- Existing signature and upload/version/permission flow retained.
create or replace function il_private.il_save_asset(p_workspace_id uuid, p_meta jsonb, p_svg text, p_asset_id uuid default null, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare baseline jsonb; a public.il_assets; duplicate public.il_assets; m jsonb; h text; sk text; t text[]; v int; result text; u uuid:=auth.uid();
begin
 if u is null then raise exception '请先登录。'; end if;
 if coalesce(il_private.il_role(p_workspace_id),'') not in ('owner','editor') then raise exception '没有此工作空间的编辑权限。'; end if;
 if p_svg is null or octet_length(p_svg)>1048576 or p_svg !~ '^<svg' then raise exception 'SVG 无效或超过 1MB。'; end if;
 if jsonb_typeof(p_meta->'tags') is distinct from 'array' then raise exception '标签格式无效。'; end if;
 select coalesce(array_agg(value), '{}') into t from jsonb_array_elements_text(p_meta->'tags');
 if cardinality(t)>12 or exists(select 1 from unnest(t) x where length(x)>30) then raise exception '最多 12 个标签，每个最多 30 字。'; end if;
 if length(trim(p_meta->>'name')) not between 1 and 100 or coalesce(p_meta->>'name','')='' then raise exception '名称需为 1–100 字。'; end if;
 if coalesce(p_meta->>'platform','')='' or coalesce(p_meta->>'visual_type','')='' or coalesce(p_meta->>'state_name','')='' then raise exception '缺少平台、风格或状态。'; end if;
 if length(p_meta->>'platform')>30 or length(p_meta->>'visual_type')>30 or length(p_meta->>'state_name')>30 or length(coalesce(p_meta->>'note',''))>500 then raise exception '资产信息过长。'; end if;
 if length(coalesce(p_meta->>'source_url',''))>2000 or length(coalesce(p_meta->>'source_key',''))>2000 then raise exception '来源链接过长。'; end if;
 if coalesce(p_meta->>'source_url','')<>'' and (p_meta->>'source_url') !~ '^https://' then raise exception '来源仅支持 HTTPS。'; end if;
 if not ((p_meta->>'width')::numeric>0 and (p_meta->>'width')::numeric<=100000 and (p_meta->>'height')::numeric>0 and (p_meta->>'height')::numeric<=100000) then raise exception '无效画布。'; end if;
 h:=encode(sha256(convert_to(p_svg,'UTF8')),'hex'); sk:=coalesce(p_meta->>'source_key','');
 m:=jsonb_build_object('name',trim(p_meta->>'name'),'tags',to_jsonb(t),'platform',p_meta->>'platform','visual_type',p_meta->>'visual_type','state_name',p_meta->>'state_name','source_url',coalesce(p_meta->>'source_url',''),'source_key',sk,'note',coalesce(p_meta->>'note',''),'width',(p_meta->>'width')::numeric,'height',(p_meta->>'height')::numeric);

 m:=m||jsonb_build_object(
  'structure',case when p_meta?'structure' then nullif(p_meta->>'structure','') else case p_meta->>'visual_type' when '线性' then 'Outline' when 'Outline' then 'Outline' when '面型' then 'Filled' when 'Filled' then 'Filled' when 'Hybrid' then 'Hybrid' else null end end,
  'visual_style',nullif(p_meta->>'visual_style',''),
  'color_mode',case when p_meta?'color_mode' then nullif(p_meta->>'color_mode','') else case p_meta->>'visual_type' when '单色' then 'Monochrome' when 'Monochrome' then 'Monochrome' when '双色' then 'Duotone' when 'Duotone' then 'Duotone' when '多色' then 'Multicolor' when 'Multicolor' then 'Multicolor' else null end end,
  'target_platform',case when p_meta?'target_platform' then nullif(p_meta->>'target_platform','') else case p_meta->>'platform' when 'App' then 'App' when 'AI 眼镜' then 'Glasses' when 'Glasses' then 'Glasses' when '其他设备' then 'Other' when 'Other' then 'Other' else null end end
 );
 if m->>'structure' is not null and m->>'structure' not in ('Outline','Filled','Hybrid') then raise exception '无效的图形结构。'; end if;
 if m->>'visual_style' is not null and m->>'visual_style' not in ('Flat','Gradient','Glassmorphism','Volumetric') then raise exception '无效的视觉风格。'; end if;
 if m->>'color_mode' is not null and m->>'color_mode' not in ('Monochrome','Duotone','Multicolor') then raise exception '无效的颜色模式。'; end if;
 if m->>'target_platform' is not null and m->>'target_platform' not in ('App','Glasses','Other') then raise exception '无效的适用平台。'; end if;
 -- Serialize writes within a small pilot workspace, including first-upload duplicate checks.
 perform 1 from public.il_workspaces where id=p_workspace_id for update;
 if p_asset_id is not null then
  select * into a from public.il_assets where id=p_asset_id and workspace_id=p_workspace_id;
  if a.id is null then raise exception '资产不存在或无权访问。'; end if;
  if p_expected_version is null or a.version<>p_expected_version then raise exception '版本已变化，请刷新后重试。'; end if;
 else
  select * into a from public.il_assets where workspace_id=p_workspace_id and platform=m->>'platform' and visual_type=m->>'visual_type' and state_name=m->>'state_name'
   and ((sk<>'' and source_key=sk) or content_hash=h) order by updated_at desc limit 1;
 end if;
 if a.id is not null then
  -- Old clients omit optional dimensions. Keep the existing values.
  if not p_meta?'structure' and (a.visual_type=m->>'visual_type' or m->>'structure' is null) then m:=m||jsonb_build_object('structure',a.structure); end if;
  if not p_meta?'visual_style' then m:=m||jsonb_build_object('visual_style',a.visual_style); end if;
  if not p_meta?'color_mode' and (a.visual_type=m->>'visual_type' or m->>'color_mode' is null) then m:=m||jsonb_build_object('color_mode',a.color_mode); end if;
  if not p_meta?'target_platform' and a.platform=m->>'platform' then m:=m||jsonb_build_object('target_platform',a.target_platform); end if;
  select metadata into baseline from public.il_revisions where asset_id=a.id and version=a.version;
  -- Compare legacy history without rewriting it or creating a spurious version.
  baseline:=baseline||jsonb_build_object('structure',a.structure,'visual_style',a.visual_style,'color_mode',a.color_mode,'target_platform',a.target_platform);
  if a.content_hash=h and baseline=m then return jsonb_build_object('result','unchanged','asset',to_jsonb(a)); end if;
  if p_asset_id is null then return jsonb_build_object('result','duplicate','asset',to_jsonb(a)); end if;
 end if;
 if sk<>'' and exists(select 1 from public.il_assets where workspace_id=p_workspace_id and source_key=sk and platform=m->>'platform' and visual_type=m->>'visual_type' and state_name=m->>'state_name' and id is distinct from a.id) then raise exception '该来源与变体已属于其他资产。'; end if;
 if a.id is null then
  insert into public.il_assets(workspace_id,name,tags,platform,visual_type,state_name,source_url,source_key,note,svg,width,height,content_hash,version,created_by,structure,visual_style,color_mode,target_platform)
   values(p_workspace_id,m->>'name',t,m->>'platform',m->>'visual_type',m->>'state_name',m->>'source_url',sk,m->>'note',p_svg,(m->>'width')::numeric,(m->>'height')::numeric,h,1,u,m->>'structure',m->>'visual_style',m->>'color_mode',m->>'target_platform') returning * into a;
  result:='created';
 else
  update public.il_assets set name=m->>'name', tags=t, platform=m->>'platform', visual_type=m->>'visual_type', state_name=m->>'state_name', source_url=m->>'source_url', source_key=sk, note=m->>'note', svg=p_svg,width=(m->>'width')::numeric,height=(m->>'height')::numeric,content_hash=h,structure=m->>'structure',visual_style=m->>'visual_style',color_mode=m->>'color_mode',target_platform=m->>'target_platform',version=version+1,updated_at=now() where id=a.id returning * into a;
  result:='updated';
 end if;
 insert into public.il_revisions(asset_id,version,metadata,svg,width,height,content_hash,created_by) values(a.id,a.version,m,p_svg,a.width,a.height,h,u);
 return jsonb_build_object('result',result,'asset',to_jsonb(a));
end $$;
notify pgrst,'reload schema';
commit;
