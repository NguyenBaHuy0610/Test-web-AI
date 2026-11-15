alter policy "events_select"
on public.events
to authenticated
using (workspace_id = my_workspace_id());

-- Cho phép tất cả thành viên trong workspace xem sự kiện thuộc workspace (kể cả draft)
create or replace function public.can_read_event(p_event_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.event_id = p_event_id
      and e.workspace_id = public.my_workspace_id()
  );
$$;
