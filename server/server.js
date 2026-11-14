// Server local không phụ thuộc thư viện: phục vụ frontend/ và sinh /config.js từ .env
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "frontend");
const ALGO = path.join(ROOT, "algorithm");

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = { ...loadEnv(path.join(ROOT, ".env")), ...process.env };
const PORT = Number(env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/config.js") {
    res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
    return res.end(`window.APP_CONFIG = ${JSON.stringify({
      GROQ_API_KEY: env.GROQ_API_KEY || "",
      GROQ_SUPPORT_API_KEY: env.GROQ_SUPPORT_API_KEY || env.GROQ_API_KEY || "",
      GROQ_SUPPORT_MODEL: env.GROQ_SUPPORT_MODEL || "llama-3.3-70b-versatile"
    })};`);
  }

  // Cho phép truy cập demo thuật toán tại /algorithm/
  let file;
  if (urlPath.startsWith("/algorithm/")) {
    const subPath = urlPath.slice("/algorithm/".length);
    file = path.normalize(path.join(ALGO, subPath));
    if (!file.startsWith(ALGO + path.sep) && file !== ALGO) { res.writeHead(403); return res.end("Forbidden"); }
  } else {
    file = path.normalize(path.join(WEB, urlPath === "/" ? "index.html" : urlPath));
    if (!file.startsWith(WEB + path.sep) && file !== WEB) { res.writeHead(403); return res.end("Forbidden"); }
  }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

let currentPort = PORT;

server.on("listening", () => {
  const addr = server.address();
  const port = (addr && typeof addr === "object") ? addr.port : currentPort;
  console.log(`Task Tracker chạy tại http://localhost:${port}`);
  console.log(`Demo thuật toán: http://localhost:${port}/algorithm/task-planner-demo.html`);
  if (!env.GROQ_API_KEY) console.log("⚠ Chưa có GROQ_API_KEY trong .env — chatbot AI sẽ yêu cầu nhập key trên giao diện.");
});

server.on("error", (err) => {
  if ((err.code === "EADDRINUSE" || err.code === "EACCES") && currentPort === PORT) {
    const nextPort = PORT === 3000 ? 3001 : PORT + 1;
    console.warn(`Cổng ${currentPort} không khả dụng (${err.code}), tự động chuyển sang cổng ${nextPort}...`);
    currentPort = nextPort;
    server.listen(nextPort);
  } else {
    console.error("Lỗi khởi động server:", err);
  }
});

server.listen(currentPort);
