-- =============================================================================
-- Memory System: Conversation Summaries + Long-Term Agent Memories
-- =============================================================================
-- Adds two core tables for the orchestrator memory system:
--
-- 1. conversation_summaries: Compressed summaries of older conversation
--    messages, cached for token-efficient context window management.
--    Replaces the naive "last 20 messages" truncation with smart windowing.
--
-- 2. agent_memories: Long-term durable memories extracted from conversations
--    or explicitly saved by users. Stores preferences, device patterns,
--    household facts, naming aliases, routines, corrections, and relationships.
--
-- Memory privacy model:
--   - scope='user'      → encrypted with encrypt_pii_user() (per-user key)
--   - scope='household'  → encrypted with encrypt_pii() (tenant key)
--   - scope='agent'      → encrypted with encrypt_pii_user() (per-user key)
--
-- Dependencies: migrations 005 (conversations), 008 (encryption), 014 (per-user encryption)
-- =============================================================================

-- ===========================================================================
-- PART 0: ENUM EXTENSIONS (must be committed BEFORE they can be referenced)
-- ===========================================================================
-- PostgreSQL requires new enum values to be committed before any SQL in the
-- same session can reference them. These run outside the transaction block.

ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'memory_storage';

BEGIN;

-- ===========================================================================
-- PART 1: CONVERSATION SUMMARIES TABLE
-- ===========================================================================
-- Stores compressed summaries of older conversation messages so the context
-- window manager can include prior context without loading all messages.

CREATE TABLE IF NOT EXISTS public.conversation_summaries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Summary content
  summary_text      TEXT NOT NULL,

  -- What messages this summary covers
  first_message_id  UUID NOT NULL,
  last_message_id   UUID NOT NULL,
  message_count     INTEGER NOT NULL,

  -- Token accounting (estimated)
  original_tokens   INTEGER NOT NULL,
  summary_tokens    INTEGER NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_summaries_conversation
  ON conversation_summaries (conversation_id, created_at DESC);

-- ===========================================================================
-- PART 2: AGENT MEMORIES TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.agent_memories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- WHO: owner of this memory
  user_id           UUID REFERENCES public.users(id) ON DELETE CASCADE,
  profile_id        UUID REFERENCES public.family_member_profiles(id) ON DELETE SET NULL,

  -- WHAT: the memory content
  memory_type       TEXT NOT NULL CHECK (memory_type IN (
    'preference',        -- "I like lights dim in the evening"
    'device_pattern',    -- "Usually watches TV at 9pm"
    'household_fact',    -- "The upstairs thermostat runs warm"
    'naming_alias',      -- "We call the living room TV the big screen"
    'routine_pattern',   -- "Kids go to bed at 8:30 on school nights"
    'correction',        -- "I said DIM not OFF"
    'relationship'       -- "Mom's office is the upstairs bedroom"
  )),
  -- Plaintext for non-PII memories (device patterns, household facts)
  content           TEXT,
  -- Encrypted version for PII-containing memories
  content_encrypted TEXT,

  -- Ensure at least one content field is populated
  CONSTRAINT chk_memory_has_content CHECK (
    content IS NOT NULL OR content_encrypted IS NOT NULL
  ),

  -- CONTEXT: when/how this memory applies
  scope             TEXT NOT NULL DEFAULT 'user' CHECK (scope IN (
    'user',         -- private to this user (per-user encryption)
    'household',    -- shared across family (tenant-level encryption)
    'agent'         -- scoped to a specific family agent
  )),
  agent_name        TEXT,  -- null = applies to all agents

  -- QUALITY: confidence and validation
  confidence        REAL NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0.0 AND 1.0),
  source_type       TEXT NOT NULL DEFAULT 'extracted' CHECK (source_type IN (
    'extracted',    -- LLM extracted from conversation
    'explicit',     -- user explicitly told us ("remember that...")
    'inferred',     -- pattern detection over time
    'corrected'     -- user corrected a previous memory
  )),
  times_reinforced    INTEGER NOT NULL DEFAULT 0,
  times_contradicted  INTEGER NOT NULL DEFAULT 0,
  last_accessed_at    TIMESTAMPTZ,

  -- PROVENANCE: which conversation created this
  source_conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  source_message_id      UUID,

  -- LIFECYCLE
  is_active         BOOLEAN NOT NULL DEFAULT true,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary lookup: active memories for a user within a tenant
CREATE INDEX IF NOT EXISTS idx_memories_tenant_user
  ON agent_memories (tenant_id, user_id, is_active)
  WHERE is_active = true;

-- Filter by type
CREATE INDEX IF NOT EXISTS idx_memories_type
  ON agent_memories (tenant_id, memory_type)
  WHERE is_active = true;

-- Filter by scope (for household-wide retrieval)
CREATE INDEX IF NOT EXISTS idx_memories_scope
  ON agent_memories (tenant_id, scope)
  WHERE is_active = true;

-- Filter by agent name (for agent-scoped memories)
CREATE INDEX IF NOT EXISTS idx_memories_agent
  ON agent_memories (tenant_id, agent_name)
  WHERE is_active = true AND agent_name IS NOT NULL;

-- Decay scoring: find stale memories
CREATE INDEX IF NOT EXISTS idx_memories_accessed
  ON agent_memories (last_accessed_at)
  WHERE is_active = true;

-- ===========================================================================
-- PART 3: ENABLE RLS
-- ===========================================================================

ALTER TABLE conversation_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_summaries FORCE ROW LEVEL SECURITY;

ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- PART 4: RLS POLICIES — conversation_summaries
-- ===========================================================================
-- Inherit the same tenant isolation as conversations.

DROP POLICY IF EXISTS conv_summaries_select ON conversation_summaries;
CREATE POLICY conv_summaries_select ON conversation_summaries
  FOR SELECT USING (tenant_id = requesting_tenant_id());

DROP POLICY IF EXISTS conv_summaries_insert ON conversation_summaries;
CREATE POLICY conv_summaries_insert ON conversation_summaries
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id());

DROP POLICY IF EXISTS conv_summaries_delete ON conversation_summaries;
CREATE POLICY conv_summaries_delete ON conversation_summaries
  FOR DELETE USING (tenant_id = requesting_tenant_id());

-- ===========================================================================
-- PART 5: RLS POLICIES — agent_memories
-- ===========================================================================
-- Users can see their own memories + household-scoped memories.
-- No admin cross-access to other users' personal memories.

DROP POLICY IF EXISTS memories_select ON agent_memories;
CREATE POLICY memories_select ON agent_memories
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR scope = 'household')
  );

DROP POLICY IF EXISTS memories_insert ON agent_memories;
CREATE POLICY memories_insert ON agent_memories
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR scope = 'household')
  );

DROP POLICY IF EXISTS memories_update ON agent_memories;
CREATE POLICY memories_update ON agent_memories
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR scope = 'household')
  );

DROP POLICY IF EXISTS memories_delete ON agent_memories;
CREATE POLICY memories_delete ON agent_memories
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 6: MEMORY CONTENT READ HELPER
-- ===========================================================================
-- Decrypts memory content based on scope, so callers don't need to know
-- which encryption tier to use.

CREATE OR REPLACE FUNCTION public.read_memory_content(
  p_memory_id UUID,
  p_tenant_id UUID,
  p_user_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_memory RECORD;
BEGIN
  SELECT * INTO v_memory FROM agent_memories WHERE id = p_memory_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- If plaintext content exists, return it directly
  IF v_memory.content IS NOT NULL THEN
    RETURN v_memory.content;
  END IF;

  -- Decrypt based on scope
  IF v_memory.scope IN ('user', 'agent') THEN
    RETURN decrypt_pii_user(v_memory.content_encrypted, p_tenant_id, p_user_id);
  ELSE
    RETURN decrypt_pii(v_memory.content_encrypted, p_tenant_id);
  END IF;
END;
$$;

-- Restrict access to the helper
REVOKE EXECUTE ON FUNCTION public.read_memory_content(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_memory_content(uuid, uuid, uuid) FROM anon;

-- ===========================================================================
-- PART 7: TRIGGERS
-- ===========================================================================

DROP TRIGGER IF EXISTS trg_agent_memories_updated_at ON agent_memories;
CREATE TRIGGER trg_agent_memories_updated_at
  BEFORE UPDATE ON agent_memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================================================
-- PART 8: MEMORY DECAY FUNCTION
-- ===========================================================================
-- Instead of hard-deleting memories by age, we soft-deactivate based on
-- last access time + confidence + contradiction signals. Memories that are
-- still being used stay alive forever. Stale ones get deactivated but remain
-- recoverable.
--
-- Retention policy (based on last access, NOT creation date):
--   explicit / corrected  → NEVER deactivated (user deliberately saved these)
--   extracted             → soft-deactivate after 365 days of no access
--   inferred              → soft-deactivate after 180 days of no access
--
-- Additionally, memories with high contradiction rates are deactivated
-- regardless of age (contradicted > reinforced AND contradicted >= 3).
--
-- Conversation summaries: hard-deleted after 90 days (they have no user value
-- beyond context window management).

CREATE OR REPLACE FUNCTION public.decay_stale_memories()
RETURNS TABLE(deactivated_count INTEGER, deleted_summaries_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_deactivated INTEGER;
  v_deleted     INTEGER;
BEGIN
  -- 1. Soft-deactivate stale EXTRACTED memories (365 days since last access)
  UPDATE agent_memories
  SET is_active = false,
      updated_at = now()
  WHERE is_active = true
    AND source_type = 'extracted'
    AND COALESCE(last_accessed_at, created_at) < now() - INTERVAL '365 days';

  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  -- 2. Soft-deactivate stale INFERRED memories (180 days since last access)
  UPDATE agent_memories
  SET is_active = false,
      updated_at = now()
  WHERE is_active = true
    AND source_type = 'inferred'
    AND COALESCE(last_accessed_at, created_at) < now() - INTERVAL '180 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_deactivated := v_deactivated + v_deleted;

  -- 3. Soft-deactivate highly contradicted memories (any source type except explicit/corrected)
  UPDATE agent_memories
  SET is_active = false,
      updated_at = now()
  WHERE is_active = true
    AND source_type NOT IN ('explicit', 'corrected')
    AND times_contradicted >= 3
    AND times_contradicted > times_reinforced;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_deactivated := v_deactivated + v_deleted;

  -- 4. Hard-delete old conversation summaries (no user value beyond 90 days)
  DELETE FROM conversation_summaries
  WHERE created_at < now() - INTERVAL '90 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_deactivated, v_deleted;
END;
$$;

-- Restrict access — only the retention cleanup job should call this
REVOKE EXECUTE ON FUNCTION public.decay_stale_memories() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decay_stale_memories() FROM anon;

-- ===========================================================================
-- PART 9: DATA RETENTION COMMENTS
-- ===========================================================================

COMMENT ON TABLE agent_memories IS
  'Long-term agent memories. Retention: explicit/corrected=never expires, extracted=deactivate after 365d no access, inferred=deactivate after 180d no access. Highly contradicted memories auto-deactivated. GDPR: requires memory_storage consent.';

COMMENT ON TABLE conversation_summaries IS
  'Compressed conversation summaries for context window management. Hard-deleted after 90d.';

COMMIT;
