-- Member status: deactivate (and optionally hide the content of) a member, or restore one.
-- Run this once in the Supabase SQL Editor. It is safe to run again.
alter table public.study_members add column if not exists active boolean not null default true;
alter table public.study_members add column if not exists hidden boolean not null default false;

create or replace function public.study_set_member(member_no integer, make_active boolean, hide_content boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.study_admins where user_id = auth.uid()) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.study_members where id = member_no) then
    raise exception 'Unknown member' using errcode = '22023';
  end if;
  update public.study_members
     set active = make_active,
         hidden = case when make_active then false else hide_content end
   where id = member_no;
end;
$$;
revoke all on function public.study_set_member(integer, boolean, boolean) from public, anon, authenticated;
grant execute on function public.study_set_member(integer, boolean, boolean) to authenticated;
