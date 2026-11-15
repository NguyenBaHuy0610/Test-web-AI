-- =========================================================================
-- CHUẨN HÓA NHÓM CHUYÊN MÔN (MEMBER_ROLES) & RLS PHÂN CÔNG (TASK_ASSIGNMENTS)
-- =========================================================================

-- 1. Chuẩn hóa dữ liệu member_roles về 5 nhóm chuẩn Title Case
UPDATE public.member_roles SET role = 'Edit' WHERE lower(btrim(role)) IN ('edit', 'video', 'editor');
UPDATE public.member_roles SET role = 'Tech' WHERE lower(btrim(role)) IN ('tech', 'technician');
UPDATE public.member_roles SET role = 'Design' WHERE lower(btrim(role)) IN ('design', 'designer');
UPDATE public.member_roles SET role = 'Content' WHERE lower(btrim(role)) IN ('content', 'content_writer', 'writer');
UPDATE public.member_roles SET role = 'Photo' WHERE lower(btrim(role)) IN ('photo', 'photographer');

-- 2. Cấp quyền ghi trên task_assignments cho authenticated
GRANT INSERT, UPDATE, DELETE ON TABLE public.task_assignments TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.tasks TO authenticated;

-- 3. Chính sách ghi task_assignments cho các công việc trong workspace
DROP POLICY IF EXISTS task_assignments_workspace_write ON public.task_assignments;
CREATE POLICY task_assignments_workspace_write
ON public.task_assignments
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.tasks t
        JOIN public.events e ON e.event_id = t.event_id
        WHERE t.task_id = task_assignments.task_id
          AND e.workspace_id = public.my_workspace_id()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.tasks t
        JOIN public.events e ON e.event_id = t.event_id
        WHERE t.task_id = task_assignments.task_id
          AND e.workspace_id = public.my_workspace_id()
    )
    AND (
        member_id IS NULL
        OR public.member_workspace(member_id) = public.my_workspace_id()
    )
);

-- 4. Cho phép leader tạo và cập nhật tasks trong workspace của mình
DROP POLICY IF EXISTS tasks_workspace_write ON public.tasks;
CREATE POLICY tasks_workspace_write
ON public.tasks
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.event_id = tasks.event_id
          AND e.workspace_id = public.my_workspace_id()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.event_id = tasks.event_id
          AND e.workspace_id = public.my_workspace_id()
    )
);
