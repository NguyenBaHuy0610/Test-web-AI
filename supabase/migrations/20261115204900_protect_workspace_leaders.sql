create or replace function public.remove_workspace_member(p_member_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_workspace_id text;
begin
    if auth.uid() is null or not coalesce(public.is_leader(), false) then
        raise exception 'Only a team leader can remove a workspace member.'
            using errcode = '42501';
    end if;

    v_workspace_id := public.my_workspace_id();
    if v_workspace_id is null then
        raise exception 'No workspace is associated with the current user.'
            using errcode = '42501';
    end if;

    if p_member_id is null or btrim(p_member_id) = '' then
        raise exception 'A member ID is required.'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.team_members tm
        where tm.user_id = auth.uid()
          and tm.member_id = p_member_id
    ) then
        raise exception 'You cannot remove your own workspace membership.'
            using errcode = '42501';
    end if;

    if exists (
        select 1
        from public.team_members tm
        where tm.member_id = p_member_id
          and tm.workspace_id = v_workspace_id
          and lower(btrim(coalesce(tm.account_role, ''))) in (
              'leader',
              'team_leader',
              'trưởng nhóm'
          )
    ) then
        raise exception 'A workspace leader cannot be removed from the workspace.'
            using errcode = '42501';
    end if;

    update public.members
    set is_active = false,
        removed_from_workspace_at = now()
    where member_id = p_member_id
      and workspace_id = v_workspace_id
      and removed_from_workspace_at is null;

    if not found then
        raise exception 'The member was not found in this workspace or was already removed.'
            using errcode = 'P0002';
    end if;

    delete from public.team_members
    where member_id = p_member_id
      and workspace_id = v_workspace_id;
end;
$$;

revoke all on function public.remove_workspace_member(text) from public;
grant execute on function public.remove_workspace_member(text) to authenticated;
