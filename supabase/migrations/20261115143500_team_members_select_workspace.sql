alter policy "team_members_select"
on public.team_members
to authenticated
using (
    user_id = (select auth.uid())
    or workspace_id = my_workspace_id()
);
