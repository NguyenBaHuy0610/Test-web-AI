const loginForm = document.getElementById("loginForm");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const togglePassword = document.getElementById("togglePassword");

const rememberMe = document.getElementById("rememberMe");
const forgotPassword = document.getElementById("forgotPassword");

const emailError = document.getElementById("emailError");
const passwordError = document.getElementById("passwordError");

const formFeedback = document.getElementById("formFeedback");
const signupForm = document.getElementById("signupForm");
const signupNameInput = document.getElementById("signupName");
const signupEmailInput = document.getElementById("signupEmail");
const signupPasswordInput = document.getElementById("signupPassword");
const signupFeedback = document.getElementById("signupFeedback");
const signupSubmit = document.getElementById("signupSubmit");

function setAuthMode(mode) {
    const isSignup = mode === "signup";
    loginForm.hidden = isSignup;
    signupForm.hidden = !isSignup;
    document.getElementById("showLoginRow").hidden = !isSignup;
    document.querySelector(".auth-switch:not(.signup-switch)").hidden = isSignup;
    document.querySelector(".form-driver").hidden = isSignup;
    document.querySelector(".system-note").hidden = isSignup;

    document.querySelector(".form-heading .welcom-lable").textContent =
        isSignup ? "TẠO TÀI KHOẢN" : "WELCOME BACK";
    document.querySelector(".form-heading h2").textContent =
        isSignup ? "Đăng ký tài khoản" : "Chào mừng trở lại!";
    document.querySelector(".form-heading p").textContent =
        isSignup
            ? "Tạo tài khoản để tham gia không gian làm việc của ban Multimedia."
            : "Đăng nhập vào không gian làm việc của ban Multimedia";
}

document.getElementById("showSignup").addEventListener("click", () => {
    setAuthMode("signup");
    signupNameInput.focus();
});

document.getElementById("showLogin").addEventListener("click", () => {
    setAuthMode("login");
    emailInput.focus();
});

document.getElementById("toggleSignupPassword").addEventListener("click", event => {
    const button = event.currentTarget;
    const isHidden = signupPasswordInput.type === "password";
    signupPasswordInput.type = isHidden ? "text" : "password";
    button.textContent = isHidden ? "Ẩn" : "Hiện";
});


togglePassword.addEventListener("click", function () {

    if (passwordInput.type === "password") {

        passwordInput.type = "text";

        togglePassword.textContent = "Ẩn";

    } else {

        passwordInput.type = "password";

        togglePassword.textContent = "Hiện";
    }

});

function validateEmail(email) {

    const emailPattern =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return emailPattern.test(email);
}

function validatePassword(password) {

    return password.trim().length > 0;
}

function getAuthErrorMessage(error, action) {
    const message = String(error?.message || "").toLowerCase();
    const code = String(error?.code || "").toLowerCase();

    if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
        return "Email hoặc mật khẩu không chính xác. Vui lòng thử lại.";
    }
    if (message.includes("user already registered") || message.includes("already been registered")) {
        return "Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.";
    }
    if (message.includes("email not confirmed")) {
        return "Email chưa được xác nhận. Vui lòng kiểm tra hộp thư của bạn.";
    }
    if (message.includes("password") &&
        (message.includes("weak") || message.includes("least"))) {
        return "Mật khẩu chưa đủ mạnh. Vui lòng chọn mật khẩu dài và an toàn hơn.";
    }
    if (message.includes("rate limit") || message.includes("too many requests")) {
        return "Bạn thao tác quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.";
    }

    return {
        login: "Không thể đăng nhập lúc này. Vui lòng thử lại.",
        signup: "Không thể tạo tài khoản lúc này. Vui lòng thử lại.",
        recovery: "Không thể gửi email khôi phục lúc này. Vui lòng thử lại."
    }[action] || "Đã xảy ra lỗi. Vui lòng thử lại.";
}


function clearErrors() {

    emailError.textContent = "";
    passwordError.textContent = "";

    formFeedback.textContent = "";
}


window.addEventListener("DOMContentLoaded", function () {

    const savedEmail = localStorage.getItem("mediatask_email");

    if (savedEmail) {

        emailInput.value = savedEmail;

        rememberMe.checked = true;
    }

});


loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  clearErrors();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email) {
    emailError.textContent = "Vui lòng nhập email.";
    emailInput.focus();
    return;
  }
  if (!validateEmail(email)) {
    emailError.textContent = "Email không đúng định dạng. Ví dụ: ten@congty.com.";
    emailInput.focus();
    return;
  }
  if (!validatePassword(password)) {
    passwordError.textContent = "Vui lòng nhập mật khẩu.";
    passwordInput.focus();
    return;
  }

  formFeedback.textContent = "Đang đăng nhập...";
  formFeedback.style.color = "#555";

  const submitButton = loginForm.querySelector('[type="submit"]');
  submitButton.disabled = true;

  try {
    const { error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    window.location.href = "dashboard.html";
  } catch (error) {
    console.error("Đăng nhập thất bại:", error);
    formFeedback.textContent = getAuthErrorMessage(error, "login");
    formFeedback.style.color = "#dc2626";
  } finally {
    submitButton.disabled = false;
  }
});

signupForm.addEventListener("submit", async event => {
    event.preventDefault();
    signupFeedback.textContent = "";
    signupFeedback.style.color = "#555";

    const fullName = signupNameInput.value.trim();
    const email = signupEmailInput.value.trim();
    const password = signupPasswordInput.value;
    if (!fullName) {
        signupFeedback.style.color = "#dc2626";
        signupFeedback.textContent = "Vui lòng nhập họ và tên.";
        signupNameInput.focus();
        return;
    }

    if (!email) {
        signupFeedback.style.color = "#dc2626";
        signupFeedback.textContent = "Vui lòng nhập email.";
        signupEmailInput.focus();
        return;
    }
    if (!validateEmail(email)) {
        signupFeedback.style.color = "#dc2626";
        signupFeedback.textContent = "Email không đúng định dạng. Ví dụ: ten@congty.com.";
        signupEmailInput.focus();
        return;
    }
    if (password.length < 8) {
        signupFeedback.style.color = "#dc2626";
        signupFeedback.textContent = "Mật khẩu cần có ít nhất 8 ký tự.";
        signupPasswordInput.focus();
        return;
    }

    signupSubmit.disabled = true;
    signupSubmit.textContent = "Đang tạo tài khoản...";

    try {
        const { data, error } = await window.supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    signup_source: "self_signup"
                }
            }
        });

        if (error) throw error;

        signupFeedback.style.color = "#15803d";
        signupFeedback.textContent = data.session
            ? "Tạo tài khoản thành công. Tài khoản cần được trưởng nhóm liên kết với thành viên trước khi dùng workspace."
            : "Đã tạo tài khoản. Hãy kiểm tra email để xác nhận, sau đó liên hệ trưởng nhóm để được liên kết với workspace.";
        signupForm.reset();
    } catch (error) {
        console.error("Đăng ký thất bại:", error);
        signupFeedback.style.color = "#dc2626";
        signupFeedback.textContent = getAuthErrorMessage(error, "signup");
    } finally {
        signupSubmit.disabled = false;
        signupSubmit.textContent = "Tạo tài khoản";
    }
});


forgotPassword.addEventListener("click", async function () {
    const email = emailInput.value.trim();
    emailError.textContent = "";
    formFeedback.textContent = "";

    if (!email || !validateEmail(email)) {
        emailError.textContent = "Nhập email hợp lệ để nhận liên kết đặt lại mật khẩu.";
        emailInput.focus();
        return;
    }

    const client = window.supabaseClient;
    if (!client?.auth) {
        formFeedback.textContent = "Không kết nối được Supabase. Vui lòng tải lại trang.";
        formFeedback.style.color = "#dc2626";
        return;
    }

    forgotPassword.disabled = true;
    forgotPassword.textContent = "Đang gửi...";
    formFeedback.textContent = "Đang gửi email khôi phục...";
    formFeedback.style.color = "#555";

    try {
        const redirectTo = new URL("reset-password.html", window.location.href).toString();
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;

        formFeedback.textContent =
            "Đã tiếp nhận yêu cầu. Nếu email có tài khoản, bạn sẽ nhận được liên kết đặt lại mật khẩu; nếu chưa đăng ký, sẽ không có email được gửi. Vì lý do bảo mật, hệ thống không xác nhận email có tài khoản hay không.";
        formFeedback.style.color = "#15803d";
    } catch (error) {
        console.error("Không thể gửi email đặt lại mật khẩu:", error);
        formFeedback.textContent = getAuthErrorMessage(error, "recovery");
        formFeedback.style.color = "#dc2626";
    } finally {
        forgotPassword.disabled = false;
        forgotPassword.textContent = "Quên mật khẩu?";
    }
});


emailInput.addEventListener("input", function () {

    emailError.textContent = "";
    formFeedback.textContent = "";

});

passwordInput.addEventListener("input", function () {

    passwordError.textContent = "";
    formFeedback.textContent = "";

});
