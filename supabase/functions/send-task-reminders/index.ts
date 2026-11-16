import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const APP_URL = "https://7wonders-kappa.vercel.app/pages/login.html";
const LOGO_URL = "https://7wonders-kappa.vercel.app/assets/logo-no-background.png";

function jsonResponse(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

function emailWrapper(title: string, bodyContent: string): string {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { padding: 24px 32px; background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); text-align: center; }
    .header img { max-height: 44px; margin-bottom: 8px; }
    .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
    .content { padding: 32px; }
    .footer { padding: 20px 32px; background-color: #f1f5f9; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .btn { display: inline-block; background-color: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 20px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.25); }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .badge-urgent { background: #fee2e2; color: #b91c1c; }
    .badge-warning { background: #fef3c7; color: #b45309; }
    .badge-info { background: #e0e7ff; color: #4338ca; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th { background-color: #f8fafc; color: #475569; font-weight: 600; text-align: left; padding: 10px 12px; border-bottom: 2px solid #e2e8f0; }
    td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; }
    tr:last-child td { border-bottom: none; }
    .role-header { background: #f1f5f9; color: #334155; font-weight: 700; padding: 8px 12px; font-size: 13px; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <img src="${LOGO_URL}" alt="AECPT Logo" onerror="this.style.display='none'" />
      <h1>AECPT - Quản lý Dự án &amp; Sự kiện</h1>
    </div>
    <div class="content">
      ${bodyContent}
    </div>
    <div class="footer">
      <p style="margin: 0 0 6px 0;">Email tự động gửi từ hệ thống AECPT (AI Event Comm-plan Tracker).</p>
      <p style="margin: 0;">Múi giờ áp dụng: Giờ Việt Nam (UTC+7, Asia/Ho_Chi_Minh).</p>
    </div>
  </div>
</body>
</html>`;
}

function renderMemberReminderHtml(item: Record<string, unknown>): string {
    return emailWrapper(
        "Nhắc việc: Sắp đến hạn nộp bản nháp trong 24h",
        `
        <p>Xin chào <strong>${item.member_name || "bạn"}</strong>,</p>
        <p>Hệ thống AECPT xin nhắc bạn: Công việc được phân công dưới đây sắp đến hạn nộp bản nháp (<strong>còn dưới 24 giờ</strong>):</p>
        
        <div style="background: #f8fafc; border-left: 4px solid #4f46e5; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <h2 style="margin: 0 0 8px 0; font-size: 17px; color: #1e293b;">${item.task_title}</h2>
          <p style="margin: 4px 0; font-size: 14px; color: #475569;"><strong>Sự kiện:</strong> ${item.event_label}</p>
          <p style="margin: 4px 0; font-size: 14px; color: #475569;"><strong>Ban / Phân loại:</strong> <span class="badge badge-info">${item.task_type}</span></p>
          <p style="margin: 4px 0; font-size: 14px; color: #dc2626;"><strong>Hạn nộp bản nháp:</strong> ${item.deadline_formatted} (Giờ VN)</p>
          <p style="margin: 4px 0; font-size: 14px; color: #475569;"><strong>Trạng thái hiện tại:</strong> ${item.task_status}</p>
        </div>

        <p>Vui lòng kiểm tra tiến độ, tải lên tài liệu hoàn thành hoặc cập nhật trạng thái trên hệ thống trước thời hạn nêu trên.</p>
        
        <div style="text-align: center;">
          <a href="${APP_URL}" class="btn">Mở AECPT để xử lý công việc</a>
        </div>
        `
    );
}

function renderUnassignedUrgentHtml(item: Record<string, unknown>): string {
    return emailWrapper(
        "Cảnh báo khẩn cấp: Task chưa phân công còn dưới 24h",
        `
        <div style="text-align: center; margin-bottom: 16px;">
          <span class="badge badge-urgent" style="font-size: 14px; padding: 6px 14px;">⚠️ CẢNH BÁO KHẨN CẤP</span>
        </div>
        <p>Kính gửi Trưởng ban <strong>${item.leader_name || "Leader"}</strong>,</p>
        <p>Hệ thống AECPT phát hiện có <strong>công việc sắp đến hạn nộp bản nháp trong 24 giờ tới nhưng hiện tại chưa có thành viên nào phụ trách</strong>:</p>

        <div style="background: #fff1f2; border-left: 4px solid #e11d48; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <h2 style="margin: 0 0 8px 0; font-size: 17px; color: #9f1239;">${item.task_title}</h2>
          <p style="margin: 4px 0; font-size: 14px; color: #475569;"><strong>Sự kiện đang diễn ra:</strong> ${item.event_label}</p>
          <p style="margin: 4px 0; font-size: 14px; color: #475569;"><strong>Ban / Phân loại:</strong> <span class="badge badge-warning">${item.task_type}</span></p>
          <p style="margin: 4px 0; font-size: 14px; color: #b91c1c;"><strong>Hạn nộp bản nháp:</strong> ${item.deadline_formatted} (Giờ VN)</p>
          <p style="margin: 4px 0; font-size: 14px; color: #b91c1c; font-weight: 600;">Tình trạng: CHƯA CÓ NGƯỜI PHỤ TRÁCH</p>
        </div>

        <p>Vui lòng đăng nhập vào ứng dụng và phân công nhân sự phụ trách ngay để tránh chậm trễ tiến độ sự kiện.</p>

        <div style="text-align: center;">
          <a href="${APP_URL}" class="btn" style="background-color: #e11d48;">Phân công công việc ngay</a>
        </div>
        `
    );
}

function renderLeaderDailySummaryHtml(item: Record<string, unknown>): string {
    const tasks = (item.tasks as Array<Record<string, unknown>>) || [];
    let tableHtml = "";

    if (tasks.length === 0) {
        tableHtml = `
        <div style="padding: 24px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; text-align: center; margin: 20px 0;">
          <p style="color: #166534; font-size: 15px; margin: 0; font-weight: 600;">🎉 Tuyệt vời! Hiện tại không có công việc nào cần nộp nháp trong 48 giờ tới.</p>
        </div>`;
    } else {
        // Gom nhóm theo role
        const groups: Record<string, Array<Record<string, unknown>>> = {};
        for (const t of tasks) {
            const role = (t.task_role as string) || "Chung";
            if (!groups[role]) groups[role] = [];
            groups[role].push(t);
        }

        let rowsHtml = "";
        let stt = 1;
        for (const [roleName, roleTasks] of Object.entries(groups)) {
            rowsHtml += `
            <tr>
              <td colspan="5" class="role-header">Ban / Vị trí: <strong>${roleName}</strong> (${roleTasks.length} task)</td>
            </tr>`;
            for (const t of roleTasks) {
                rowsHtml += `
                <tr>
                  <td style="text-align: center; color: #64748b;">${stt++}</td>
                  <td><strong>${t.task_title}</strong></td>
                  <td style="color: #dc2626; font-weight: 600;">${t.deadline_formatted || "-"}</td>
                  <td>${t.assignee_name || "Chưa gán"}</td>
                  <td><span class="badge badge-info">${t.task_status || "todo"}</span></td>
                </tr>`;
            }
        }

        tableHtml = `
        <div style="overflow-x: auto; margin: 20px 0;">
          <table>
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">STT</th>
                <th>Tên công việc</th>
                <th style="width: 140px;">Hạn nộp nháp</th>
                <th style="width: 130px;">Phụ trách</th>
                <th style="width: 80px;">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>`;
    }

    return emailWrapper(
        `Báo cáo tổng hợp tiến độ 48h - ${item.summary_date}`,
        `
        <p>Kính gửi Trưởng ban <strong>${item.leader_name || "Leader"}</strong>,</p>
        <p>Dưới đây là bảng tổng hợp các công việc sắp đến hạn nộp bản nháp trong <strong>48 giờ tới</strong> của sự kiện đang diễn ra trong Không gian làm việc <strong>${item.workspace_name}</strong>:</p>

        ${tableHtml}

        <p style="font-size: 14px; color: #64748b; margin-top: 16px;">
          <em>* Ghi chú: Danh sách đã được sắp xếp nhóm theo ban/vị trí và ưu tiên công việc có thời hạn gần nhất lên trước.</em>
        </p>

        <div style="text-align: center;">
          <a href="${APP_URL}" class="btn">Xem chi tiết trên Dashboard AECPT</a>
        </div>
        `
    );
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
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("EMAIL_FROM") || "AECPT Notifications <onboarding@resend.dev>";

    if (!serviceKey || !supabaseUrl) {
        return jsonResponse({ error: "Supabase service configuration missing." }, 500);
    }

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        // empty body is acceptable for automated triggers
    }

    const forceAll = Boolean(body.force_all);
    const targetWorkspaceId = body.target_workspace_id ? String(body.target_workspace_id) : null;
    const forceSimulate = Boolean(body.simulate) || !resendApiKey;

    const adminClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    // 1. Lấy danh sách hàng đợi email cần gửi từ Database RPC
    const { data: queueData, error: queueError } = await adminClient.rpc("aecpt_get_pending_email_queue", {
        p_force_all: forceAll,
        p_target_workspace_id: targetWorkspaceId
    });

    if (queueError) {
        console.error("[EmailReminder] Lỗi gọi aecpt_get_pending_email_queue:", queueError);
        return jsonResponse({ error: "Không thể lấy hàng đợi email: " + queueError.message }, 500);
    }

    const memberReminders = (queueData?.member_reminders as Array<Record<string, unknown>>) || [];
    const unassignedReminders = (queueData?.unassigned_urgent_reminders as Array<Record<string, unknown>>) || [];
    const leaderSummaries = (queueData?.leader_daily_summaries as Array<Record<string, unknown>>) || [];

    const stats = {
        total_queued: memberReminders.length + unassignedReminders.length + leaderSummaries.length,
        sent: 0,
        simulated: 0,
        failed: 0,
        mode: forceSimulate ? "mock_simulation" : "resend_live",
        details: [] as Array<Record<string, unknown>>
    };

    console.log(`[EmailReminder] Bắt đầu xử lý ${stats.total_queued} email. Chế độ: ${stats.mode}`);

    // Hàm gửi email qua Resend hoặc Simulation
    async function dispatchEmail(
        to: string,
        subject: string,
        html: string,
        metadata: Record<string, unknown>,
        mailType: string,
        dedupeKey: string,
        workspaceId?: string,
        eventId?: string,
        taskId?: string,
        userId?: string
    ) {
        let status = "sent";
        let errorMessage: string | null = null;
        let responseId: string | null = null;

        if (forceSimulate) {
            status = "simulated";
            console.log(`[SIMULATED EMAIL] To: ${to} | Subject: "${subject}" | DedupeKey: ${dedupeKey}`);
            stats.simulated++;
        } else {
            try {
                const res = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${resendApiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        from: emailFrom,
                        to: [to],
                        subject,
                        html
                    })
                });

                const resJson = await res.json();
                if (!res.ok) {
                    throw new Error(resJson.message || resJson.error || `HTTP ${res.status}`);
                }
                responseId = resJson.id || null;
                stats.sent++;
                console.log(`[LIVE EMAIL SENT] To: ${to} | ID: ${responseId}`);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[LIVE EMAIL ERROR] To: ${to} | Lỗi:`, message);
                status = "failed";
                errorMessage = message;
                stats.failed++;
            }
        }

        // Ghi nhận nhật ký vào bảng public.email_logs
        try {
            await adminClient.rpc("aecpt_record_email_log", {
                p_workspace_id: workspaceId || null,
                p_event_id: eventId || null,
                p_task_id: taskId || null,
                p_recipient_email: to,
                p_recipient_user_id: userId || null,
                p_mail_type: mailType,
                p_dedupe_key: dedupeKey,
                p_subject: subject,
                p_status: status,
                p_error_message: errorMessage,
                p_metadata: { ...metadata, resend_id: responseId, mode: stats.mode }
            });
        } catch (logErr) {
            console.warn("[EmailReminder] Lỗi lưu email_logs:", logErr);
        }

        stats.details.push({
            to,
            subject,
            status,
            error: errorMessage,
            dedupe_key: dedupeKey
        });
    }

    // 1. Gửi Email nhắc việc 24h cho từng thành viên
    for (const item of memberReminders) {
        const html = renderMemberReminderHtml(item);
        await dispatchEmail(
            String(item.recipient_email),
            String(item.subject),
            html,
            { task_id: item.task_id, event_id: item.event_id },
            "member_24h_reminder",
            String(item.dedupe_key),
            item.workspace_id as string,
            item.event_id as string,
            item.task_id as string,
            item.recipient_user_id as string
        );
    }

    // 2. Gửi Email cảnh báo khẩn cấp cho Leader về task chưa phân công
    for (const item of unassignedReminders) {
        const html = renderUnassignedUrgentHtml(item);
        await dispatchEmail(
            String(item.recipient_email),
            String(item.subject),
            html,
            { task_id: item.task_id, event_id: item.event_id },
            "leader_unassigned_urgent",
            String(item.dedupe_key),
            item.workspace_id as string,
            item.event_id as string,
            item.task_id as string,
            item.recipient_user_id as string
        );
    }

    // 3. Gửi Email tổng hợp hằng ngày theo khung giờ riêng của từng Leader
    for (const item of leaderSummaries) {
        const html = renderLeaderDailySummaryHtml(item);
        await dispatchEmail(
            String(item.recipient_email),
            String(item.subject),
            html,
            { task_count: item.task_count, summary_date: item.summary_date },
            "leader_daily_summary",
            String(item.dedupe_key),
            item.workspace_id as string,
            null,
            null,
            item.recipient_user_id as string
        );
    }

    return jsonResponse({
        ok: true,
        message: `Xử lý hoàn tất. Tổng số: ${stats.total_queued} (Gửi thực tế: ${stats.sent}, Giả lập: ${stats.simulated}, Thất bại: ${stats.failed})`,
        stats,
        server_time_vn: queueData?.server_time_vn
    });
});
