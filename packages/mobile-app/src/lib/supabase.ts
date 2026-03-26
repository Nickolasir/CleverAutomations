import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

/**
 * Mobile Supabase client with expo-secure-store for secure session management.
 * Auth tokens (including refresh tokens) are stored in the OS keychain
 * (Keychain on iOS, EncryptedSharedPreferences on Android).
 *
 * Environment variables must be set via Expo's app config (app.json extra)
 * or via .env file with EXPO_PUBLIC_ prefix.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. " +
      "Supabase client will not function correctly."
  );
}

/**
 * SecureStore adapter for Supabase auth.
 * Stores auth tokens in the OS keychain/encrypted storage for security.
 *
 * SecureStore has a ~2KB value limit per key. Supabase session JSON can
 * exceed this, so we chunk values that are too large. This ensures the
 * full session (including JWT + refresh token) is stored securely.
 */
const CHUNK_SIZE = 1800; // Conservative limit under SecureStore's 2KB cap

const secureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const value = await SecureStore.getItemAsync(key);
      if (value !== null) return value;

      // Check for chunked storage
      const chunk0 = await SecureStore.getItemAsync(`${key}_chunk_0`);
      if (chunk0 === null) return null;

      let result = chunk0;
      let i = 1;
      while (true) {
        const chunk = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
        if (chunk === null) break;
        result += chunk;
        i++;
      }
      return result;
    } catch {
      console.error("SecureStore getItem error for key:", key);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        // Clean up any old chunks
        await SecureStore.deleteItemAsync(`${key}_chunk_0`).catch(() => {});
        return;
      }

      // Chunk the value for large sessions
      const chunks = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < chunks; i++) {
        await SecureStore.setItemAsync(
          `${key}_chunk_${i}`,
          value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        );
      }
      // Clean up the non-chunked key and any extra old chunks
      await SecureStore.deleteItemAsync(key).catch(() => {});
      await SecureStore.deleteItemAsync(`${key}_chunk_${chunks}`).catch(() => {});
    } catch {
      console.error("SecureStore setItem error for key:", key);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(key);
      // Clean up any chunks
      let i = 0;
      while (true) {
        try {
          const exists = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
          if (exists === null) break;
          await SecureStore.deleteItemAsync(`${key}_chunk_${i}`);
          i++;
        } catch {
          break;
        }
      }
    } catch {
      console.error("SecureStore removeItem error for key:", key);
    }
  },
};

/** Singleton Supabase client for the mobile app */
let mobileClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (mobileClient) return mobileClient;

  mobileClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // Not applicable for React Native
    },
  });

  return mobileClient;
}

export const supabase = getSupabaseClient();
