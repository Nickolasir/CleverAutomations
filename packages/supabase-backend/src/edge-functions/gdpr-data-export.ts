/**
 * GDPR Data Export Edge Function (Right of Access + Portability)
 * Articles 15 and 20
 *
 * Collects and decrypts all personal data for the requesting user across
 * all tables. Returns machine-readable JSON (Art 20 portability).
 *
 * Rate limited: 1 request per 24 hours per user.
 * Audit logged.
 *
 * POST /functions/v1/gdpr-data-export
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Rate limit check: 1 per 24 hours
    const { data: recentRequest } = await supabase
      .from("data_subject_requests")
      .select("id, created_at")
      .eq("user_id", user.id)
      .in("request_type", ["access", "portability"])
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .single();

    if (recentRequest) {
      return new Response(
        JSON.stringify({
          error: "Rate limited. Data export can be requested once per 24 hours.",
          last_request: recentRequest.created_at,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get user's internal record
    const { data: userRecord } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!userRecord) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tenantId = userRecord.tenant_id;

    // Decrypt user's PII fields
    const { data: decryptedEmail } = await serviceClient.rpc("decrypt_pii", {
      p_ciphertext: userRecord.email_encrypted,
      p_tenant_id: tenantId,
    });
    const { data: decryptedName } = await serviceClient.rpc("decrypt_pii", {
      p_ciphertext: userRecord.display_name_encrypted,
      p_tenant_id: tenantId,
    });

    // Collect data from all tables
    const exportData: Record<string, unknown> = {
      metadata: {
        export_date: new Date().toISOString(),
        user_id: user.id,
        gdpr_articles: ["Art 15 (Right of Access)", "Art 20 (Right to Data Portability)"],
        format: "JSON",
      },
      user_profile: {
        email: decryptedEmail,
        display_name: decryptedName,
        role: userRecord.role,
        processing_restricted: userRecord.processing_restricted,
        created_at: userRecord.created_at,
      },
    };

    // Consent records
    const { data: consents } = await supabase
      .from("consent_records")
      .select("*")
      .eq("user_id", user.id);
    exportData.consent_records = consents ?? [];

    // Voice sessions (decrypted via SQL function)
    const { data: voiceSessions } = await serviceClient
      .from("voice_sessions")
      .select("id, tier, status, confidence, created_at, tenant_id, transcript_encrypted")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);

    if (voiceSessions) {
      const decryptedSessions = [];
      for (const session of voiceSessions) {
        const { data: transcript } = await serviceClient.rpc("decrypt_pii", {
          p_ciphertext: session.transcript_encrypted,
          p_tenant_id: tenantId,
        });
        decryptedSessions.push({
          ...session,
          transcript: transcript,
          transcript_encrypted: undefined,
        });
      }
      exportData.voice_sessions = decryptedSessions;
    }

    // Family member profiles
    const { data: familyProfiles } = await supabase
      .from("family_member_profiles")
      .select("*")
      .eq("user_id", user.id);
    exportData.family_profiles = familyProfiles ?? [];

    // Aide profiles (if any)
    if (familyProfiles?.length) {
      const profileIds = familyProfiles.map((p: { id: string }) => p.id);
      const { data: aideProfiles } = await serviceClient
        .from("aide_profiles")
        .select("*")
        .in("profile_id", profileIds);

      if (aideProfiles?.length) {
        const decryptedAide = [];
        for (const ap of aideProfiles) {
          const { data: medInfo } = await serviceClient.rpc("decrypt_pii_jsonb", {
            p_ciphertext: ap.medical_info_encrypted,
            p_tenant_id: tenantId,
          });
          const { data: contacts } = await serviceClient.rpc("decrypt_pii_jsonb", {
            p_ciphertext: ap.emergency_contacts_encrypted,
            p_tenant_id: tenantId,
          });
          decryptedAide.push({
            ...ap,
            medical_info: medInfo,
            emergency_contacts: contacts,
            medical_info_encrypted: undefined,
            emergency_contacts_encrypted: undefined,
          });
        }
        exportData.aide_profiles = decryptedAide;
      }
    }

    // Audit logs (user's own actions)
    const { data: auditLogs } = await supabase
      .from("audit_logs")
      .select("action, details, created_at")
      .eq("user_id", userRecord.id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(500);
    exportData.audit_logs = auditLogs ?? [];

    // Chat messages
    const { data: chatMessages } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    exportData.chat_messages = chatMessages ?? [];

    // Email accounts (decrypt PII fields)
    const { data: emailAccounts } = await serviceClient
      .from("email_accounts")
      .select("*")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);

    if (emailAccounts?.length) {
      const decryptedEmailAccounts = [];
      for (const acc of emailAccounts) {
        const { data: email } = await serviceClient.rpc("decrypt_pii", {
          p_ciphertext: acc.email_address_encrypted,
          p_tenant_id: tenantId,
        });
        const { data: name } = await serviceClient.rpc("decrypt_pii", {
          p_ciphertext: acc.display_name_encrypted,
          p_tenant_id: tenantId,
        });
        decryptedEmailAccounts.push({
          id: acc.id,
          provider: acc.provider,
          email_address: email,
          display_name: name,
          is_active: acc.is_active,
          created_at: acc.created_at,
        });
      }
      exportData.email_accounts = decryptedEmailAccounts;
    }

    // Email cache (decrypt subject, sender, snippet)
    if (emailAccounts?.length) {
      const accountIds = emailAccounts.map((a: { id: string }) => a.id);
      const { data: emailCache } = await serviceClient
        .from("email_cache")
        .select("*")
        .in("email_account_id", accountIds);

      if (emailCache?.length) {
        const decryptedEmails = [];
        for (const ec of emailCache) {
          const { data: subject } = await serviceClient.rpc("decrypt_pii", {
            p_ciphertext: ec.subject_encrypted,
            p_tenant_id: tenantId,
          });
          const { data: sender } = await serviceClient.rpc("decrypt_pii", {
            p_ciphertext: ec.sender_encrypted,
            p_tenant_id: tenantId,
          });
          const { data: snippet } = ec.snippet_encrypted
            ? await serviceClient.rpc("decrypt_pii", {
                p_ciphertext: ec.snippet_encrypted,
                p_tenant_id: tenantId,
              })
            : { data: null };
          decryptedEmails.push({
            subject,
            sender,
            snippet,
            is_read: ec.is_read,
            is_important: ec.is_important,
            received_at: ec.received_at,
          });
        }
        exportData.email_cache = decryptedEmails;
      }
    }

    // Calendar accounts
    const { data: calendarAccounts } = await supabase
      .from("calendar_accounts")
      .select("id, provider, display_name, is_primary, created_at")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    exportData.calendar_accounts = calendarAccounts ?? [];

    // Calendar event cache (decrypt summary, description, location)
    if (calendarAccounts?.length) {
      const calIds = calendarAccounts.map((c: { id: string }) => c.id);
      const { data: eventCache } = await serviceClient
        .from("calendar_event_cache")
        .select("*")
        .in("calendar_account_id", calIds);

      if (eventCache?.length) {
        const decryptedEvents = [];
        for (const ev of eventCache) {
          const { data: summary } = await serviceClient.rpc("decrypt_pii", {
            p_ciphertext: ev.summary_encrypted,
            p_tenant_id: tenantId,
          });
          const { data: location } = ev.location_encrypted
            ? await serviceClient.rpc("decrypt_pii", {
                p_ciphertext: ev.location_encrypted,
                p_tenant_id: tenantId,
              })
            : { data: null };
          decryptedEvents.push({
            summary,
            location,
            start_time: ev.start_time,
            end_time: ev.end_time,
            is_all_day: ev.is_all_day,
          });
        }
        exportData.calendar_event_cache = decryptedEvents;
      }
    }

    // Food logs (nutrition — personal health data, decrypt description)
    const { data: foodLogs } = await serviceClient
      .from("food_logs")
      .select("*")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);

    if (foodLogs?.length) {
      const decryptedFoodLogs = [];
      for (const fl of foodLogs) {
        const { data: description } = await serviceClient.rpc("decrypt_pii_user", {
          p_ciphertext: fl.description_encrypted,
          p_tenant_id: tenantId,
          p_user_id: userRecord.id,
        });
        const { data: notes } = fl.notes_encrypted
          ? await serviceClient.rpc("decrypt_pii_user", {
              p_ciphertext: fl.notes_encrypted,
              p_tenant_id: tenantId,
              p_user_id: userRecord.id,
            })
          : { data: null };
        decryptedFoodLogs.push({
          ...fl,
          description,
          notes,
          description_encrypted: undefined,
          notes_encrypted: undefined,
        });
      }
      exportData.food_logs = decryptedFoodLogs;
    }

    // Nutrition goals
    const { data: nutritionGoals } = await supabase
      .from("nutrition_goals")
      .select("*")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    exportData.nutrition_goals = nutritionGoals ?? [];

    // Water logs
    const { data: waterLogs } = await supabase
      .from("water_logs")
      .select("*")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    exportData.water_logs = waterLogs ?? [];

    // Food items (tenant-level cached product references)
    const { data: foodItems } = await supabase
      .from("food_items")
      .select("*")
      .eq("tenant_id", tenantId);
    exportData.food_items = foodItems ?? [];

    // Email access audit log (entries where user is accessor or target)
    const { data: emailAccessAudit } = await supabase
      .from("email_access_audit_log")
      .select("*")
      .eq("tenant_id", tenantId)
      .or(`accessor_user_id.eq.${user.id},target_user_id.eq.${user.id}`)
      .order("accessed_at", { ascending: false });
    exportData.email_access_audit_log = emailAccessAudit ?? [];

    // Family messages (sent or received by user)
    const { data: familyMessages } = await serviceClient
      .from("family_messages")
      .select("*")
      .eq("tenant_id", tenantId)
      .or(`sender_user_id.eq.${user.id},recipient_user_id.eq.${user.id}`);

    if (familyMessages?.length) {
      const decryptedMessages = [];
      for (const msg of familyMessages) {
        const { data: content } = await serviceClient.rpc("decrypt_pii", {
          p_ciphertext: msg.content_encrypted,
          p_tenant_id: tenantId,
        });
        decryptedMessages.push({
          ...msg,
          content,
          content_encrypted: undefined,
        });
      }
      exportData.family_messages = decryptedMessages;
    }

    // Email delegation grants (as parent or child)
    const { data: delegationGrants } = await supabase
      .from("email_delegation_grants")
      .select("*")
      .eq("tenant_id", tenantId)
      .or(`parent_user_id.eq.${user.id},child_user_id.eq.${user.id}`);
    exportData.email_delegation_grants = delegationGrants ?? [];

    // Email/calendar alert rules
    const { data: alertRules } = await supabase
      .from("email_calendar_alert_rules")
      .select("alert_type, conditions, actions, is_active, created_at")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    exportData.email_calendar_alert_rules = alertRules ?? [];

    // Email/calendar notification preferences
    const { data: ecNotifPrefs } = await supabase
      .from("email_calendar_notification_prefs")
      .select("*")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    exportData.email_calendar_notification_prefs = ecNotifPrefs ?? [];

    // Record the DSAR
    await supabase.from("data_subject_requests").insert({
      tenant_id: tenantId,
      user_id: user.id,
      request_type: "portability",
      status: "completed",
      request_details: { format: "json" },
      response_data: { tables_exported: Object.keys(exportData).length },
      completed_at: new Date().toISOString(),
    });

    // Audit log
    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      action: "data_exported",
      details: { tables: Object.keys(exportData), record_counts: {} },
    });

    return new Response(
      JSON.stringify(exportData),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="gdpr-export-${user.id}-${Date.now()}.json"`,
        },
      },
    );
  } catch (err) {
    console.error("GDPR data export error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
