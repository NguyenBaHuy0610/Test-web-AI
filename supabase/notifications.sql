-- =========================================================================
-- BẢNG NOTIFICATIONS - THÔNG BÁO HỆ THỐNG & NHẮC DEADLINE CÔNG VIỆC
-- Chạy toàn bộ script này trong Supabase Dashboard -> SQL Editor
-- =========================================================================

-- 1. Tạo bảng notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    member_id TEXT,                     -- Mã thành viên (ví dụ: MEM_01) để liên kết với phân công
    event_id TEXT,                      -- Mã sự kiện liên quan
    task_id TEXT,                       -- Mã công việc liên quan (ví dụ: T001)
    title TEXT NOT NULL,                -- Tiêu đề thông báo ngắn
    message TEXT NOT NULL,              -- Nội dung thông báo chi tiết
    type TEXT NOT NULL CHECK (
        type IN (
            'deadline_reminder',        -- Nhắc hạn chót (gần đến deadline)
            'deadline_overdue',         -- Công việc đã quá hạn
            'task_assigned',            -- Phân công công việc mới
            'task_updated',             -- Thay đổi trạng thái/nội dung công việc
            'task_completed',           -- Công việc đã hoàn thành
            'system'                    -- Thông báo chung của hệ thống
        )
    ),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (
        priority IN ('low', 'normal', 'high', 'urgent')
    ),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb  -- Dữ liệu mở rộng linh hoạt (deadline_at, actor_name, v.v.)
);

-- 2. Đánh chỉ mục tối ưu hiệu năng truy vấn
-- Truy vấn danh sách thông báo của người dùng theo thời gian tạo mới nhất
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON public.notifications (user_id, created_at DESC);

-- Truy vấn đếm số lượng thông báo chưa đọc của người dùng (hiển thị số badge đỏ)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications (user_id, is_read)
    WHERE is_read = FALSE;

-- Tìm nhanh thông báo theo task_id hoặc event_id
CREATE INDEX IF NOT EXISTS idx_notifications_task_id
    ON public.notifications (task_id);

CREATE INDEX IF NOT EXISTS idx_notifications_event_id
    ON public.notifications (event_id);

-- 3. Cấp quyền truy cập cho người dùng đã đăng nhập (authenticated)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO authenticated;

-- 4. Kích hoạt bảo mật theo hàng (Row Level Security - RLS)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Chính sách 1: Người dùng chỉ được xem thông báo của chính mình
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Chính sách 2: Người dùng có thể đánh dấu đã đọc thông báo của chính mình
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
    ON public.notifications
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Chính sách 3: Người dùng đã xác thực (hoặc hệ thống) có thể thêm thông báo
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
CREATE POLICY "Authenticated users can create notifications"
    ON public.notifications
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

-- Chính sách 4: Người dùng có thể xóa thông báo của chính mình
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
CREATE POLICY "Users can delete their own notifications"
    ON public.notifications
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- 5. Hàm tiện ích (RPC Functions) hỗ trợ Frontend gọi trực tiếp
-- 5.1. Đánh dấu 1 thông báo cụ thể là đã đọc
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.notifications
    SET is_read = TRUE,
        read_at = NOW()
    WHERE notification_id = p_notification_id
      AND user_id = auth.uid();

    RETURN FOUND;
END;
$$;

-- 5.2. Đánh dấu TẤT CẢ thông báo của người dùng hiện tại là đã đọc
CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    UPDATE public.notifications
    SET is_read = TRUE,
        read_at = NOW()
    WHERE user_id = auth.uid()
      AND is_read = FALSE;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$;
