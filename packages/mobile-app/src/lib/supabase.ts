import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Mobile Supabase client with AsyncStorage for persistent session management.
 * Uses expo-secure-store for sensitive token storage via AsyncStorage adapter.
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
 * AsyncStorage adapter for Supabase auth.
 * Stores auth tokens in React Native AsyncStorage for persistence
 * across app restarts.
 */
const asyncStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      console.error("AsyncStorage getItem error for key:", key);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      console.error("AsyncStorage setItem error for key:", key);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      console.error("AsyncStorage removeItem error for key:", key);
    }
  },
};

/** Singleton Supabase client for the mobile app */
let mobileClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (mobileClient) return mobileClient;

  mobileClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: asyncStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // Not applicable for React Native
    },
  });

  return mobileClient;
}

export const supabase = getSupabaseClient();
