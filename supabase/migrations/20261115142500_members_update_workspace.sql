grant update (member_label)
on table public.members
to authenticated;

drop policy if exists members_leader_update on public.members;
drop policy if exists members_update_own_or_workspace_leader on public.members;

create policy members_update_own_or_workspace_leader
on public.members
for update
to authenticated
using (
    member_id = (
        select tm.member_id
        from public.team_members tm
        where tm.user_id = (select auth.uid())
    )
    or (
        is_leader()
        and workspace_id = my_workspace_id()
    )
)
with check (
    workspace_id = my_workspace_id()
    and (
        member_id = (
            select tm.member_id
            from public.team_members tm
            where tm.user_id = (select auth.uid())
        )
        or is_leader()
    )
);

-- Phân quyền cho thành viên tự cập nhật vai trò (chuyên môn) của chính mình trong workspace
grant select, insert, update, delete
on table public.member_roles
to authenticated;

drop policy if exists member_roles_leader_write on public.member_roles;
drop policy if exists member_roles_write_own_or_leader on public.member_roles;

create policy member_roles_write_own_or_leader
on public.member_roles
for all
to authenticated
using (
    (
        member_id = (
            select tm.member_id
            from public.team_members tm
            where tm.user_id = (select auth.uid())
        )
        or is_leader()
    )
    and member_workspace(member_id) = my_workspace_id()
)
with check (
    (
        member_id = (
            select tm.member_id
            from public.team_members tm
            where tm.user_id = (select auth.uid())
        )
        or is_leader()
    )
    and member_workspace(member_id) = my_workspace_id()
);
