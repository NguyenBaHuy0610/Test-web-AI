-- Migration: fix workspace invitation provisioning in aecpt_provision_user
-- Description: Ensures users created via workspace invitation are linked to the inviting workspace rather than creating a duplicate workspace

CREATE OR REPLACE FUNCTION public.aecpt_provision_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u              RECORD;
  v_invitation   RECORD;
  v_ws           TEXT;
  v_member       TEXT;
  v_name         TEXT;
  v_existing_mem RECORD;
BEGIN
  SELECT id, email, email_confirmed_at, raw_user_meta_data
    INTO u FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Nếu user đã có liên kết trong team_members thì dừng
  IF EXISTS (SELECT 1 FROM public.team_members WHERE user_id = p_user_id) THEN
    RETURN;
  END IF;

  v_name := COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    NULLIF(split_part(u.email, '@', 1), ''),
    'Thành viên'
  );

  -- 1. Kiểm tra xem có lời mời đang chờ nào cho email này không
  SELECT * INTO v_invitation
  FROM public.workspace_invitations
  WHERE LOWER(email) = LOWER(u.email)
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invitation.invitation_id IS NOT NULL THEN
    -- Được mời vào workspace có sẵn
    v_ws := v_invitation.workspace_id;

    IF v_invitation.member_id IS NOT NULL THEN
      v_member := v_invitation.member_id;
      UPDATE public.members
      SET email = LOWER(u.email),
          is_active = true
      WHERE member_id = v_member AND workspace_id = v_ws;
    ELSE
      SELECT member_id INTO v_member
      FROM public.members
      WHERE LOWER(email) = LOWER(u.email)
        AND workspace_id = v_ws
      LIMIT 1;

      IF v_member IS NULL THEN
        INSERT INTO public.members (member_label, email, workspace_id)
        VALUES (v_name, LOWER(u.email), v_ws)
        RETURNING member_id INTO v_member;
      ELSE
        UPDATE public.members
        SET is_active = true
        WHERE member_id = v_member;
      END IF;
    END IF;

    INSERT INTO public.team_members (member_id, user_id, account_role, workspace_id)
    VALUES (v_member, p_user_id, 'member', v_ws)
    ON CONFLICT (user_id) DO UPDATE
    SET workspace_id = EXCLUDED.workspace_id,
        member_id = EXCLUDED.member_id;

    UPDATE public.workspace_invitations
    SET status = 'accepted',
        responded_at = now()
    WHERE invitation_id = v_invitation.invitation_id;

  ELSE
    -- Tự đăng ký trực tiếp -> Tạo workspace riêng và làm leader
    INSERT INTO public.workspaces (workspace_name, created_by)
    VALUES ('Workspace của ' || v_name, p_user_id)
    RETURNING workspace_id INTO v_ws;

    SELECT * INTO v_existing_mem
    FROM public.members
    WHERE LOWER(email) = LOWER(u.email)
    LIMIT 1;

    IF v_existing_mem.member_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.member_id = v_existing_mem.member_id) THEN
        UPDATE public.members
        SET workspace_id = v_ws,
            member_label = COALESCE(v_name, member_label),
            is_active = true
        WHERE member_id = v_existing_mem.member_id;
        v_member := v_existing_mem.member_id;
      ELSE
        UPDATE public.members SET email = NULL WHERE member_id = v_existing_mem.member_id;
        INSERT INTO public.members (member_label, email, workspace_id)
        VALUES (v_name, LOWER(u.email), v_ws)
        RETURNING member_id INTO v_member;
      END IF;
    ELSE
      INSERT INTO public.members (member_label, email, workspace_id)
      VALUES (v_name, LOWER(u.email), v_ws)
      RETURNING member_id INTO v_member;
    END IF;

    INSERT INTO public.team_members (member_id, user_id, account_role, workspace_id)
    VALUES (v_member, p_user_id, 'leader', v_ws)
    ON CONFLICT (user_id) DO UPDATE
    SET workspace_id = EXCLUDED.workspace_id,
        account_role = 'leader',
        member_id = EXCLUDED.member_id;
  END IF;

  RETURN;
END;
$$;
