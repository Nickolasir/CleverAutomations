/**
 * TypeScript helpers for field-level PII encryption/decryption.
 *
 * All actual cryptographic operations happen server-side in PostgreSQL via
 * pgsodium + Supabase Vault. These helpers call the SQL functions via RPC
 * so raw keys never leave the database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Encrypt a plaintext string using the tenant's Vault key.
 * Calls the `encrypt_pii` PostgreSQL function via RPC.
 */
export async function encryptField(
  supabase: SupabaseClient,
  tenantId: string,
  plaintext: string | null,
): Promise<string | null> {
  if (plaintext === null) return null;

  const { data, error } = await supabase.rpc("encrypt_pii", {
    p_plaintext: plaintext,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`encrypt_pii failed: ${error.message}`);
  }

  return data as string;
}

/**
 * Decrypt a ciphertext string using the tenant's Vault key.
 * Calls the `decrypt_pii` PostgreSQL function via RPC.
 */
export async function decryptField(
  supabase: SupabaseClient,
  tenantId: string,
  ciphertext: string | null,
): Promise<string | null> {
  if (ciphertext === null) return null;

  const { data, error } = await supabase.rpc("decrypt_pii", {
    p_ciphertext: ciphertext,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`decrypt_pii failed: ${error.message}`);
  }

  return data as string;
}

/**
 * Encrypt a JSONB-serializable object using the tenant's Vault key.
 */
export async function encryptJsonField(
  supabase: SupabaseClient,
  tenantId: string,
  data: Record<string, unknown> | unknown[] | null,
): Promise<string | null> {
  if (data === null) return null;

  const { data: result, error } = await supabase.rpc("encrypt_pii_jsonb", {
    p_data: data,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`encrypt_pii_jsonb failed: ${error.message}`);
  }

  return result as string;
}

/**
 * Decrypt to a parsed JSONB object using the tenant's Vault key.
 */
export async function decryptJsonField<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  tenantId: string,
  ciphertext: string | null,
): Promise<T | null> {
  if (ciphertext === null) return null;

  const { data, error } = await supabase.rpc("decrypt_pii_jsonb", {
    p_ciphertext: ciphertext,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`decrypt_pii_jsonb failed: ${error.message}`);
  }

  return data as T;
}

/**
 * Compute a SHA-256 hash for indexed lookups (e.g., email uniqueness).
 * This runs client-side to avoid round-trips for simple hashing.
 */
export async function hashPii(value: string): Promise<string> {
  const normalized = value.toLowerCase().trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
