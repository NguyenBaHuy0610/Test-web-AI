-- Migration: 20261118093000_enhance_comment_role_mentions.sql
-- Mô tả: Mở rộng phân giải @mention theo vai trò (ban Content, Design, Edit, Tech, Leader) từ cả member_roles và team_members

CREATE OR REPLACE FUNCTION public.aecpt_create_comment(
    p_task_id TEXT,
    p_parent_id UUID,
    p_content TEXT,
    p_mentions JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_workspace_id TEXT;
    v_task_title TEXT;
    v_event_id TEXT;
    v_author_name TEXT;
    v_author_role TEXT;
    v_author_avatar TEXT;
    v_new_comment_id UUID;
    v_comment_row RECORD;
    v_recipient_user_ids UUID[] := ARRAY[]::UUID[];
    v_mention_user_ids UUID[] := ARRAY[]::UUID[];
    v_recipient_id UUID;
    v_parent_author_id UUID;
    v_primary_member_id TEXT;
    v_primary_user_id UUID;
    v_leader_rec RECORD;
    v_mention_item JSONB;
    v_emails_to_send JSONB := '[]'::jsonb;
    v_notif_title TEXT;
    v_notif_message TEXT;
    v_notif_type TEXT;
    v_email_user RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Yêu cầu đăng nhập trước khi bình luận.';
    END IF;

    IF trim(COALESCE(p_content, '')) = '' THEN
        RAISE EXCEPTION 'Nội dung bình luận không được để trống.';
    END IF;

    -- 1. Lấy thông tin task và workspace
    SELECT 
        t.workspace_id, 
        COALESCE(t.submission_label, t.task_title, 'Công việc'),
        t.event_id
    INTO v_workspace_id, v_task_title, v_event_id
    FROM public.tasks t
    WHERE t.task_id = p_task_id;

    IF v_workspace_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công việc với mã %', p_task_id;
    END IF;

    -- 2. Lấy thông tin tác giả
    SELECT 
        COALESCE(m.member_label, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email, 'Thành viên'),
        COALESCE(tm.account_role, 'member'),
        u.raw_user_meta_data->>'avatar_url'
    INTO v_author_name, v_author_role, v_author_avatar
    FROM auth.users u
    LEFT JOIN public.team_members tm ON tm.user_id = u.id AND tm.workspace_id = v_workspace_id
    LEFT JOIN public.members m ON m.member_id = tm.member_id AND m.workspace_id = v_workspace_id
    WHERE u.id = v_user_id;

    -- 3. Chèn bản ghi bình luận
    INSERT INTO public.task_comments (
        task_id,
        workspace_id,
        parent_id,
        user_id,
        author_name,
        author_avatar,
        author_role,
        content,
        mentions,
        is_deleted,
        created_at,
        updated_at
    ) VALUES (
        p_task_id,
        v_workspace_id,
        p_parent_id,
        v_user_id,
        v_author_name,
        v_author_avatar,
        v_author_role,
        p_content,
        COALESCE(p_mentions, '[]'::jsonb),
        false,
        now(),
        now()
    )
    RETURNING comment_id INTO v_new_comment_id;

    -- 4. Xác định người nhận thông báo
    -- 4.1 Xử lý @mention (nếu có)
    IF p_mentions IS NOT NULL AND jsonb_array_length(p_mentions) > 0 THEN
        FOR v_mention_item IN SELECT * FROM jsonb_array_elements(p_mentions)
        LOOP
            -- Mention cá nhân: { "type": "user", "id": "uuid" }
            IF v_mention_item->>'type' = 'user' AND (v_mention_item->>'id') IS NOT NULL THEN
                v_mention_user_ids := array_append(v_mention_user_ids, (v_mention_item->>'id')::UUID);
            
            -- Mention theo role: { "type": "role", "role": "content/design/..." }
            ELSIF v_mention_item->>'type' = 'role' AND (v_mention_item->>'role') IS NOT NULL THEN
                IF lower(trim(v_mention_item->>'role')) = 'leader' THEN
                    FOR v_leader_rec IN
                        SELECT tm.user_id
                        FROM public.team_members tm
                        WHERE tm.workspace_id = v_workspace_id AND tm.account_role = 'leader'
                    LOOP
                        v_mention_user_ids := array_append(v_mention_user_ids, v_leader_rec.user_id);
                    END LOOP;
                ELSE
                    FOR v_leader_rec IN
                        SELECT DISTINCT tm.user_id
                        FROM public.team_members tm
                        LEFT JOIN public.task_assignments ta ON ta.member_id = tm.member_id AND ta.task_id = p_task_id
                        LEFT JOIN public.member_roles mr ON mr.member_id = tm.member_id
                        WHERE tm.workspace_id = v_workspace_id
                          AND (
                            lower(trim(COALESCE(ta.role, ''))) = lower(trim(v_mention_item->>'role'))
                            OR lower(trim(COALESCE(mr.role, ''))) ILIKE '%' || lower(trim(v_mention_item->>'role')) || '%'
                            OR (lower(trim(v_mention_item->>'role')) = 'editor' AND lower(trim(COALESCE(mr.role, ''))) ILIKE '%edit%')
                            OR (lower(trim(v_mention_item->>'role')) = 'technician' AND lower(trim(COALESCE(mr.role, ''))) ILIKE '%tech%')
                          )
                    LOOP
                        v_mention_user_ids := array_append(v_mention_user_ids, v_leader_rec.user_id);
                    END LOOP;
                END IF;

            -- Mention @all: { "type": "all" }
            ELSIF v_mention_item->>'type' = 'all' THEN
                FOR v_leader_rec IN
                    SELECT tm.user_id
                    FROM public.team_members tm
                    WHERE tm.workspace_id = v_workspace_id
                LOOP
                    v_mention_user_ids := array_append(v_mention_user_ids, v_leader_rec.user_id);
                END LOOP;
            END IF;
        END LOOP;
    END IF;

    -- 4.2 Xử lý người nhận mặc định khi không @mention hoặc bổ sung
    IF p_parent_id IS NOT NULL THEN
        -- Trường hợp Trả lời (Reply): Báo cho chủ của bình luận được trả lời
        SELECT user_id INTO v_parent_author_id
        FROM public.task_comments
        WHERE comment_id = p_parent_id;

        IF v_parent_author_id IS NOT NULL THEN
            v_recipient_user_ids := array_append(v_recipient_user_ids, v_parent_author_id);
        END IF;
    ELSE
        -- Trường hợp Bình luận gốc (Cấp 1): Báo người phụ trách chính (primary) và toàn bộ Trưởng ban (Leader)
        SELECT tm.user_id INTO v_primary_user_id
        FROM public.task_assignments ta
        JOIN public.team_members tm ON tm.member_id = ta.member_id AND tm.workspace_id = v_workspace_id
        WHERE ta.task_id = p_task_id
        LIMIT 1;

        IF v_primary_user_id IS NOT NULL THEN
            v_recipient_user_ids := array_append(v_recipient_user_ids, v_primary_user_id);
        END IF;

        FOR v_leader_rec IN
            SELECT tm.user_id
            FROM public.team_members tm
            WHERE tm.workspace_id = v_workspace_id AND tm.account_role = 'leader'
        LOOP
            v_recipient_user_ids := array_append(v_recipient_user_ids, v_leader_rec.user_id);
        END LOOP;
    END IF;

    -- 5. Loại bỏ người gửi (Rule 4A) và lọc trùng danh sách (Rule 3A)
    SELECT array_agg(DISTINCT uid) INTO v_recipient_user_ids
    FROM unnest(v_recipient_user_ids || v_mention_user_ids) AS uid
    WHERE uid <> v_user_id;

    -- 6. Tạo thông báo in-app cho từng người nhận
    IF v_recipient_user_ids IS NOT NULL AND array_length(v_recipient_user_ids, 1) > 0 THEN
        FOREACH v_recipient_id IN ARRAY v_recipient_user_ids
        LOOP
            IF v_recipient_id = ANY(v_mention_user_ids) THEN
                v_notif_type := 'task_mention';
                v_notif_title := v_author_name || ' đã nhắc đến bạn trong một bình luận';
                v_notif_message := 'Tại công việc "' || v_task_title || '": "' || left(p_content, 120) || (CASE WHEN length(p_content) > 120 THEN '...' ELSE '' END) || '"';
            ELSIF p_parent_id IS NOT NULL THEN
                v_notif_type := 'task_comment';
                v_notif_title := v_author_name || ' đã trả lời bình luận của bạn';
                v_notif_message := 'Tại công việc "' || v_task_title || '": "' || left(p_content, 120) || (CASE WHEN length(p_content) > 120 THEN '...' ELSE '' END) || '"';
            ELSE
                v_notif_type := 'task_comment';
                v_notif_title := v_author_name || ' đã bình luận về công việc';
                v_notif_message := 'Tại công việc "' || v_task_title || '": "' || left(p_content, 120) || (CASE WHEN length(p_content) > 120 THEN '...' ELSE '' END) || '"';
            END IF;

            INSERT INTO public.notifications (
                user_id,
                event_id,
                task_id,
                title,
                message,
                type,
                priority,
                is_read,
                metadata
            ) VALUES (
                v_recipient_id,
                v_event_id,
                p_task_id,
                v_notif_title,
                v_notif_message,
                v_notif_type,
                'normal',
                false,
                jsonb_build_object(
                    'comment_id', v_new_comment_id,
                    'parent_id', p_parent_id,
                    'author_name', v_author_name
                )
            );
        END LOOP;
    END IF;

    -- 7. Gom danh sách email cần gửi qua Brevo (Chỉ gửi cho những người được @mention theo Rule 2A)
    IF v_mention_user_ids IS NOT NULL AND array_length(v_mention_user_ids, 1) > 0 THEN
        FOR v_email_user IN
            SELECT DISTINCT 
                u.id AS user_id, 
                COALESCE(m.email, u.email) AS email,
                COALESCE(m.member_label, u.raw_user_meta_data->>'full_name', 'Bạn') AS name
            FROM auth.users u
            LEFT JOIN public.team_members tm ON tm.user_id = u.id AND tm.workspace_id = v_workspace_id
            LEFT JOIN public.members m ON m.member_id = tm.member_id AND m.workspace_id = v_workspace_id
            WHERE u.id = ANY(v_mention_user_ids)
              AND u.id <> v_user_id
              AND COALESCE(m.email, u.email) IS NOT NULL
        LOOP
            v_emails_to_send := v_emails_to_send || jsonb_build_object(
                'user_id', v_email_user.user_id,
                'email', v_email_user.email,
                'name', v_email_user.name,
                'task_title', v_task_title,
                'author_name', v_author_name,
                'content', p_content,
                'task_id', p_task_id
            );
        END LOOP;
    END IF;

    -- 8. Lấy toàn bộ thông tin bản ghi vừa tạo để trả về client
    SELECT * INTO v_comment_row FROM public.task_comments WHERE comment_id = v_new_comment_id;

    RETURN jsonb_build_object(
        'ok', true,
        'comment', to_jsonb(v_comment_row),
        'emails_to_send', v_emails_to_send
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aecpt_create_comment(TEXT, UUID, TEXT, JSONB) TO authenticated;
