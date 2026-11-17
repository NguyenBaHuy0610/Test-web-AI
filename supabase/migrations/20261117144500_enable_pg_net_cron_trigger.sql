-- Migration: 20261117144500_enable_pg_net_cron_trigger.sql
-- Mô tả: Kích hoạt extension pg_net và cập nhật pg_cron tự động gọi Edge Function gửi email mỗi 15 phút

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Cập nhật cron job để vừa tạo in-app notification vừa gọi Edge Function gửi email tự động
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Hủy cron cũ nếu có
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aecpt_task_reminders_cron') THEN
            PERFORM cron.unschedule('aecpt_task_reminders_cron');
        END IF;

        -- Đặt lịch chạy định kỳ mỗi 15 phút
        -- Gọi Edge Function qua pg_net
        PERFORM cron.schedule(
            'aecpt_task_reminders_cron',
            '*/15 * * * *',
            $cron$
            SELECT net.http_post(
                url := 'https://roxgrvqmctdnajiorwcv.supabase.co/functions/v1/send-task-reminders',
                headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_EhTobuwuCQFKhJQqs-gFRQ_LXbyXHqk"}'::jsonb,
                body := '{"force_all": false}'::jsonb
            );
            $cron$
        );
    END IF;
END;
$$;
