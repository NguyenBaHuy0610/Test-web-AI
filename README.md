# Task Tracker – AI Event Comm-Plan Tracker (7 Wonders)

Web quản lý kế hoạch truyền thông sự kiện, tích hợp Groq AI để lập timeline/phân công.

```
frontend/    Giao diện (HTML/CSS/JS thuần) + gọi Supabase + Groq (groq.js) + timeline-engine.js
algorithm/   Thuật toán gốc bằng Python (reference + demo); bản JS tương ứng: frontend/js/timeline-engine.js
server/      Server local không cần cài thư viện (serve frontend + /algorithm/, nạp .env)
```

Database: Supabase (cấu hình ở `frontend/js/supabase.js`, dùng publishable key).

## Chạy local
Yêu cầu: Node.js ≥ 18 (Python 3.9+ nếu muốn chạy demo thuật toán).

```bash
cp .env.example .env      # điền GROQ_API_KEY (không commit file .env)
node server/server.js     # hoặc npm start -> mở http://localhost:3000
```
Không có Node: `cd frontend && python3 -m http.server 3000` (khi đó nhập Groq key trên giao diện).

Demo thuật toán Python: `npm run algo` hoặc mở `http://localhost:3000/algorithm/task-planner-demo.html`.

## Lưu ý
- Key Groq đọc từ `.env`.
- Dữ liệu chính đồng bộ trực tiếp qua Supabase.
