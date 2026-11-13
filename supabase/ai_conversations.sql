-- =========================================================================
-- BẢNG AI_CONVERSATIONS - LƯU LỊCH SỬ TRÒ CHUYỆN AI DASHBOARD ĐA THIẾT BỊ
-- Chạy script này trong Supabase Dashboard -> SQL Editor
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.ai_conversations (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Cuộc trò chuyện',
    active_event_id TEXT,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated
    ON public.ai_conversations (user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_conversations TO authenticated;

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own conversations" ON public.ai_conversations;
CREATE POLICY "Users can manage their own conversations"
    ON public.ai_conversations
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
