document.addEventListener("DOMContentLoaded", async () => {
    document.querySelectorAll(".password-toggle").forEach((button) => {
        button.addEventListener("click", () => {
            const input = document.getElementById(button.dataset.target);
            const isHidden = input.type === "password";
            input.type = isHidden ? "text" : "password";
            button.textContent = isHidden ? "Ẩn" : "Hiện";
            button.setAttribute("aria-label", isHidden ? "Ẩn mật khẩu" : "Hiện mật khẩu");
        });
    });

    const client = window.supabaseClient;
    if (!client) {
        showMessage("profileMessage", "Không kết nối được Supabase. Hãy tải lại trang.", "error");
        return;
    }

    const profileForm = document.getElementById("profileForm");
    const passwordForm = document.getElementById("passwordForm");
    const displayNameInput = document.getElementById("displayName");
    const emailInput = document.getElementById("accountEmail");
    const saveProfileButton = document.getElementById("saveProfileButton");
    const changePasswordButton = document.getElementById("changePasswordButton");
    const signOutButton = document.getElementById("signOutButton");

    function showMessage(id, message, type = "") {
        const element = document.getElementById(id);
        if (!element) return;
        element.textContent = message;
        element.classList.toggle("is-error", type === "error");
        element.classList.toggle("is-success", type === "success");
    }

    function setBusy(button, busy, busyLabel, defaultLabel) {
        button.disabled = busy;
        button.textContent = busy ? busyLabel : defaultLabel;
    }

    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) {
        window.location.replace("login.html");
        return;
    }

    const appUser = window.loadAppUser
        ? await window.loadAppUser()
        : null;
    const metadata = user.user_metadata || {};
    displayNameInput.value = appUser?.name || metadata.full_name || metadata.name || "";
    emailInput.value = user.email || "";

    // Cấu hình riêng cho Trưởng nhóm (Leader): Thời gian nhận email nhắc task tổng hợp
    const leaderEmailSection = document.getElementById("leaderEmailSection");
    const leaderEmailForm = document.getElementById("leaderEmailForm");
    const leaderDailySummaryTime = document.getElementById("leaderDailySummaryTime");
    const saveLeaderEmailButton = document.getElementById("saveLeaderEmailButton");
    const testEmailReminderButton = document.getElementById("testEmailReminderButton");

    const isLeader = Boolean(appUser?.isLeader || appUser?.role === "Trưởng nhóm" || String(appUser?.accountRole || "").toLowerCase() === "leader");
    if (isLeader && leaderEmailSection) {
        leaderEmailSection.hidden = false;

        // Tải giờ nhận mail hiện tại từ database
        (async () => {
            try {
                const { data: savedTime, error: rpcErr } = await client.rpc("get_my_daily_summary_time");
                if (!rpcErr && savedTime) {
                    leaderDailySummaryTime.value = String(savedTime).slice(0, 5);
                } else {
                    const { data: tm } = await client
                        .from("team_members")
                        .select("daily_summary_time")
                        .eq("user_id", user.id)
                        .maybeSingle();
                    if (tm?.daily_summary_time) {
                        leaderDailySummaryTime.value = String(tm.daily_summary_time).slice(0, 5);
                    }
                }
            } catch (err) {
                console.warn("Không thể tải giờ nhận mail của Leader:", err);
            }
        })();

        // Lưu thời gian nhận email
        leaderEmailForm?.addEventListener("submit", async (event) => {
            event.preventDefault();
            showMessage("leaderEmailMessage", "");
            const timeValue = leaderDailySummaryTime.value;
            if (!timeValue) {
                showMessage("leaderEmailMessage", "Vui lòng chọn khung giờ nhận email.", "error");
                return;
            }

            setBusy(saveLeaderEmailButton, true, "Đang lưu…", "Lưu thời gian");
            try {
                const { error: rpcErr } = await client.rpc("set_my_daily_summary_time", {
                    p_time: timeValue
                });
                if (rpcErr) throw rpcErr;

                showMessage("leaderEmailMessage", `Đã lưu thời gian nhận mail tổng hợp: ${timeValue} (Giờ VN).`, "success");
            } catch (err) {
                console.error("Lỗi lưu giờ nhận mail:", err);
                showMessage("leaderEmailMessage", `Không lưu được: ${err.message}`, "error");
            } finally {
                setBusy(saveLeaderEmailButton, false, "Đang lưu…", "Lưu thời gian");
            }
        });

        // Nút gửi thử email nhắc việc ngay
        testEmailReminderButton?.addEventListener("click", async () => {
            showMessage("leaderEmailMessage", "Đang gửi yêu cầu kiểm tra và tạo email nhắc việc…");
            testEmailReminderButton.disabled = true;

            try {
                const sessionRes = await client.auth.getSession();
                const token = sessionRes?.data?.session?.access_token || client.supabaseKey;

                const response = await fetch("https://roxgrvqmctdnajiorwcv.supabase.co/functions/v1/send-task-reminders", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "apikey": client.supabaseKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        force_all: true,
                        target_workspace_id: appUser?.workspaceId || null
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || `HTTP ${response.status}`);
                }

                const stats = data.stats || {};
                const modeLabel = stats.mode === "mock_simulation" ? "(Chế độ mô phỏng / Mock)" : "(Gửi thực tế qua Resend)";
                showMessage(
                    "leaderEmailMessage",
                    `Đã kích hoạt gửi thử thành công! ${modeLabel}. Tổng email xử lý: ${stats.total_queued || 0} (Thành công: ${stats.sent || 0}, Mô phỏng: ${stats.simulated || 0}).`,
                    "success"
                );
            } catch (err) {
                console.error("Lỗi gửi thử email nhắc việc:", err);
                showMessage("leaderEmailMessage", `Không gửi được: ${err.message}`, "error");
            } finally {
                testEmailReminderButton.disabled = false;
            }
        });
    }

    profileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        showMessage("profileMessage", "");
        const fullName = displayNameInput.value.trim();
        if (!fullName) {
            showMessage("profileMessage", "Vui lòng nhập tên hiển thị.", "error");
            displayNameInput.focus();
            return;
        }

        setBusy(saveProfileButton, true, "Đang lưu…", "Lưu thay đổi");
        let authNameUpdated = false;
        try {
            const { data, error } = await client.auth.updateUser({ data: { full_name: fullName } });
            if (error) throw error;

            authNameUpdated = true;
            const savedName = data.user?.user_metadata?.full_name || fullName;

            if (appUser?.memberId) {
                const { data: updatedMember, error: memberError } = await client
                    .from("members")
                    .update({ member_label: savedName })
                    .eq("member_id", appUser.memberId)
                    .select("member_id");
                if (memberError) throw memberError;
                if (!updatedMember?.length) {
                    throw new Error("Không có hồ sơ thành viên nào được cập nhật. Kiểm tra quyền RLS.");
                }
            }

            displayNameInput.value = savedName;
            showMessage("profileMessage", "Đã cập nhật tên hiển thị.", "success");
            if (window.appUser) {
                window.appUser = { ...window.appUser, name: savedName };
                window.renderAppUser?.(window.appUser);
            }
        } catch (error) {
            const message = authNameUpdated
                ? `Tên tài khoản đã đổi nhưng không đồng bộ được hồ sơ thành viên: ${error.message}`
                : `Không lưu được: ${error.message}`;
            showMessage("profileMessage", message, "error");
        } finally {
            setBusy(saveProfileButton, false, "Đang lưu…", "Lưu thay đổi");
        }
    });

    passwordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        showMessage("passwordMessage", "");
        const currentPassword = document.getElementById("currentPassword").value;
        const password = document.getElementById("newPassword").value;
        const confirmation = document.getElementById("confirmPassword").value;
        if (!currentPassword) {
            showMessage("passwordMessage", "Vui lòng nhập mật khẩu hiện tại.", "error");
            document.getElementById("currentPassword").focus();
            return;
        }
        if (password.length < 8) {
            showMessage("passwordMessage", "Mật khẩu cần có ít nhất 8 ký tự.", "error");
            return;
        }
        if (password !== confirmation) {
            showMessage("passwordMessage", "Hai mật khẩu chưa khớp.", "error");
            document.getElementById("confirmPassword").focus();
            return;
        }

        setBusy(changePasswordButton, true, "Đang cập nhật…", "Cập nhật mật khẩu");
        try {
            const { error: verifyError } = await client.auth.signInWithPassword({
                email: user.email,
                password: currentPassword
            });
            if (verifyError) {
                showMessage("passwordMessage", "Mật khẩu hiện tại không đúng.", "error");
                document.getElementById("currentPassword").focus();
                return;
            }

            const { error } = await client.auth.updateUser({ password });
            if (error) {
                showMessage("passwordMessage", `Không đổi được mật khẩu: ${error.message}`, "error");
                return;
            }

            passwordForm.reset();
            showMessage("passwordMessage", "Đã cập nhật mật khẩu.", "success");
        } catch (error) {
            console.error("Không thể cập nhật mật khẩu:", error);
            showMessage("passwordMessage", `Không đổi được mật khẩu: ${error.message}`, "error");
        } finally {
            setBusy(changePasswordButton, false, "Đang cập nhật…", "Cập nhật mật khẩu");
        }
    });

    signOutButton.addEventListener("click", async () => {
        signOutButton.disabled = true;
        showMessage("sessionMessage", "Đang đăng xuất…");
        const { error } = await client.auth.signOut();
        if (error) {
            signOutButton.disabled = false;
            showMessage("sessionMessage", `Đăng xuất chưa thành công: ${error.message}`, "error");
            return;
        }
        window.location.replace("login.html");
    });

    if (window.lucide) window.lucide.createIcons();
});
