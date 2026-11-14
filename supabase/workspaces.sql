-- =========================================================================
-- BẢNG WORKSPACES & PHÂN TÁCH DỮ LIỆU ĐA WORKSPACE (MULTI-TENANCY)
-- Khi người dùng mới đăng ký, hệ thống tự tạo workspace mới (WS_01, WS_02...)
-- và gán người đó làm LEADER của workspace đó.
-- Chạy toàn bộ script này trong Supabase Dashboard -> SQL Editor
-- =========================================================================

-- 1. TẠO BẢNG WORKSPACES
CREATE TABLE IF NOT EXISTS public.workspaces (
    workspace_id TEXT PRIMARY KEY,                       -- Dạng WS_01, WS_02...
    workspace_name TEXT NOT NULL,                        -- Tên không gian làm việc
    owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger cập nhật updated_at cho workspaces
CREATE OR REPLACE FUNCTION public.touch_workspace_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspaces_touch_updated_at ON public.workspaces;
CREATE TRIGGER trg_workspaces_touch_updated_at
    BEFORE UPDATE ON public.workspaces
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_workspace_updated_at();

-- 2. BỔ SUNG CỘT WORKSPACE_ID VÀO CÁC BẢNG LIÊN QUAN
ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES public.workspaces(workspace_id) ON DELETE CASCADE;

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES public.workspaces(workspace_id) ON DELETE CASCADE;

ALTER TABLE public.members
    ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES public.workspaces(workspace_id) ON DELETE CASCADE;

ALTER TABLE public.team_members
    ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES public.workspaces(workspace_id) ON DELETE CASCADE;

-- Bổ sung cho các bảng tiện ích nếu bảng đã tồn tại
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
        ALTER TABLE public.notifications
            ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES public.workspaces(workspace_id) ON DELETE CASCADE;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_conversations') THEN
        ALTER TABLE public.ai_conversations
            ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES public.workspaces(workspace_id) ON DELETE CASCADE;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_change_logs') THEN
        ALTER TABLE public.task_change_logs
            ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES public.workspaces(workspace_id) ON DELETE CASCADE;
    END IF;
END $$;

-- 3. KHỞI TẠO WORKSPACE MẶC ĐỊNH (WS_01) CHO DỮ LIỆU HIỆN CÓ
DO $$
DECLARE
    v_first_user_id UUID;
BEGIN
    -- Lấy người dùng đầu tiên (nếu có) làm owner tạm cho WS_01
    SELECT id INTO v_first_user_id FROM auth.users ORDER BY created_at ASC LIMIT 1;

    INSERT INTO public.workspaces (workspace_id, workspace_name, owner_id)
    VALUES ('WS_01', 'Workspace Mặc định', v_first_user_id)
    ON CONFLICT (workspace_id) DO NOTHING;

    -- Gán toàn bộ dữ liệu cũ chưa có workspace_id vào WS_01
    UPDATE public.events SET workspace_id = 'WS_01' WHERE workspace_id IS NULL;
    UPDATE public.tasks SET workspace_id = 'WS_01' WHERE workspace_id IS NULL;
    UPDATE public.members SET workspace_id = 'WS_01' WHERE workspace_id IS NULL;
    UPDATE public.team_members SET workspace_id = 'WS_01' WHERE workspace_id IS NULL;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
        UPDATE public.notifications SET workspace_id = 'WS_01' WHERE workspace_id IS NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_conversations') THEN
        UPDATE public.ai_conversations SET workspace_id = 'WS_01' WHERE workspace_id IS NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_change_logs') THEN
        UPDATE public.task_change_logs SET workspace_id = 'WS_01' WHERE workspace_id IS NULL;
    END IF;
END $$;

-- 4. HÀM & TRIGGER TỰ ĐỘNG TẠO WORKSPACE KHI CÓ USER ĐĂNG KÝ MỚI
CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max_ws_num INTEGER := 0;
    v_new_ws_id TEXT;
    v_ws_name TEXT;
    v_max_mem_num INTEGER := 0;
    v_new_mem_id TEXT;
    v_full_name TEXT;
    v_existing_team_member RECORD;
BEGIN
    -- Kiểm tra xem user này đã có trong team_members chưa
    SELECT * INTO v_existing_team_member
    FROM public.team_members
    WHERE user_id = NEW.id
    LIMIT 1;

    -- Nếu đã có thì không tạo lại
    IF v_existing_team_member.user_id IS NOT NULL AND v_existing_team_member.workspace_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- 1. Tìm số thứ tự lớn nhất của workspace_id (dạng WS_01, WS_02...)
    SELECT COALESCE(MAX(NULLIF(regexp_replace(workspace_id, '\D', '', 'g'), '')::INTEGER), 0)
    INTO v_max_ws_num
    FROM public.workspaces;

    v_new_ws_id := 'WS_' || LPAD((v_max_ws_num + 1)::TEXT, 2, '0');

    -- Lấy họ tên người dùng từ metadata hoặc email
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1),
        'Thành viên'
    );
    v_ws_name := 'Workspace của ' || v_full_name;

    -- 2. Tạo Workspace mới
    INSERT INTO public.workspaces (workspace_id, workspace_name, owner_id)
    VALUES (v_new_ws_id, v_ws_name, NEW.id)
    ON CONFLICT (workspace_id) DO NOTHING;

    -- 3. Tạo hồ sơ member mới
    SELECT COALESCE(MAX(NULLIF(regexp_replace(member_id, '\D', '', 'g'), '')::INTEGER), 0)
    INTO v_max_mem_num
    FROM public.members;

    v_new_mem_id := 'MEM_' || LPAD((v_max_mem_num + 1)::TEXT, 2, '0');

    INSERT INTO public.members (
        member_id,
        member_label,
        email,
        is_active,
        workspace_id,
        n_roles_in_roster,
        n_tasks_assigned
    )
    VALUES (
        v_new_mem_id,
        v_full_name,
        NEW.email,
        true,
        v_new_ws_id,
        1,
        0
    )
    ON CONFLICT (member_id) DO NOTHING;

    -- 4. Gán quyền Trưởng nhóm (leader) trong team_members
    INSERT INTO public.team_members (user_id, member_id, account_role, workspace_id)
    VALUES (NEW.id, v_new_mem_id, 'leader', v_new_ws_id)
    ON CONFLICT (user_id) DO UPDATE
    SET workspace_id = EXCLUDED.workspace_id,
        account_role = 'leader',
        member_id = COALESCE(public.team_members.member_id, EXCLUDED.member_id);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_workspace();

-- 5. ĐÁNH CHỈ MỤC TỐI ƯU HIỆU NĂNG CHO WORKSPACE_ID
CREATE INDEX IF NOT EXISTS idx_events_workspace_id ON public.events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON public.tasks (workspace_id);
CREATE INDEX IF NOT EXISTS idx_members_workspace_id ON public.members (workspace_id);
CREATE INDEX IF NOT EXISTS idx_team_members_workspace_id ON public.team_members (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON public.workspaces (owner_id);

-- 6. PHÂN QUYỀN VÀ BẢO MẬT HÀNG (ROW LEVEL SECURITY)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspaces TO authenticated;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- Hàm hỗ trợ lấy danh sách workspace_id mà người dùng hiện tại có tham gia
CREATE OR REPLACE FUNCTION public.get_current_user_workspace_ids()
RETURNS TABLE (ws_id TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT tm.workspace_id 
    FROM public.team_members tm 
    WHERE tm.user_id = auth.uid() AND tm.workspace_id IS NOT NULL;
$$;

-- RLS cho bảng workspaces:
-- User xem được workspace mình làm chủ HOẶC là thành viên trong team_members
DROP POLICY IF EXISTS "Users can view workspaces they belong to" ON public.workspaces;
CREATE POLICY "Users can view workspaces they belong to"
    ON public.workspaces
    FOR SELECT
    TO authenticated
    USING (
        owner_id = auth.uid()
        OR workspace_id IN (SELECT ws_id FROM public.get_current_user_workspace_ids())
    );

DROP POLICY IF EXISTS "Leaders can update their workspaces" ON public.workspaces;
CREATE POLICY "Leaders can update their workspaces"
    ON public.workspaces
    FOR UPDATE
    TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
CREATE POLICY "Authenticated users can create workspaces"
    ON public.workspaces
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);
