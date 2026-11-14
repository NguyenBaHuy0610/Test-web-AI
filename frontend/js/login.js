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

  if (!email || !password) {
    formFeedback.textContent = "Nhập email và mật khẩu nhé.";
    formFeedback.style.color = "#dc2626";
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
    formFeedback.textContent = "Đăng nhập thất bại: " + error.message;
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

    if (!email || password.length < 8) return;

    signupSubmit.disabled = true;
    signupSubmit.textContent = "Đang tạo tài khoản...";

    try {
        const { data, error } = await window.supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: fullName }
            }
        });

        if (error) throw error;

        signupFeedback.style.color = "#15803d";
        signupFeedback.textContent = data.session
            ? "Tạo tài khoản thành công! Hệ thống đã tự động tạo không gian làm việc mới và gán bạn làm Trưởng nhóm (Leader). Hãy đăng nhập để bắt đầu."
            : "Đã tạo tài khoản! Hệ thống đã tạo không gian làm việc mới cho bạn. Hãy kiểm tra email để xác nhận (nếu có yêu cầu) rồi đăng nhập để bắt đầu.";
        signupForm.reset();
    } catch (error) {
        console.error("Đăng ký thất bại:", error);
        signupFeedback.style.color = "#dc2626";
        signupFeedback.textContent = "Đăng ký thất bại: " + error.message;
    } finally {
        signupSubmit.disabled = false;
        signupSubmit.textContent = "Tạo tài khoản";
    }
});


forgotPassword.addEventListener("click", function () {

    alert(
        "Vui lòng liên hệ quản trị viên của ban Multimedia để được hỗ trợ đặt lại mật khẩu."
    );

});


emailInput.addEventListener("input", function () {

    emailError.textContent = "";
    formFeedback.textContent = "";

});

passwordInput.addEventListener("input", function () {

    passwordError.textContent = "";
    formFeedback.textContent = "";

});
