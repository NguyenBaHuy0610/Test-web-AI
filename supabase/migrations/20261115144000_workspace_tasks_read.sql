grant select
on table public.tasks, public.task_assignments, public.task_attachments
to authenticated;

drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_select_workspace on public.tasks;

create policy tasks_select_workspace
on public.tasks
for select
to authenticated
using (
    exists (
        select 1
        from public.events e
        where e.event_id = tasks.event_id
          and e.workspace_id = my_workspace_id()
    )
);

drop policy if exists task_assignments_select on public.task_assignments;
drop policy if exists task_assignments_select_workspace on public.task_assignments;

create policy task_assignments_select_workspace
on public.task_assignments
for select
to authenticated
using (
    exists (
        select 1
        from public.tasks t
        join public.events e on e.event_id = t.event_id
        where t.task_id = task_assignments.task_id
          and e.workspace_id = my_workspace_id()
    )
);

drop policy if exists task_attachments_select on public.task_attachments;
drop policy if exists task_attachments_select_workspace on public.task_attachments;

create policy task_attachments_select_workspace
on public.task_attachments
for select
to authenticated
using (
    exists (
        select 1
        from public.tasks t
        join public.events e on e.event_id = t.event_id
        where t.task_id = task_attachments.task_id
          and e.workspace_id = my_workspace_id()
    )
);
