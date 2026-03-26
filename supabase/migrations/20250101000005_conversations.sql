-- =============================================================================
-- Conversations: Chat History for Orchestrator and Family Agents
-- =============================================================================
-- Adds tables for persistent conversation history between users and their
-- agents (Clever orchestrator or family member agents). Supports multi-turn
-- context for the chat interface and voice command logging.
--
-- All tables enforce tenant isolation via RLS using public.requesting_tenant_id().
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- conversations table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Which agent this conversation is with ('clever', 'jarvis', 'luna', etc.)
  agent_name      TEXT NOT NULL DEFAULT 'clever',
  -- Optional FK to family_member_profiles for family agent conversations
  profile_id      UUID REFERENCES public.family_member_profiles(id) ON DELETE SET NULL,
  -- Auto-generated title from first message
  title           TEXT,
  -- Soft-delete: archived conversations are hidden but retained
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_user
  ON public.conversations(tenant_id, user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_conversations_agent
  ON public.conversations(tenant_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON public.conversations(updated_at DESC);

-- RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_tenant_isolation ON public.conversations
  USING (tenant_id = public.requesting_tenant_id());

CREATE POLICY conversations_user_own ON public.conversations
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY conversations_user_insert ON public.conversations
  FOR INSERT WITH CHECK (
    tenant_id = public.requesting_tenant_id()
    AND user_id = auth.uid()
  );

CREATE POLICY conversations_user_update ON public.conversations
  FOR UPDATE USING (
    tenant_id = public.requesting_tenant_id()
    AND user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- conversation_messages table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- 'user', 'assistant', or 'system'
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  -- The message content
  content         TEXT NOT NULL,
  -- Structured metadata: intent, tier, latency_ms, device_actions, constraints
  metadata        JSONB NOT NULL DEFAULT '{}',
  -- How this message was created
  source          TEXT NOT NULL DEFAULT 'chat' CHECK (source IN ('chat', 'voice', 'quick_command')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
  ON public.conversation_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_tenant
  ON public.conversation_messages(tenant_id);

-- RLS
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_tenant_isolation ON public.conversation_messages
  USING (tenant_id = public.requesting_tenant_id());

-- Users can read messages from their own conversations
CREATE POLICY messages_user_read ON public.conversation_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- Users can insert messages into their own conversations
CREATE POLICY messages_user_insert ON public.conversation_messages
  FOR INSERT WITH CHECK (
    tenant_id = public.requesting_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

COMMIT;
