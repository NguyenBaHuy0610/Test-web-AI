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

function renderMentionEmailHtml(recipientName: string, authorName: string, taskTitle: string, content: string, taskId: string): string {
    const safeContent = content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/@([\p{L}\p{N}_\s-]+)/gu, '<strong style="color: #4f46e5; background: #e0e7ff; padding: 2px 6px; border-radius: 4px;">@$1</strong>');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${authorName} đã nhắc đến bạn trong một bình luận</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { padding: 20px 28px; background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); text-align: center; }
    .header img { max-height: 40px; margin-bottom: 6px; }
    .header h1 { margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; }
    .content { padding: 28px; }
    .comment-box { background: #f1f5f9; border-left: 4px solid #4f46e5; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 15px; line-height: 1.6; color: #334155; }
    .author { font-weight: 700; color: #1e293b; margin-bottom: 6px; font-size: 14px; }
    .btn { display: inline-block; background-color: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 18px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.25); }
    .footer { padding: 16px 28px; background-color: #f8fafc; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <img src="${LOGO_URL}" alt="AECPT Logo" onerror="this.style.display='none'" />
      <h1>AECPT - Thông báo thảo luận</h1>
    </div>
    <div class="content">
      <p>Xin chào <strong>${recipientName || "bạn"}</strong>,</p>
      <p>Thành viên <strong>${authorName}</strong> vừa nhắc đến bạn trong một bình luận tại công việc <strong>"${taskTitle}"</strong>:</p>
      
      <div class="comment-box">
        <div class="author">${authorName} đã viết:</div>
        <div>${safeContent}</div>
      </div>

      <p style="font-size: 13px; color: #64748b;">Bạn nhận được email này vì đã được gắn thẻ (@mention) trực tiếp hoặc thông qua ban/nhóm của bạn.</p>

      <div style="text-align: center;">
        <a href="${APP_URL}?task=${encodeURIComponent(taskId)}" class="btn">Xem bình luận và phản hồi ngay</a>
      </div>
    </div>
    <div class="footer">
      <p style="margin: 0;">Email gửi tự động từ hệ thống quản lý công việc ban Multimedia - 7 Wonders.</p>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async request => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const brevoSenderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "aecptinhcmus@gmail.com";
    const brevoSenderName = Deno.env.get("BREVO_SENDER_NAME") || "AECPT Nhắc việc";

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("EMAIL_FROM") || "AECPT Notifications <onboarding@resend.dev>";

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const recipients = (body.recipients as Array<Record<string, string>>) || [];
    if (!recipients.length) {
        return jsonResponse({ ok: true, sent_count: 0, message: "No recipients to send" });
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors: Array<{ email: string; error: string }> = [];

    for (const item of recipients) {
        const toEmail = item.email;
        if (!toEmail) continue;

        const subject = `[AECPT] ${item.author_name || "Thành viên"} đã nhắc đến bạn trong công việc "${item.task_title || "Công việc"}"`;
        const html = renderMentionEmailHtml(
            item.name || "Bạn",
            item.author_name || "Thành viên",
            item.task_title || "Công việc",
            item.content || "",
            item.task_id || ""
        );

        // Ưu tiên Brevo
        if (brevoApiKey) {
            try {
                const res = await fetch("https://api.brevo.com/v3/smtp/email", {
                    method: "POST",
                    headers: {
                        "api-key": brevoApiKey,
                        "accept": "application/json",
                        "content-type": "application/json"
                    },
                    body: JSON.stringify({
                        sender: {
                            name: brevoSenderName,
                            email: brevoSenderEmail
                        },
                        to: [{ email: toEmail, name: item.name || toEmail }],
                        subject,
                        htmlContent: html
                    })
                });

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.message || `HTTP ${res.status}`);
                }
                sentCount++;
                console.log(`[Mention Email Sent - Brevo] To: ${toEmail}`);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[Mention Email Error - Brevo] To: ${toEmail}:`, msg);
                failedCount++;
                errors.push({ email: toEmail, error: msg });
            }
        } else if (resendApiKey) {
            try {
                const res = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${resendApiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        from: emailFrom,
                        to: [toEmail],
                        subject,
                        html
                    })
                });

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.message || `HTTP ${res.status}`);
                }
                sentCount++;
                console.log(`[Mention Email Sent - Resend] To: ${toEmail}`);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[Mention Email Error - Resend] To: ${toEmail}:`, msg);
                failedCount++;
                errors.push({ email: toEmail, error: msg });
            }
        } else {
            console.log(`[SIMULATED Mention Email] To: ${toEmail} | Subject: "${subject}"`);
            sentCount++;
        }
    }

    return jsonResponse({
        ok: true,
        sent_count: sentCount,
        failed_count: failedCount,
        errors
    });
});
