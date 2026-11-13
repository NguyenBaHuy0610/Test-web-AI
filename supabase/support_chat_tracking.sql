-- =========================================================================
-- BẢO MẪU AECPT - SQL THEO DÕI THAY ĐỔI CÔNG VIỆC & TRẠNG THÁI WIDGET CHAT
-- Chạy toàn bộ script này trong Supabase Dashboard -> SQL Editor
-- =========================================================================

-- 1. Bổ sung cột created_at / updated_at cho bảng tasks và events
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.aecpt_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_touch_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_touch_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.aecpt_touch_updated_at();

DROP TRIGGER IF EXISTS trg_events_touch_updated_at ON public.events;
CREATE TRIGGER trg_events_touch_updated_at
    BEFORE UPDATE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.aecpt_touch_updated_at();

-- 2. Bảng nhật ký thay đổi công việc (mới / sửa / hoàn thành / phân công)
CREATE TABLE IF NOT EXISTS public.task_change_logs (
    log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id TEXT NOT NULL,
    event_id TEXT,
    member_id TEXT,
    change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'completed', 'assignment_changed')),
    summary TEXT,
    old_data JSONB,
    new_data JSONB,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_change_logs_changed_at
    ON public.task_change_logs (changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_change_logs_event_changed
    ON public.task_change_logs (event_id, changed_at DESC);

GRANT SELECT ON TABLE public.task_change_logs TO authenticated;

ALTER TABLE public.task_change_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read task_change_logs" ON public.task_change_logs;
CREATE POLICY "Authenticated users can read task_change_logs"
    ON public.task_change_logs
    FOR SELECT
    TO authenticated
    USING (true);

CREATE OR REPLACE FUNCTION public.aecpt_log_task_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type TEXT;
    v_summary TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.task_change_logs (task_id, event_id, change_type, summary, new_data)
        VALUES (
            NEW.task_id,
            NEW.event_id,
            'created',
            'Tạo công việc mới: ' || COALESCE(NEW.task_title, NEW.task_id),
            jsonb_build_object(
                'task_title', NEW.task_title,
                'status', NEW.status,
                'package_deadline_at', NEW.package_deadline_at,
                'package_deadline_date', NEW.package_deadline_date
            )
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (NEW.status IS DISTINCT FROM OLD.status)
            OR (NEW.post_done IS DISTINCT FROM OLD.post_done)
            OR (NEW.package_deadline_at IS DISTINCT FROM OLD.package_deadline_at)
            OR (NEW.package_deadline_date IS DISTINCT FROM OLD.package_deadline_date)
            OR (NEW.is_cancelled IS DISTINCT FROM OLD.is_cancelled)
            OR (NEW.task_title IS DISTINCT FROM OLD.task_title)
        THEN
            IF (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
                OR (NEW.post_done = true AND OLD.post_done IS DISTINCT FROM true)
            THEN
                v_type := 'completed';
                v_summary := 'Hoàn thành công việc: ' || COALESCE(NEW.task_title, NEW.task_id);
            ELSE
                v_type := 'updated';
                v_summary := 'Cập nhật công việc: ' || COALESCE(NEW.task_title, NEW.task_id);
            END IF;

            INSERT INTO public.task_change_logs (task_id, event_id, change_type, summary, old_data, new_data)
            VALUES (
                NEW.task_id,
                NEW.event_id,
                v_type,
                v_summary,
                jsonb_build_object(
                    'task_title', OLD.task_title,
                    'status', OLD.status,
                    'post_done', OLD.post_done,
                    'is_cancelled', OLD.is_cancelled,
                    'package_deadline_at', OLD.package_deadline_at,
                    'package_deadline_date', OLD.package_deadline_date
                ),
                jsonb_build_object(
                    'task_title', NEW.task_title,
                    'status', NEW.status,
                    'post_done', NEW.post_done,
                    'is_cancelled', NEW.is_cancelled,
                    'package_deadline_at', NEW.package_deadline_at,
                    'package_deadline_date', NEW.package_deadline_date
                )
            );
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_change_log ON public.tasks;
CREATE TRIGGER trg_tasks_change_log
    AFTER INSERT OR UPDATE ON public.tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.aecpt_log_task_changes();

CREATE OR REPLACE FUNCTION public.aecpt_log_assignment_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id TEXT;
    v_task_title TEXT;
    v_type TEXT;
BEGIN
    SELECT t.event_id, t.task_title
    INTO v_event_id, v_task_title
    FROM public.tasks t
    WHERE t.task_id = NEW.task_id
    LIMIT 1;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.task_change_logs (task_id, event_id, member_id, change_type, summary, new_data)
        VALUES (
            NEW.task_id,
            v_event_id,
            NEW.member_id,
            'assignment_changed',
            'Phân công ' || COALESCE(NEW.member_id, '') || ' (' || COALESCE(NEW.role, '') || ') cho ' || COALESCE(v_task_title, NEW.task_id),
            jsonb_build_object(
                'member_id', NEW.member_id,
                'role', NEW.role,
                'assignment_state', NEW.assignment_state,
                'is_done', NEW.is_done
            )
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (NEW.assignment_state IS DISTINCT FROM OLD.assignment_state)
            OR (NEW.is_done IS DISTINCT FROM OLD.is_done)
            OR (NEW.member_id IS DISTINCT FROM OLD.member_id)
            OR (NEW.role IS DISTINCT FROM OLD.role)
        THEN
            IF (NEW.is_done = true AND OLD.is_done IS DISTINCT FROM true)
                OR (NEW.assignment_state = 'completed' AND OLD.assignment_state IS DISTINCT FROM 'completed')
            THEN
                v_type := 'completed';
            ELSE
                v_type := 'assignment_changed';
            END IF;

            INSERT INTO public.task_change_logs (task_id, event_id, member_id, change_type, summary, old_data, new_data)
            VALUES (
                NEW.task_id,
                v_event_id,
                NEW.member_id,
                v_type,
                CASE
                    WHEN v_type = 'completed' THEN 'Hoàn thành phần việc: ' || COALESCE(v_task_title, NEW.task_id)
                    ELSE 'Cập nhật phân công/trạng thái: ' || COALESCE(v_task_title, NEW.task_id)
                END,
                jsonb_build_object(
                    'member_id', OLD.member_id,
                    'role', OLD.role,
                    'assignment_state', OLD.assignment_state,
                    'is_done', OLD.is_done
                ),
                jsonb_build_object(
                    'member_id', NEW.member_id,
                    'role', NEW.role,
                    'assignment_state', NEW.assignment_state,
                    'is_done', NEW.is_done
                )
            );
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_assignments_change_log ON public.task_assignments;
CREATE TRIGGER trg_task_assignments_change_log
    AFTER INSERT OR UPDATE ON public.task_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.aecpt_log_assignment_changes();

-- 3. Bảng lưu is_first_chat, last_visit và hội thoại của Bảo mẫu AECPT theo user_id
CREATE TABLE IF NOT EXISTS public.user_widget_state (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    is_first_chat BOOLEAN NOT NULL DEFAULT TRUE,
    last_visit TIMESTAMPTZ,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_widget_state TO authenticated;

ALTER TABLE public.user_widget_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own user_widget_state" ON public.user_widget_state;
CREATE POLICY "Users can manage their own user_widget_state"
    ON public.user_widget_state
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

