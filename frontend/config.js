// File tĩnh dự phòng (khi mở frontend trực tiếp không qua server).
// Khi chạy qua server local (`npm start`) hoặc deploy trên Vercel, file /config.js sẽ tự động sinh từ biến môi trường.
window.APP_CONFIG = window.APP_CONFIG || {
    GROQ_API_KEY: "",
    GROQ_SUPPORT_API_KEY: "",
    GROQ_SUPPORT_MODEL: "llama-3.3-70b-versatile"
};
