-- Run once in a new Supabase project's SQL Editor. All writes go through checked RPCs.
begin;
create table public.il_workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80),
 owner_id uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(owner_id,name)
);
create table public.il_members (
 workspace_id uuid not null references public.il_workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id), role text not null check(role in ('owner','editor','viewer')),
 primary key(workspace_id,user_id)
);
create table public.il_assets (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.il_workspaces(id),
 name text not null, tags text[] not null default '{}', platform text not null, visual_type text not null, state_name text not null,
 source_url text not null default '', source_key text not null default '', note text not null default '',
 svg text not null check(octet_length(svg) <= 1048576), width numeric not null check(width>0 and width<=100000), height numeric not null check(height>0 and height<=100000),
 content_hash text not null, version int not null check(version>0),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index il_asset_source on public.il_assets(workspace_id,source_key,platform,visual_type,state_name) where source_key<>'';
create index il_asset_workspace on public.il_assets(workspace_id,updated_at desc);
create table public.il_revisions (
 id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.il_assets(id), version int not null,
 metadata jsonb not null, svg text not null, width numeric not null, height numeric not null, content_hash text not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(asset_id,version)
);
create function public.il_role(p_workspace_id uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.il_members where workspace_id=p_workspace_id and user_id=auth.uid()
$$;
alter table public.il_workspaces enable row level security;
alter table public.il_members enable row level security;
alter table public.il_assets enable row level security;
alter table public.il_revisions enable row level security;
create policy il_workspace_read on public.il_workspaces for select to authenticated using (public.il_role(id) is not null);
create policy il_member_read on public.il_members for select to authenticated using (public.il_role(workspace_id) is not null);
create policy il_asset_read on public.il_assets for select to authenticated using (public.il_role(workspace_id) is not null);
create policy il_revision_read on public.il_revisions for select to authenticated using (
 exists(select 1 from public.il_assets a where a.id=asset_id and public.il_role(a.workspace_id) is not null)
);
revoke all on public.il_workspaces, public.il_members, public.il_assets, public.il_revisions from public, anon, authenticated;
grant select on public.il_workspaces, public.il_members, public.il_assets, public.il_revisions to authenticated;

create function public.il_create_workspace(p_name text default '我的图标库') returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; u uuid:=auth.uid();
begin
 if u is null then raise exception '请先登录。'; end if;
 if length(trim(p_name)) not between 1 and 80 then raise exception '工作空间名称需为 1–80 字。'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select id into w from public.il_workspaces where owner_id=u and name=trim(p_name);
 if w is null then
  insert into public.il_workspaces(name,owner_id) values(trim(p_name),u) returning id into w;
  insert into public.il_members values(w,u,'owner');
 end if;
 return w;
end $$;

create function public.il_save_asset(p_workspace_id uuid, p_meta jsonb, p_svg text, p_asset_id uuid default null, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.il_assets; duplicate public.il_assets; m jsonb; h text; sk text; t text[]; v int; result text; u uuid:=auth.uid();
begin
 if coalesce(public.il_role(p_workspace_id),'') not in ('owner','editor') then raise exception '没有此工作空间的编辑权限。'; end if;
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
  if a.content_hash=h and (select metadata from public.il_revisions where asset_id=a.id and version=a.version)=m then return jsonb_build_object('result','unchanged','asset',to_jsonb(a)); end if;
  if p_asset_id is null then return jsonb_build_object('result','duplicate','asset',to_jsonb(a)); end if;
 end if;
 if sk<>'' and exists(select 1 from public.il_assets where workspace_id=p_workspace_id and source_key=sk and platform=m->>'platform' and visual_type=m->>'visual_type' and state_name=m->>'state_name' and id is distinct from a.id) then raise exception '该来源与变体已属于其他资产。'; end if;
 if a.id is null then
  insert into public.il_assets(workspace_id,name,tags,platform,visual_type,state_name,source_url,source_key,note,svg,width,height,content_hash,version,created_by)
   values(p_workspace_id,m->>'name',t,m->>'platform',m->>'visual_type',m->>'state_name',m->>'source_url',sk,m->>'note',p_svg,(m->>'width')::numeric,(m->>'height')::numeric,h,1,u) returning * into a;
  result:='created';
 else
  update public.il_assets set name=m->>'name', tags=t, platform=m->>'platform', visual_type=m->>'visual_type', state_name=m->>'state_name', source_url=m->>'source_url', source_key=sk, note=m->>'note', svg=p_svg,width=(m->>'width')::numeric,height=(m->>'height')::numeric,content_hash=h,version=version+1,updated_at=now() where id=a.id returning * into a;
  result:='updated';
 end if;
 insert into public.il_revisions(asset_id,version,metadata,svg,width,height,content_hash,created_by) values(a.id,a.version,m,p_svg,a.width,a.height,h,u);
 return jsonb_build_object('result',result,'asset',to_jsonb(a));
end $$;

-- Grants access to an already-registered account; does not send invitation emails.
create function public.il_add_member(p_workspace_id uuid, p_email text, p_role text default 'viewer') returns void language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 if public.il_role(p_workspace_id) is distinct from 'owner' then raise exception '只有空间所有者可以添加成员。'; end if;
 if p_role not in ('editor','viewer') then raise exception '角色仅支持 editor 或 viewer。'; end if;
 select id into u from auth.users where lower(email)=lower(trim(p_email));
 if u is null then raise exception '此邮箱尚未注册，请先让对方注册工作台账号。'; end if;
 if exists(select 1 from public.il_members where workspace_id=p_workspace_id and user_id=u and role='owner') then raise exception '不能修改空间所有者。'; end if;
 insert into public.il_members values(p_workspace_id,u,p_role) on conflict(workspace_id,user_id) do update set role=excluded.role;
end $$;
revoke all on function public.il_role(uuid), public.il_create_workspace(text), public.il_save_asset(uuid,jsonb,text,uuid,int), public.il_add_member(uuid,text,text) from public,anon,authenticated;
grant execute on function public.il_role(uuid), public.il_create_workspace(text), public.il_save_asset(uuid,jsonb,text,uuid,int), public.il_add_member(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
