-- =========================================================================
-- SCRIPT TỔNG HỢP SỬA LỖI DATABASE TRÊN SUPABASE DASHBOARD (SQL EDITOR)
-- Bao gồm toàn bộ các bản vá lỗi:
-- 1. Sửa lỗi thông báo (notifications: is_read, read_at, quyền UPDATE, RPC)
-- 2. Sửa lỗi đọc danh sách công việc & sự kiện (events, tasks, task_assignments)
-- 3. Sửa lỗi thành viên tự sửa hồ sơ & nhóm chuyên môn (members, member_roles)
-- 4. Bảng lưu trữ lịch sử AI Chatbot đa thiết bị (ai_conversations)
-- =========================================================================

-- =========================================================================
-- PHẦN 1: KHẮC PHỤC LỖI THÔNG BÁO (NOTIFICATIONS)
-- =========================================================================

-- 1.1. Cấp quyền truy cập bảng notifications
GRANT SELECT, INSERT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON TABLE public.notifications TO authenticated;

-- 1.2. Chính sách RLS notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS notifications_select_own_from_app ON public.notifications;
CREATE POLICY notifications_select_own_from_app
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_insert_own_from_app ON public.notifications;
CREATE POLICY notifications_insert_own_from_app
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own_from_app ON public.notifications;
CREATE POLICY notifications_update_own_from_app
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 1.3. Cập nhật 2 hàm RPC đánh dấu thông báo đã đọc (tự động cập nhật read_at = now())
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET is_read = true, read_at = now()
  WHERE notification_id = p_notification_id
    AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count integer;
BEGIN
  UPDATE public.notifications
  SET is_read = true, read_at = now()
  WHERE user_id = auth.uid()
    AND is_read = false;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;


-- =========================================================================
-- PHẦN 2: KHẮC PHỤC LỖI ĐỌC TASKS & SỰ KIỆN TRONG WORKSPACE
-- =========================================================================

-- 2.1. Cập nhật hàm can_read_event: Cho phép đọc mọi sự kiện trong workspace (bỏ chặn draft)
CREATE OR REPLACE FUNCTION public.can_read_event(p_event_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.event_id = p_event_id
      AND e.workspace_id = public.my_workspace_id()
  );
$$;

-- 2.2. Đảm bảo RLS cho phép thành viên đọc sự kiện trong workspace
DROP POLICY IF EXISTS events_select ON public.events;
CREATE POLICY events_select
ON public.events
FOR SELECT
TO authenticated
USING (workspace_id = public.my_workspace_id());

-- 2.3. Cấp quyền đọc tasks, assignments, attachments
GRANT SELECT ON TABLE public.tasks TO authenticated;
GRANT SELECT ON TABLE public.task_assignments TO authenticated;
GRANT SELECT ON TABLE public.task_attachments TO authenticated;

-- 2.4. RLS cho phép thành viên đọc tasks của các sự kiện cùng workspace
DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_select_workspace ON public.tasks;
CREATE POLICY tasks_select_workspace
ON public.tasks
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.event_id = tasks.event_id
          AND e.workspace_id = public.my_workspace_id()
    )
);

-- 2.5. RLS đọc task_assignments
DROP POLICY IF EXISTS task_assignments_select ON public.task_assignments;
DROP POLICY IF EXISTS task_assignments_select_workspace ON public.task_assignments;
CREATE POLICY task_assignments_select_workspace
ON public.task_assignments
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.tasks t
        JOIN public.events e ON e.event_id = t.event_id
        WHERE t.task_id = task_assignments.task_id
          AND e.workspace_id = public.my_workspace_id()
    )
);

-- 2.6. RLS đọc task_attachments
DROP POLICY IF EXISTS task_attachments_select ON public.task_attachments;
DROP POLICY IF EXISTS task_attachments_select_workspace ON public.task_attachments;
CREATE POLICY task_attachments_select_workspace
ON public.task_attachments
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.tasks t
        JOIN public.events e ON e.event_id = t.event_id
        WHERE t.task_id = task_attachments.task_id
          AND e.workspace_id = public.my_workspace_id()
    )
);


-- =========================================================================
-- PHẦN 3: KHẮC PHỤC LỖI THÀNH VIÊN SỬA HỒ SƠ & VAI TRÒ CHUYÊN MÔN
-- =========================================================================

-- 3.1. RLS cho team_members
DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select
ON public.team_members
FOR SELECT
TO authenticated
USING (
    user_id = (SELECT auth.uid())
    OR workspace_id = public.my_workspace_id()
);

-- 3.2. Cấp quyền UPDATE (member_label) trên bảng members
GRANT UPDATE (member_label) ON TABLE public.members TO authenticated;

-- 3.3. RLS cho phép thành viên tự sửa hồ sơ của mình, Leader sửa được mọi thành viên
DROP POLICY IF EXISTS members_leader_update ON public.members;
DROP POLICY IF EXISTS members_update_own_or_workspace_leader ON public.members;
CREATE POLICY members_update_own_or_workspace_leader
ON public.members
FOR UPDATE
TO authenticated
USING (
    member_id = (
        SELECT tm.member_id
        FROM public.team_members tm
        WHERE tm.user_id = (SELECT auth.uid())
    )
    OR (
        public.is_leader()
        AND workspace_id = public.my_workspace_id()
    )
)
WITH CHECK (
    workspace_id = public.my_workspace_id()
    AND (
        member_id = (
            SELECT tm.member_id
            FROM public.team_members tm
            WHERE tm.user_id = (SELECT auth.uid())
        )
        OR public.is_leader()
    )
);

-- 3.4. Cấp quyền & RLS cập nhật chuyên môn trong bảng member_roles
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.member_roles TO authenticated;

DROP POLICY IF EXISTS member_roles_leader_write ON public.member_roles;
DROP POLICY IF EXISTS member_roles_write_own_or_leader ON public.member_roles;
CREATE POLICY member_roles_write_own_or_leader
ON public.member_roles
FOR ALL
TO authenticated
USING (
    (
        member_id = (
            SELECT tm.member_id
            FROM public.team_members tm
            WHERE tm.user_id = (SELECT auth.uid())
        )
        OR public.is_leader()
    )
    AND public.member_workspace(member_id) = public.my_workspace_id()
)
WITH CHECK (
    (
        member_id = (
            SELECT tm.member_id
            FROM public.team_members tm
            WHERE tm.user_id = (SELECT auth.uid())
        )
        OR public.is_leader()
    )
    AND public.member_workspace(member_id) = public.my_workspace_id()
);


-- =========================================================================
-- PHẦN 4: BẢNG LƯU TRỮ AI CHATBOT ĐA THIẾT BỊ (NẾU CHƯA CÓ)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.ai_conversations (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Cuộc trò chuyện',
    active_event_id TEXT,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated
    ON public.ai_conversations (user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_conversations TO authenticated;

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own conversations" ON public.ai_conversations;
CREATE POLICY "Users can manage their own conversations"
    ON public.ai_conversations
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);


-- =========================================================================
-- PHẦN 5: TÍNH NĂNG XÓA THÀNH VIÊN KHỎI WORKSPACE (REMOVE WORKSPACE MEMBER)
-- =========================================================================
ALTER TABLE public.members
    ADD COLUMN IF NOT EXISTS removed_from_workspace_at TIMESTAMP WITH TIME ZONE;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(p_member_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_workspace_id text;
BEGIN
    IF auth.uid() IS NULL OR NOT coalesce(public.is_leader(), false) THEN
        RAISE EXCEPTION 'Only a team leader can remove a workspace member.'
            USING errcode = '42501';
    END IF;

    v_workspace_id := public.my_workspace_id();
    IF v_workspace_id IS NULL THEN
        RAISE EXCEPTION 'No workspace is associated with the current user.'
            USING errcode = '42501';
    END IF;

    IF p_member_id IS NULL OR btrim(p_member_id) = '' THEN
        RAISE EXCEPTION 'A member ID is required.'
            USING errcode = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.team_members tm
        WHERE tm.user_id = auth.uid()
          AND tm.member_id = p_member_id
    ) THEN
        RAISE EXCEPTION 'You cannot remove your own workspace membership.'
            USING errcode = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.team_members tm
        WHERE tm.member_id = p_member_id
          AND tm.workspace_id = v_workspace_id
          AND lower(btrim(coalesce(tm.account_role, ''))) IN (
              'leader',
              'team_leader',
              'trưởng nhóm'
          )
    ) THEN
        RAISE EXCEPTION 'A workspace leader cannot be removed from the workspace.'
            USING errcode = '42501';
    END IF;

    UPDATE public.members
    SET is_active = false,
        removed_from_workspace_at = now()
    WHERE member_id = p_member_id
      AND workspace_id = v_workspace_id
      AND removed_from_workspace_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The member was not found in this workspace or was already removed.'
            USING errcode = 'P0002';
    END IF;

    DELETE FROM public.team_members
    WHERE member_id = p_member_id
      AND workspace_id = v_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_workspace_member(text) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(text) TO authenticated;
