-- Migration: 20261116000000_self_signup_default_leader.sql
-- Mô tả: Mọi tài khoản tự đăng ký mặc định là Leader sở hữu workspace riêng.
-- Chuyển hồ sơ cũ chưa liên kết sang workspace mới nếu trùng email để tránh lỗi uq_members_email.
-- Tài khoản thành viên (member) chỉ do Leader tạo sẵn qua chức năng thêm thành viên.

-- 1. Sửa aecpt_members_guard: Cho phép chuyển workspace_id nếu member chưa liên kết tài khoản
CREATE OR REPLACE FUNCTION public.aecpt_members_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF tg_op = 'INSERT' THEN
    IF new.member_id IS NULL THEN
      new.member_id := public.aecpt_gen_id('MEM_');
    END IF;
    new.workspace_id := COALESCE(new.workspace_id, public.my_workspace_id());
    IF new.workspace_id IS NULL THEN
      RAISE EXCEPTION 'Thiếu workspace_id cho thành viên';
    END IF;
  ELSE
    IF new.workspace_id IS DISTINCT FROM old.workspace_id THEN
      -- Cho phép chuyển workspace nếu thành viên cũ chưa gắn với tài khoản nào
      IF EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.member_id = old.member_id) THEN
        RAISE EXCEPTION 'Không được đổi workspace_id của thành viên đã liên kết tài khoản';
      END IF;
    END IF;
    IF new.member_id IS DISTINCT FROM old.member_id THEN
      RAISE EXCEPTION 'Không được đổi mã thành viên';
    END IF;
  END IF;
  RETURN new;
END;
$$;

-- 2. Cập nhật aecpt_provision_user: Luôn cấp Workspace riêng + vai trò Leader cho tài khoản tự đăng ký
CREATE OR REPLACE FUNCTION public.aecpt_provision_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u              RECORD;
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

  -- 1. Tạo Workspace mới cho tài khoản tự đăng ký (mặc định làm leader)
  INSERT INTO public.workspaces (workspace_name, created_by)
  VALUES ('Workspace của ' || v_name, p_user_id)
  RETURNING workspace_id INTO v_ws;

  -- 2. Kiểm tra xem email này đã từng có hồ sơ thành viên cũ chưa
  SELECT * INTO v_existing_mem
  FROM public.members
  WHERE LOWER(email) = LOWER(u.email)
  LIMIT 1;

  IF v_existing_mem.member_id IS NOT NULL THEN
    -- Nếu hồ sơ cũ chưa gắn với tài khoản nào, chuyển hồ sơ này sang workspace mới của leader
    IF NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.member_id = v_existing_mem.member_id) THEN
      UPDATE public.members
      SET workspace_id = v_ws,
          member_label = COALESCE(v_name, member_label),
          is_active = true
      WHERE member_id = v_existing_mem.member_id;
      v_member := v_existing_mem.member_id;
    ELSE
      -- Nếu hồ sơ cũ đã gắn với tài khoản khác, gỡ email khỏi hồ sơ cũ để tránh vi phạm uq_members_email
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

  -- 3. Gán vai trò leader trong team_members
  INSERT INTO public.team_members (member_id, user_id, account_role, workspace_id)
  VALUES (v_member, p_user_id, 'leader', v_ws)
  ON CONFLICT (user_id) DO UPDATE
  SET workspace_id = EXCLUDED.workspace_id,
      account_role = 'leader',
      member_id = EXCLUDED.member_id;

  RETURN;
END;
$$;

-- 3. Cập nhật trigger aecpt_on_auth_user
CREATE OR REPLACE FUNCTION public.aecpt_on_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.email_confirmed_at IS NOT NULL THEN
    BEGIN
      PERFORM public.aecpt_provision_user(new.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'aecpt_provision_user lỗi cho %: %', new.id, SQLERRM;
    END;
  END IF;
  RETURN new;
END;
$$;

-- 4. RPC ensure_my_workspace để client gọi an toàn
CREATE OR REPLACE FUNCTION public.ensure_my_workspace()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ws  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;
  PERFORM public.aecpt_provision_user(v_uid);
  SELECT workspace_id INTO v_ws FROM public.team_members WHERE user_id = v_uid LIMIT 1;
  RETURN v_ws;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_my_workspace() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aecpt_provision_user(uuid) TO authenticated;

-- 5. Kích hoạt ngay cho tài khoản nguyenbahuy0610@gmail.com
DO $$
DECLARE
  v_huy_id UUID;
BEGIN
  SELECT id INTO v_huy_id FROM auth.users WHERE LOWER(email) = 'nguyenbahuy0610@gmail.com' LIMIT 1;
  IF v_huy_id IS NOT NULL THEN
    PERFORM public.aecpt_provision_user(v_huy_id);
  END IF;
END $$;
