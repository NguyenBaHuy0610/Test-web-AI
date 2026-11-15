import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

// Escape ký tự đại diện của LIKE/ILIKE (% và _) để so khớp email chính xác
function escapeLike(value: string) {
    return value.replace(/[\\%_]/g, "\\$&");
}

Deno.serve(async request => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const authorization = request.headers.get("Authorization");

    if (!serviceKey || !supabaseUrl || !anonKey || !authorization?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Supabase function is not configured correctly." }, 500);
    }

    const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
    const adminClient = createClient(supabaseUrl, serviceKey, clientOptions);
    const authClient = createClient(supabaseUrl, anonKey, clientOptions);

    // Trạng thái phục vụ rollback
    let workspaceId: string | null = null;
    let linkMemberId: string | null = null;   // hồ sơ có sẵn được dùng lại (không được xoá khi rollback)
    let createdUserId: string | null = null;
    let createdInvitationId: string | null = null;

    async function rollback() {
        try {
            if (createdUserId) {
                const { data: membership } = await adminClient
                    .from("team_members")
                    .select("member_id, workspace_id")
                    .eq("user_id", createdUserId)
                    .maybeSingle();

                let profileToDelete: string | null = null;
                if (membership) {
                    if (membership.workspace_id === workspaceId) {
                        // Hồ sơ do trigger tạo mới thì xoá; hồ sơ có sẵn thì giữ lại
                        if (membership.member_id !== linkMemberId) {
                            profileToDelete = membership.member_id;
                        }
                    } else {
                        // Tài khoản bị tự cấp workspace riêng: chỉ xoá nếu workspace đó do chính tài khoản này tạo
                        const { data: ws } = await adminClient
                            .from("workspaces")
                            .select("created_by")
                            .eq("workspace_id", membership.workspace_id)
                            .maybeSingle();
                        if (ws && String(ws.created_by) === String(createdUserId)) {
                            const { error } = await adminClient
                                .from("workspaces")
                                .delete()
                                .eq("workspace_id", membership.workspace_id);
                            if (error) console.error("Workspace rollback failed:", error);
                        }
                    }
                }

                const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(createdUserId);
                if (deleteUserError) console.error("Auth user rollback failed:", deleteUserError);

                if (profileToDelete) {
                    const { error } = await adminClient
                        .from("members")
                        .delete()
                        .eq("member_id", profileToDelete);
                    if (error) console.error("Member rollback failed:", error);
                }
            }
            if (createdInvitationId) {
                const { error } = await adminClient
                    .from("workspace_invitations")
                    .delete()
                    .eq("invitation_id", createdInvitationId);
                if (error) console.error("Invitation rollback failed:", error);
            }
        } catch (rollbackError) {
            console.error("Rollback crashed:", rollbackError);
        }
    }

    try {
        // 1. Xác thực người gọi
        const { data: authData, error: authError } =
            await authClient.auth.getUser(authorization.slice(7));
        if (authError || !authData.user) {
            throw new HttpError(401, "Vui lòng đăng nhập lại.");
        }
        const caller = authData.user;

        // 2. Đọc và kiểm tra dữ liệu gửi lên
        let body: Record<string, unknown>;
        try {
            body = await request.json();
        } catch {
            throw new HttpError(400, "Dữ liệu gửi lên không hợp lệ.");
        }
        const memberName = String(body.memberName || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const initialPassword = String(body.initialPassword || "");
        const accountRole = String(body.accountRole || "");
        const requestedMemberId = String(body.memberId || "").trim();
        const requestedWorkspaceId = String(body.workspaceId || "").trim();

        if (!memberName || memberName.length > 100) {
            throw new HttpError(400, "Họ tên không hợp lệ.");
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            throw new HttpError(400, "Email không hợp lệ.");
        }
        if (initialPassword.length < 8 || initialPassword.length > 128) {
            throw new HttpError(400, "Mật khẩu phải có từ 8 đến 128 ký tự.");
        }
        if (!["member", "leader"].includes(accountRole)) {
            throw new HttpError(400, "Vai trò không hợp lệ.");
        }
        if (requestedMemberId.length > 64) {
            throw new HttpError(400, "Mã hồ sơ thành viên không hợp lệ.");
        }
        if (email === String(caller.email || "").toLowerCase()) {
            throw new HttpError(400, "Bạn không thể tạo tài khoản bằng email của chính mình.");
        }

        // 3. Workspace và vai trò của người gọi lấy từ database, không từ client
        const { data: callerMembership, error: membershipError } = await adminClient
            .from("team_members")
            .select("workspace_id, account_role")
            .eq("user_id", caller.id)
            .maybeSingle();
        if (membershipError) throw membershipError;
        if (!callerMembership || callerMembership.account_role !== "leader") {
            throw new HttpError(403, "Chỉ trưởng nhóm mới có thể tạo tài khoản thành viên.");
        }
        workspaceId = String(callerMembership.workspace_id);
        if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
            throw new HttpError(403, "Bạn không có quyền thêm thành viên vào workspace này.");
        }

        // 4. Kiểm tra email chưa bị dùng ở chỗ khác
        const { data: sameEmailProfiles, error: sameEmailError } = await adminClient
            .from("members")
            .select("member_id, workspace_id")
            .ilike("email", escapeLike(email));
        if (sameEmailError) throw sameEmailError;

        let reusableProfileId: string | null = null;
        for (const profile of sameEmailProfiles || []) {
            if (profile.workspace_id !== workspaceId) {
                throw new HttpError(409, "Email này đã được dùng ở một workspace khác.");
            }
            const { data: linked, error: linkedError } = await adminClient
                .from("team_members")
                .select("user_id")
                .eq("member_id", profile.member_id)
                .maybeSingle();
            if (linkedError) throw linkedError;
            if (linked) {
                throw new HttpError(409, "Email này đã thuộc một tài khoản trong workspace.");
            }
            reusableProfileId = profile.member_id;   // hồ sơ có sẵn chưa gắn tài khoản: giữ lại và dùng
        }

        // Lời mời đang chờ từ workspace khác sẽ bị trigger nhận nhầm, nên chặn trước
        const { data: pendingInvitations, error: pendingError } = await adminClient
            .from("workspace_invitations")
            .select("invitation_id, workspace_id, member_id")
            .eq("email", email)
            .eq("status", "pending");
        if (pendingError) throw pendingError;
        if ((pendingInvitations || []).some(inv => inv.workspace_id !== workspaceId)) {
            throw new HttpError(409, "Email này đang có lời mời từ workspace khác.");
        }

        // 5. Xác định hồ sơ có sẵn cần gắn (nếu có)
        if (requestedMemberId) {
            const { data: profile, error: profileError } = await adminClient
                .from("members")
                .select("member_id, workspace_id")
                .eq("member_id", requestedMemberId)
                .maybeSingle();
            if (profileError) throw profileError;
            if (!profile || profile.workspace_id !== workspaceId) {
                throw new HttpError(404, "Không tìm thấy hồ sơ thành viên trong workspace của bạn.");
            }
            if (reusableProfileId && reusableProfileId !== requestedMemberId) {
                throw new HttpError(409, "Email này đang thuộc một hồ sơ thành viên khác.");
            }
            const { data: linked, error: linkedError } = await adminClient
                .from("team_members")
                .select("user_id")
                .eq("member_id", requestedMemberId)
                .maybeSingle();
            if (linkedError) throw linkedError;
            if (linked) {
                throw new HttpError(409, "Hồ sơ này đã gắn với một tài khoản.");
            }
            linkMemberId = requestedMemberId;
        } else {
            linkMemberId = reusableProfileId;
        }

        // 6. Tạo (hoặc cập nhật) lời mời đang chờ cho email này
        const existingInvitation = (pendingInvitations || [])
            .find(inv => inv.workspace_id === workspaceId);
        if (existingInvitation) {
            if (linkMemberId) {
                const { error } = await adminClient
                    .from("workspace_invitations")
                    .update({ member_id: linkMemberId })
                    .eq("invitation_id", existingInvitation.invitation_id);
                if (error) throw error;
            }
        } else {
            const { data: invitation, error: invitationError } = await adminClient
                .from("workspace_invitations")
                .insert({
                    workspace_id: workspaceId,
                    email,
                    member_id: linkMemberId,
                    invited_by: caller.id,
                    status: "pending"
                })
                .select("invitation_id")
                .single();
            if (invitationError) throw invitationError;
            createdInvitationId = invitation.invitation_id;
        }

        // 7. Tạo Auth user. Trigger trong database sẽ đưa tài khoản vào workspace theo lời mời.
        const { data: userData, error: createUserError } = await adminClient.auth.admin.createUser({
            email,
            password: initialPassword,
            email_confirm: true,
            user_metadata: { full_name: memberName }
        });
        if (createUserError) {
            const code = String((createUserError as { code?: string }).code || "");
            if (code === "email_exists" || createUserError.message.toLowerCase().includes("already")) {
                throw new HttpError(409, "Email này đã có tài khoản.");
            }
            throw createUserError;
        }
        createdUserId = userData.user.id;

        // 8. Trigger nuốt lỗi để không chặn đăng ký, nên phải kiểm tra lại kết quả
        const { data: membership, error: checkError } = await adminClient
            .from("team_members")
            .select("member_id, workspace_id")
            .eq("user_id", createdUserId)
            .maybeSingle();
        if (checkError) throw checkError;
        if (!membership || membership.workspace_id !== workspaceId) {
            throw new Error("Tài khoản chưa được gán vào đúng workspace.");
        }
        if (linkMemberId && membership.member_id !== linkMemberId) {
            throw new Error("Tài khoản chưa được gắn vào đúng hồ sơ thành viên.");
        }

        // 9. Nâng quyền nếu leader chọn vai trò leader (trigger mặc định tạo vai trò member)
        if (accountRole === "leader") {
            const { error: roleError } = await adminClient
                .from("team_members")
                .update({ account_role: "leader" })
                .eq("user_id", createdUserId);
            if (roleError) throw roleError;
        }

        const { error: restoreMemberError } = await adminClient
            .from("members")
            .update({ is_active: true })
            .eq("member_id", membership.member_id)
            .eq("workspace_id", workspaceId);
        if (restoreMemberError) throw restoreMemberError;

        const { error: clearRemovalError } = await adminClient
            .from("members")
            .update({ removed_from_workspace_at: null })
            .eq("member_id", membership.member_id)
            .eq("workspace_id", workspaceId);
        if (clearRemovalError) {
            const errorText = `${clearRemovalError.message || ""} ${clearRemovalError.details || ""}`;
            if (!errorText.includes("removed_from_workspace_at")) throw clearRemovalError;
            console.warn("Workspace removal migration is not applied; no removal marker was cleared.");
        }

        return jsonResponse(
            { userId: createdUserId, memberId: membership.member_id, workspaceId },
            201
        );
    } catch (error) {
        console.error("Create workspace member failed:", error);
        await rollback();

        if (error instanceof HttpError) {
            return jsonResponse({ error: error.message }, error.status);
        }
        return jsonResponse({ error: "Không thể tạo tài khoản và thêm vào workspace." }, 500);
    }
});