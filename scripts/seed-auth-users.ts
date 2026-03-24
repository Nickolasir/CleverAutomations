/**
 * Seed Supabase Auth users for mobile app login.
 *
 * Creates auth.users entries matching the IDs in the existing seed data
 * so that supabase.auth.signInWithPassword() works from the mobile app.
 *
 * Usage:
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
 *   npx tsx scripts/seed-auth-users.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env["SUPABASE_URL"];
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TENANT_ID = "a0000000-0000-4000-8000-000000000001";

const AUTH_USERS = [
  {
    id: "b0000000-0000-4000-8000-000000000001",
    email: "owner@cleverhost-demo.com",
    password: "clever-owner-2026",
    display_name: "Alex Owner",
    role: "owner",
  },
  {
    id: "b0000000-0000-4000-8000-000000000002",
    email: "resident@cleverhost-demo.com",
    password: "clever-resident-2026",
    display_name: "Jordan Resident",
    role: "resident",
  },
];

async function main() {
  console.log("Seeding Supabase Auth users...");
  console.log(`Target: ${SUPABASE_URL}\n`);

  for (const user of AUTH_USERS) {
    // Check if auth user already exists
    const { data: existing } = await supabase.auth.admin.getUserById(user.id);

    if (existing?.user) {
      console.log(`  [skip] ${user.email} — auth user already exists`);
      continue;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      id: user.id,
      email: user.email,
      password: user.password,
      email_confirm: true, // Auto-confirm so they can login immediately
      user_metadata: {
        display_name: user.display_name,
      },
      app_metadata: {
        tenant_id: TENANT_ID,
        role: user.role,
        user_role: user.role,
      },
    });

    if (error) {
      console.error(`  [FAIL] ${user.email}: ${error.message}`);
    } else {
      console.log(`  [ok]   ${user.email} (${user.role}) — password: ${user.password}`);
    }
  }

  // Verify by attempting a sign-in with the owner account
  console.log("\nVerifying login...");
  const { data: session, error: loginError } =
    await supabase.auth.signInWithPassword({
      email: AUTH_USERS[0].email,
      password: AUTH_USERS[0].password,
    });

  if (loginError) {
    console.error(`  Login verification FAILED: ${loginError.message}`);
  } else {
    console.log(`  Login verified for ${session.user?.email}`);
    console.log(`  JWT subject: ${session.user?.id}`);
    await supabase.auth.signOut();
  }

  console.log("\n===================================");
  console.log("Mobile App Login Credentials:");
  console.log("===================================");
  for (const user of AUTH_USERS) {
    console.log(`  ${user.display_name} (${user.role})`);
    console.log(`    Email:    ${user.email}`);
    console.log(`    Password: ${user.password}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
