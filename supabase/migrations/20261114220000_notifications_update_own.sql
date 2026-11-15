grant select, insert
on table public.notifications
to authenticated;

grant update (is_read, read_at) on table public.notifications to authenticated;

drop policy if exists "Users can update their own notifications" on public.notifications;
drop policy if exists notifications_select_own_from_app on public.notifications;

create policy notifications_select_own_from_app
on public.notifications
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists notifications_insert_own_from_app on public.notifications;

create policy notifications_insert_own_from_app
on public.notifications
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists notifications_update_own_from_app on public.notifications;

create policy notifications_update_own_from_app
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Đảm bảo 2 hàm RPC cập nhật read_at = now()
create or replace function public.mark_notification_as_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
  set is_read = true, read_at = now()
  where notification_id = p_notification_id
    and user_id = auth.uid();
  return found;
end;
$$;

create or replace function public.mark_all_notifications_as_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count integer;
begin
  update public.notifications
  set is_read = true, read_at = now()
  where user_id = auth.uid()
    and is_read = false;
  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;
