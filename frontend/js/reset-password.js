const resetPasswordForm = document.getElementById("resetPasswordForm");
const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");
const resetPasswordSubmit = document.getElementById("resetPasswordSubmit");
const recoveryStatus = document.getElementById("recoveryStatus");
const resetFeedback = document.getElementById("resetFeedback");

function showRecoveryStatus(message, color = "#dc2626") {
    recoveryStatus.textContent = message;
    recoveryStatus.style.color = color;
    recoveryStatus.hidden = false;
}

async function initializePasswordReset() {
    const client = window.supabaseClient;
    if (!client?.auth) {
        throw new Error("Không kết nối được Supabase. Vui lòng tải lại trang.");
    }

    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
        showRecoveryStatus("Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu email khôi phục mới.");
        return;
    }

    recoveryStatus.hidden = true;
    resetPasswordForm.hidden = false;
    newPasswordInput.focus();
}

resetPasswordForm.addEventListener("submit", async event => {
    event.preventDefault();
    resetFeedback.textContent = "";
    resetFeedback.style.color = "#dc2626";

    const password = newPasswordInput.value;
    if (password.length < 8) {
        resetFeedback.textContent = "Mật khẩu cần có ít nhất 8 ký tự.";
        newPasswordInput.focus();
        return;
    }
    if (password !== confirmPasswordInput.value) {
        resetFeedback.textContent = "Hai mật khẩu chưa khớp.";
        confirmPasswordInput.focus();
        return;
    }

    resetPasswordSubmit.disabled = true;
    resetPasswordSubmit.textContent = "Đang cập nhật...";

    try {
        const { error } = await window.supabaseClient.auth.updateUser({ password });
        if (error) throw error;

        resetPasswordForm.hidden = true;
        resetFeedback.textContent = "";
        showRecoveryStatus("Đặt lại mật khẩu thành công. Bạn có thể quay lại đăng nhập.", "#15803d");
    } catch (error) {
        console.error("Không thể cập nhật mật khẩu:", error);
        resetFeedback.textContent = `Không cập nhật được mật khẩu: ${error.message}`;
    } finally {
        resetPasswordSubmit.disabled = false;
        resetPasswordSubmit.textContent = "Cập nhật mật khẩu";
    }
});

initializePasswordReset().catch(error => {
    console.error("Không thể xác minh liên kết khôi phục:", error);
    showRecoveryStatus(`Không thể xác minh liên kết khôi phục: ${error.message}`);
});
