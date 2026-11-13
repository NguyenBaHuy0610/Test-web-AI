document.addEventListener("DOMContentLoaded", async () => {
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
    displayNameInput.value = metadata.full_name || metadata.name || appUser?.name || "";
    emailInput.value = user.email || "";

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
        const { data, error } = await client.auth.updateUser({ data: { full_name: fullName } });
        setBusy(saveProfileButton, false, "Đang lưu…", "Lưu thay đổi");
        if (error) {
            showMessage("profileMessage", `Không lưu được: ${error.message}`, "error");
            return;
        }

        const savedName = data.user?.user_metadata?.full_name || fullName;
        displayNameInput.value = savedName;
        showMessage("profileMessage", "Đã cập nhật tên hiển thị.", "success");
        if (window.appUser) {
            window.appUser = { ...window.appUser, name: savedName };
            window.renderAppUser?.(window.appUser);
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
