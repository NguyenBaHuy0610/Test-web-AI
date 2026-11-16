-- Migration: 20261116111000_fix_email_queue_notif_insert.sql
-- Mô tả: Cập nhật hàm aecpt_get_pending_email_queue khớp đúng check constraints của notifications (type, priority)

CREATE OR REPLACE FUNCTION public.aecpt_get_pending_email_queue(
    p_force_all BOOLEAN DEFAULT false,
    p_target_workspace_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_now_vn TIMESTAMPTZ := now() AT TIME ZONE 'Asia/Ho_Chi_Minh';
    v_now_vn_time TIME := (v_now_vn)::TIME;
    v_today_vn_str TEXT := to_char(v_now_vn, 'YYYY-MM-DD');

    v_member_reminders JSONB := '[]'::jsonb;
    v_unassigned_reminders JSONB := '[]'::jsonb;
    v_leader_summaries JSONB := '[]'::jsonb;

    v_rec RECORD;
    v_leader_rec RECORD;
    v_tasks_in_48h JSONB;
    v_dedupe_key TEXT;
    v_notif_key TEXT;
BEGIN
    -- --------------------------------------------------------------------------
    -- 1. QUÉT TASK CÒN <= 24H CỦA SỰ KIỆN ACTIVE CÓ NGƯỜI PHỤ TRÁCH (Primary)
    -- --------------------------------------------------------------------------
    FOR v_rec IN
        SELECT DISTINCT ON (t.task_id, m.email)
            t.task_id,
            t.task_no,
            t.task_title,
            t.submission_label,
            t.task_type,
            t.status AS task_status,
            t.package_deadline_at,
            t.workspace_id,
            e.event_id,
            e.event_label,
            m.member_id,
            m.member_label,
            m.email AS member_email,
            tm.user_id AS member_user_id
        FROM public.tasks t
        JOIN public.events e ON e.event_id = t.event_id AND e.workspace_id = t.workspace_id
        JOIN public.task_assignments ta ON ta.task_id = t.task_id
        JOIN public.members m ON m.member_id = ta.member_id AND m.workspace_id = t.workspace_id
        LEFT JOIN public.team_members tm ON tm.member_id = m.member_id AND tm.workspace_id = t.workspace_id
        WHERE e.status = 'active'
          AND (e.is_completed IS FALSE OR e.is_completed IS NULL)
          AND (t.is_cancelled IS FALSE OR t.is_cancelled IS NULL)
          AND t.status <> 'done'
          AND m.is_active = true
          AND m.email IS NOT NULL AND trim(m.email) <> ''
          AND t.package_deadline_at IS NOT NULL
          AND t.package_deadline_at > now()
          AND (t.package_deadline_at <= now() + interval '24 hours 15 minutes' OR p_force_all = true)
          AND (p_target_workspace_id IS NULL OR t.workspace_id = p_target_workspace_id)
        ORDER BY t.task_id, m.email, t.package_deadline_at ASC
    LOOP
        v_dedupe_key := 'member_24h:' || v_rec.task_id || ':' || lower(trim(v_rec.member_email));

        -- Kiểm tra nếu chưa gửi mail cho task này
        IF p_force_all OR NOT EXISTS (
            SELECT 1 FROM public.email_logs el 
            WHERE el.dedupe_key = v_dedupe_key AND el.status IN ('sent', 'simulated')
        ) THEN
            v_member_reminders := v_member_reminders || jsonb_build_object(
                'task_id', v_rec.task_id,
                'task_no', v_rec.task_no,
                'task_title', COALESCE(v_rec.submission_label, v_rec.task_title),
                'task_type', COALESCE(v_rec.task_type, 'Chung'),
                'task_status', v_rec.task_status,
                'package_deadline_at', v_rec.package_deadline_at,
                'deadline_formatted', to_char(v_rec.package_deadline_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY'),
                'workspace_id', v_rec.workspace_id,
                'event_id', v_rec.event_id,
                'event_label', v_rec.event_label,
                'member_id', v_rec.member_id,
                'member_name', v_rec.member_label,
                'recipient_email', lower(trim(v_rec.member_email)),
                'recipient_user_id', v_rec.member_user_id,
                'dedupe_key', v_dedupe_key,
                'mail_type', 'member_24h_reminder',
                'subject', '[AECPT Nhắc việc] Còn 24h đến hạn nộp bản nháp: ' || COALESCE(v_rec.submission_label, v_rec.task_title)
            );

            -- Tự động tạo in-app notification cho thành viên (type='deadline_reminder', priority='high')
            IF v_rec.member_user_id IS NOT NULL THEN
                v_notif_key := 'notif_member_24h:' || v_rec.task_id || ':' || v_rec.member_user_id;
                IF NOT EXISTS (
                    SELECT 1 FROM public.notifications n 
                    WHERE n.user_id = v_rec.member_user_id AND n.dedupe_key = v_notif_key
                ) THEN
                    INSERT INTO public.notifications (
                        user_id,
                        member_id,
                        event_id,
                        task_id,
                        title,
                        message,
                        type,
                        priority,
                        is_read,
                        dedupe_key,
                        metadata
                    ) VALUES (
                        v_rec.member_user_id,
                        v_rec.member_id,
                        v_rec.event_id,
                        v_rec.task_id,
                        'Đến hạn nộp nháp trong 24h: ' || COALESCE(v_rec.submission_label, v_rec.task_title),
                        'Công việc "' || COALESCE(v_rec.submission_label, v_rec.task_title) || '" của sự kiện "' || v_rec.event_label || '" có hạn nộp nháp lúc ' || to_char(v_rec.package_deadline_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY') || '. Vui lòng hoàn tất đúng tiến độ.',
                        'deadline_reminder',
                        'high',
                        false,
                        v_notif_key,
                        jsonb_build_object('deadline_at', v_rec.package_deadline_at, 'task_id', v_rec.task_id)
                    );
                END IF;
            END IF;
        END IF;
    END LOOP;

    -- --------------------------------------------------------------------------
    -- 2. QUÉT TASK CÒN <= 24H CHƯA CÓ NGƯỜI PHỤ TRÁCH -> CẢNH BÁO CHO TẤT CẢ LEADER
    -- --------------------------------------------------------------------------
    FOR v_rec IN
        SELECT
            t.task_id,
            t.task_no,
            t.task_title,
            t.submission_label,
            t.task_type,
            t.status AS task_status,
            t.package_deadline_at,
            t.workspace_id,
            e.event_id,
            e.event_label
        FROM public.tasks t
        JOIN public.events e ON e.event_id = t.event_id AND e.workspace_id = t.workspace_id
        WHERE e.status = 'active'
          AND (e.is_completed IS FALSE OR e.is_completed IS NULL)
          AND (t.is_cancelled IS FALSE OR t.is_cancelled IS NULL)
          AND t.status <> 'done'
          AND t.package_deadline_at IS NOT NULL
          AND t.package_deadline_at > now()
          AND (t.package_deadline_at <= now() + interval '24 hours 15 minutes' OR p_force_all = true)
          AND (p_target_workspace_id IS NULL OR t.workspace_id = p_target_workspace_id)
          AND NOT EXISTS (
              SELECT 1 FROM public.task_assignments ta2 
              WHERE ta2.task_id = t.task_id AND ta2.member_id IS NOT NULL
          )
        ORDER BY t.package_deadline_at ASC
    LOOP
        -- Gửi cho tất cả Leader của Workspace đó
        FOR v_leader_rec IN
            SELECT 
                tm.user_id AS leader_user_id,
                tm.workspace_id,
                COALESCE(m.member_label, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Trưởng ban') AS leader_name,
                COALESCE(m.email, u.email) AS leader_email
            FROM public.team_members tm
            JOIN auth.users u ON u.id = tm.user_id
            LEFT JOIN public.members m ON m.member_id = tm.member_id AND m.workspace_id = tm.workspace_id
            WHERE tm.workspace_id = v_rec.workspace_id
              AND tm.account_role = 'leader'
        LOOP
            IF v_leader_rec.leader_email IS NOT NULL AND trim(v_leader_rec.leader_email) <> '' THEN
                v_dedupe_key := 'unassigned_urgent:' || v_rec.task_id || ':' || v_leader_rec.leader_user_id;

                IF p_force_all OR NOT EXISTS (
                    SELECT 1 FROM public.email_logs el 
                    WHERE el.dedupe_key = v_dedupe_key AND el.status IN ('sent', 'simulated')
                ) THEN
                    v_unassigned_reminders := v_unassigned_reminders || jsonb_build_object(
                        'task_id', v_rec.task_id,
                        'task_no', v_rec.task_no,
                        'task_title', COALESCE(v_rec.submission_label, v_rec.task_title),
                        'task_type', COALESCE(v_rec.task_type, 'Chưa xác định'),
                        'package_deadline_at', v_rec.package_deadline_at,
                        'deadline_formatted', to_char(v_rec.package_deadline_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY'),
                        'workspace_id', v_rec.workspace_id,
                        'event_id', v_rec.event_id,
                        'event_label', v_rec.event_label,
                        'leader_name', v_leader_rec.leader_name,
                        'recipient_email', lower(trim(v_leader_rec.leader_email)),
                        'recipient_user_id', v_leader_rec.leader_user_id,
                        'dedupe_key', v_dedupe_key,
                        'mail_type', 'leader_unassigned_urgent',
                        'subject', '[AECPT Khẩn cấp] Task chưa có người phụ trách còn dưới 24h: ' || COALESCE(v_rec.submission_label, v_rec.task_title)
                    );

                    -- In-app notification khẩn cho Leader (type='deadline_reminder', priority='urgent')
                    v_notif_key := 'notif_unassigned_urgent:' || v_rec.task_id || ':' || v_leader_rec.leader_user_id;
                    IF NOT EXISTS (
                        SELECT 1 FROM public.notifications n 
                        WHERE n.user_id = v_leader_rec.leader_user_id AND n.dedupe_key = v_notif_key
                    ) THEN
                        INSERT INTO public.notifications (
                            user_id,
                            event_id,
                            task_id,
                            title,
                            message,
                            type,
                            priority,
                            is_read,
                            dedupe_key,
                            metadata
                        ) VALUES (
                            v_leader_rec.leader_user_id,
                            v_rec.event_id,
                            v_rec.task_id,
                            'Cảnh báo: Task chưa phân công sắp đến hạn (' || COALESCE(v_rec.submission_label, v_rec.task_title) || ')',
                            'Công việc "' || COALESCE(v_rec.submission_label, v_rec.task_title) || '" của sự kiện "' || v_rec.event_label || '" có hạn nộp nháp lúc ' || to_char(v_rec.package_deadline_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY') || ' nhưng hiện tại chưa có người phụ trách!',
                            'deadline_reminder',
                            'urgent',
                            false,
                            v_notif_key,
                            jsonb_build_object('deadline_at', v_rec.package_deadline_at, 'task_id', v_rec.task_id)
                        );
                    END IF;
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    -- --------------------------------------------------------------------------
    -- 3. QUÉT MAIL TỔNG HỢP HẰNG NGÀY CHO TỪNG LEADER (Khung giờ riêng + 0-48h)
    -- --------------------------------------------------------------------------
    FOR v_leader_rec IN
        SELECT 
            tm.user_id AS leader_user_id,
            tm.workspace_id,
            tm.daily_summary_time,
            COALESCE(m.member_label, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Trưởng ban') AS leader_name,
            COALESCE(m.email, u.email) AS leader_email,
            w.workspace_name
        FROM public.team_members tm
        JOIN auth.users u ON u.id = tm.user_id
        JOIN public.workspaces w ON w.workspace_id = tm.workspace_id
        LEFT JOIN public.members m ON m.member_id = tm.member_id AND m.workspace_id = tm.workspace_id
        WHERE tm.account_role = 'leader'
          AND (p_target_workspace_id IS NULL OR tm.workspace_id = p_target_workspace_id)
    LOOP
        IF v_leader_rec.leader_email IS NOT NULL AND trim(v_leader_rec.leader_email) <> '' THEN
            -- Kiểm tra xem giờ hiện tại có khớp khung giờ nhận mail của Leader không (cho phép lệch ±15 phút theo chu kỳ cron)
            IF p_force_all OR (
                abs(EXTRACT(EPOCH FROM (v_leader_rec.daily_summary_time - v_now_vn_time))) <= 900
                OR (
                    EXTRACT(HOUR FROM v_leader_rec.daily_summary_time) = EXTRACT(HOUR FROM v_now_vn_time)
                    AND abs(EXTRACT(MINUTE FROM v_leader_rec.daily_summary_time) - EXTRACT(MINUTE FROM v_now_vn_time)) <= 15
                )
            ) THEN
                v_dedupe_key := 'leader_daily:' || v_leader_rec.workspace_id || ':' || v_leader_rec.leader_user_id || ':' || v_today_vn_str;

                IF p_force_all OR NOT EXISTS (
                    SELECT 1 FROM public.email_logs el 
                    WHERE el.dedupe_key = v_dedupe_key AND el.status IN ('sent', 'simulated')
                ) THEN
                    -- Gom danh sách công việc còn hạn trong 0 - 48h của sự kiện đang active trong workspace
                    SELECT COALESCE(jsonb_agg(task_row), '[]'::jsonb) INTO v_tasks_in_48h
                    FROM (
                        SELECT
                            t.task_id,
                            t.task_no,
                            COALESCE(t.submission_label, t.task_title) AS task_title,
                            COALESCE(t.task_type, ta.role, 'Chung') AS task_role,
                            t.status AS task_status,
                            t.package_deadline_at,
                            to_char(t.package_deadline_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY') AS deadline_formatted,
                            COALESCE(m.member_label, 'Chưa phân công') AS assignee_name,
                            e.event_label
                        FROM public.tasks t
                        JOIN public.events e ON e.event_id = t.event_id AND e.workspace_id = t.workspace_id
                        LEFT JOIN public.task_assignments ta ON ta.task_id = t.task_id
                        LEFT JOIN public.members m ON m.member_id = ta.member_id AND m.workspace_id = t.workspace_id
                        WHERE t.workspace_id = v_leader_rec.workspace_id
                          AND e.status = 'active'
                          AND (e.is_completed IS FALSE OR e.is_completed IS NULL)
                          AND (t.is_cancelled IS FALSE OR t.is_cancelled IS NULL)
                          AND t.status <> 'done'
                          AND t.package_deadline_at IS NOT NULL
                          AND t.package_deadline_at > now()
                          AND t.package_deadline_at <= now() + interval '48 hours'
                        ORDER BY 
                            COALESCE(t.task_type, ta.role, 'Chung') ASC,
                            t.package_deadline_at ASC
                    ) AS task_row;

                    v_leader_summaries := v_leader_summaries || jsonb_build_object(
                        'leader_name', v_leader_rec.leader_name,
                        'recipient_email', lower(trim(v_leader_rec.leader_email)),
                        'recipient_user_id', v_leader_rec.leader_user_id,
                        'workspace_id', v_leader_rec.workspace_id,
                        'workspace_name', v_leader_rec.workspace_name,
                        'summary_date', v_today_vn_str,
                        'daily_summary_time', v_leader_rec.daily_summary_time,
                        'dedupe_key', v_dedupe_key,
                        'mail_type', 'leader_daily_summary',
                        'subject', '[AECPT Tổng hợp hằng ngày] Tiến độ các công việc trong 48h - ' || v_today_vn_str,
                        'tasks', v_tasks_in_48h,
                        'task_count', jsonb_array_length(v_tasks_in_48h)
                    );

                    -- Tạo in-app notification cho Leader về việc có báo cáo tổng hợp (type='system', priority='normal')
                    v_notif_key := 'notif_leader_daily:' || v_leader_rec.workspace_id || ':' || v_leader_rec.leader_user_id || ':' || v_today_vn_str;
                    IF NOT EXISTS (
                        SELECT 1 FROM public.notifications n 
                        WHERE n.user_id = v_leader_rec.leader_user_id AND n.dedupe_key = v_notif_key
                    ) THEN
                        INSERT INTO public.notifications (
                            user_id,
                            title,
                            message,
                            type,
                            priority,
                            is_read,
                            dedupe_key,
                            metadata
                        ) VALUES (
                            v_leader_rec.leader_user_id,
                            'Báo cáo tổng hợp công việc hằng ngày (' || v_today_vn_str || ')',
                            'Hệ thống đã lập danh sách ' || jsonb_array_length(v_tasks_in_48h) || ' công việc có hạn nộp nháp trong 48 giờ tới của sự kiện đang diễn ra.',
                            'system',
                            'normal',
                            false,
                            v_notif_key,
                            jsonb_build_object('summary_date', v_today_vn_str, 'task_count', jsonb_array_length(v_tasks_in_48h))
                        );
                    END IF;
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'server_time_vn', to_char(v_now_vn, 'YYYY-MM-DD HH24:MI:SS'),
        'member_reminders', v_member_reminders,
        'unassigned_urgent_reminders', v_unassigned_reminders,
        'leader_daily_summaries', v_leader_summaries,
        'total_pending', jsonb_array_length(v_member_reminders) + jsonb_array_length(v_unassigned_reminders) + jsonb_array_length(v_leader_summaries)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aecpt_get_pending_email_queue(BOOLEAN, TEXT) TO authenticated, service_role;
