-- Workspace standards are independent from asset content and never imply approval.
create table public.il_standards (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.il_workspaces(id),
 platform text not null check(length(trim(platform)) between 1 and 30),
 definition jsonb not null check(jsonb_typeof(definition)='object'),
 version int not null check(version>0),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 unique(workspace_id,platform)
);
create table public.il_standard_versions (
 id uuid primary key default gen_random_uuid(), standard_id uuid not null references public.il_standards(id),
 version int not null check(version>0), definition jsonb not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(standard_id,version)
);
create index il_standard_updated_by on public.il_standards(updated_by);
create index il_standard_versions_author on public.il_standard_versions(created_by);
alter table public.il_standards enable row level security;
alter table public.il_standard_versions enable row level security;
create policy il_standards_read on public.il_standards for select to authenticated
 using (il_private.il_role(workspace_id) is not null);
create policy il_standard_versions_read on public.il_standard_versions for select to authenticated
 using (exists(select 1 from public.il_standards s where s.id=standard_id and il_private.il_role(s.workspace_id) is not null));
revoke all on public.il_standards,public.il_standard_versions from public,anon,authenticated;
grant select on public.il_standards,public.il_standard_versions to authenticated;

create function il_private.il_save_standard(p_workspace_id uuid,p_platform text,p_definition jsonb,p_expected_version int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.il_standards; u uuid:=auth.uid(); w numeric; h numeric; inset numeric; value jsonb; color text; field text;
begin
 if u is null then raise exception '请先登录。'; end if;
 if coalesce(il_private.il_role(p_workspace_id),'')<>'owner' then raise exception '只有空间所有者可以修改规范。'; end if;
 if p_platform is null or length(trim(p_platform)) not between 1 and 30 then raise exception '适用设备格式无效。'; end if;
 if p_definition is null or jsonb_typeof(p_definition)<>'object' or octet_length(p_definition::text)>4096 then raise exception '规范格式无效或过大。'; end if;
 if p_definition->'schema_version' is distinct from '1'::jsonb then raise exception '不支持此规范格式版本。'; end if;
 if jsonb_typeof(p_definition->'name') is distinct from 'string' or length(trim(p_definition->>'name')) not between 1 and 80 then raise exception '规范名称需为 1–80 字。'; end if;
 foreach field in array array['width','height','safe_inset'] loop
  if jsonb_typeof(p_definition->field) is distinct from 'number' then raise exception '规范尺寸需为数值。'; end if;
 end loop;
 w:=(p_definition->>'width')::numeric;h:=(p_definition->>'height')::numeric;inset:=(p_definition->>'safe_inset')::numeric;
 if w not between 1 and 2048 or h not between 1 and 2048 or inset<0 or inset>least(w,h)/2-0.001 then raise exception '画布或安全区范围无效。'; end if;
 foreach field in array array['stroke_enabled','colors_enabled','safe_enabled','allow_gradients'] loop
  if jsonb_typeof(p_definition->field) is distinct from 'boolean' then raise exception '规范开关格式无效。'; end if;
 end loop;
 if jsonb_typeof(p_definition->'stroke_widths') is distinct from 'array' then raise exception '描边列表格式无效。'; end if;
 if jsonb_array_length(p_definition->'stroke_widths')>8 or ((p_definition->>'stroke_enabled')::boolean and jsonb_array_length(p_definition->'stroke_widths')=0) then raise exception '启用描边检查时需有 1–8 个粗细。'; end if;
 for value in select jsonb_array_elements(p_definition->'stroke_widths') loop
  if jsonb_typeof(value)<>'number' then raise exception '描边粗细需为数值。'; end if;
  if (value::text)::numeric not between 0.1 and 64 then raise exception '描边粗细范围无效。'; end if;
 end loop;
 if jsonb_typeof(p_definition->'colors') is distinct from 'array' then raise exception '颜色列表格式无效。'; end if;
 if jsonb_array_length(p_definition->'colors')>16 or ((p_definition->>'colors_enabled')::boolean and jsonb_array_length(p_definition->'colors')=0) then raise exception '启用颜色检查时需有 1–16 个颜色。'; end if;
 for value in select jsonb_array_elements(p_definition->'colors') loop
  if jsonb_typeof(value)<>'string' then raise exception '颜色需为字符串。'; end if;
  color:=value#>>'{}';if color !~ '^(#[0-9a-f]{6}|currentColor)$' then raise exception '颜色需使用规范化 HEX 或 currentColor。'; end if;
 end loop;
 -- Serialize with workspace writes, then compare the editor's captured version.
 perform 1 from public.il_workspaces where id=p_workspace_id for update;
 select * into s from public.il_standards where workspace_id=p_workspace_id and platform=trim(p_platform) for update;
 if p_expected_version is null or coalesce(s.version,0)<>p_expected_version then raise exception '规范版本已变化，请重新载入后再保存。'; end if;
 if s.id is not null and s.definition=p_definition then return jsonb_build_object('result','unchanged','standard',to_jsonb(s)); end if;
 if s.id is null then
  insert into public.il_standards(workspace_id,platform,definition,version,updated_by)
   values(p_workspace_id,trim(p_platform),p_definition,1,u) returning * into s;
 else
  update public.il_standards set definition=p_definition,version=version+1,updated_by=u,updated_at=now() where id=s.id returning * into s;
 end if;
 insert into public.il_standard_versions(standard_id,version,definition,created_by) values(s.id,s.version,s.definition,u);
 return jsonb_build_object('result',case when s.version=1 then 'created' else 'updated' end,'standard',to_jsonb(s));
end $$;
create function public.il_save_standard(p_workspace_id uuid,p_platform text,p_definition jsonb,p_expected_version int)
returns jsonb language sql security invoker set search_path='' as $$
 select il_private.il_save_standard(p_workspace_id,p_platform,p_definition,p_expected_version)
$$;
revoke all on function il_private.il_save_standard(uuid,text,jsonb,int),public.il_save_standard(uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function il_private.il_save_standard(uuid,text,jsonb,int),public.il_save_standard(uuid,text,jsonb,int) to authenticated;
notify pgrst,'reload schema';
