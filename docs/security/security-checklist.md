# Security Checklist for Pull Requests

**Document Owner:** security-auditor
**Last Updated:** 2026-02-12
**Applies To:** Every pull request that modifies packages/, supabase migrations, or Edge Functions

---

## Instructions

Every PR author must complete this checklist before requesting review. The security-auditor agent will verify compliance during review. Any unchecked item must include a justification comment in the PR description.

Copy this checklist into your PR description and check each item:

---

## Checklist

### 1. Row Level Security (RLS)

- [ ] **New tables have RLS policies.** Every new database table includes a `tenant_id` column and corresponding RLS policies for SELECT, INSERT, UPDATE, and DELETE.
- [ ] **RLS policies use JWT claims.** Policies read `tenant_id` from `auth.jwt()->>'tenant_id'` (or `auth.jwt()->'app_metadata'->>'tenant_id'`), never from request parameters or body.
- [ ] **Cross-tenant isolation test added.** A new test case in `rls-isolation.test.ts` verifies that Tenant A cannot read, write, update, or delete Tenant B's rows in the new table.
- [ ] **Role-based access verified.** RLS policies enforce the correct access level per role (owner > admin > manager > resident > guest) for the new table.

### 2. Authentication

- [ ] **JWT auth required on new endpoints.** Every new API endpoint, Edge Function, or RPC function requires a valid JWT in the Authorization header. The only exception is the health check endpoint.
- [ ] **Device-scoped tokens respected.** If the endpoint is device-related, it checks the `device_scope` claim in the JWT and restricts access accordingly.
- [ ] **No anonymous access.** Verified that unauthenticated (anon) requests to the new endpoint return 401 or empty results via RLS.

### 3. Tenant Isolation

- [ ] **tenant_id included in all queries.** Every database query in the new code filters by `tenant_id`. No unbounded `SELECT *` queries that could leak cross-tenant data.
- [ ] **Edge Functions extract tenant_id from JWT.** If the PR adds or modifies an Edge Function, `tenant_id` is extracted from the JWT, not from request parameters.
- [ ] **Service role key not used for user-facing operations.** The `SUPABASE_SERVICE_ROLE_KEY` is never used in Edge Functions that handle user requests. Service role is reserved for admin/background operations only.

### 4. Credentials and Secrets

- [ ] **No hardcoded credentials.** No API keys, passwords, tokens, or connection strings appear in source code. All secrets are accessed via `process.env` or Supabase Vault.
- [ ] **Credential scan passes.** The `credential-scan.test.ts` test passes without findings for the changed files.
- [ ] **.env.example updated.** If a new environment variable is introduced, `.env.example` is updated with a placeholder value (e.g., `your-new-key`).
- [ ] **.gitignore coverage.** Any new secret file types (`.pem`, `.key`, `.p12`) are added to `.gitignore`.

### 5. Voice Pipeline Security

- [ ] **Confidence threshold enforced.** Any new voice command processing path enforces the 0.7 confidence threshold from `CONFIDENCE_THRESHOLD`. Commands below this threshold require user confirmation.
- [ ] **No raw audio stored.** The PR does not add any code that uploads raw audio (WAV, FLAC, MP3, OGG, PCM) to cloud storage. Only encrypted transcripts are stored.
- [ ] **Transcript encryption.** Any new transcript storage uses the `transcript_encrypted` field with encryption applied before write.
- [ ] **Input sanitization.** Voice transcripts are sanitized before being used in any database query, system command, or API call to prevent injection attacks.

### 6. Audit Logging

- [ ] **Audit log entry created.** Every new user-facing action that modifies state (device control, user management, settings change, guest lifecycle) creates an `audit_logs` entry.
- [ ] **Audit log includes required fields.** Each audit entry includes: `tenant_id`, `user_id` (or null for system actions), `action`, `details`, and `timestamp`.
- [ ] **Audit logs remain append-only.** No new code adds UPDATE or DELETE operations on the `audit_logs` table for non-owner roles.

### 7. Rate Limiting

- [ ] **Rate limiting applied to new endpoints.** Any new endpoint that accepts commands or mutations has rate limiting configured (default: 60 requests/minute/user).
- [ ] **Rate limit is per-user.** Rate limiting is keyed by authenticated user identity, not by IP address alone.
- [ ] **Rate limit headers returned.** Responses include `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers.

### 8. Input Validation

- [ ] **Request body validated.** All new endpoints validate the structure and types of incoming request bodies. Unexpected fields are rejected or ignored.
- [ ] **String length limits enforced.** Text input fields (names, descriptions, transcripts) have maximum length limits to prevent storage abuse.
- [ ] **Enum values validated.** Fields that should contain specific values (roles, device categories, statuses) are validated against the allowed set.
- [ ] **SQL injection prevented.** All database operations use parameterized queries via the Supabase client SDK. No raw SQL string concatenation.

### 9. Guest Data Wipe

- [ ] **Wipe updated for new data types.** If the PR adds a new type of guest-associated data (e.g., a new preference, credential, or history record), the guest wipe process in `REQUIRED_WIPE_CATEGORIES` is updated to include it.
- [ ] **Wipe test updated.** The `guest-wipe.test.ts` file includes a test verifying the new data type is cleared during wipe.
- [ ] **No PII persists after wipe.** After the wipe process completes, a query for the guest's data returns empty or anonymized results for the new data type.

### 10. GDPR Compliance

- [ ] **Consent recorded before processing.** If the PR adds a new data processing activity that relies on consent (Art 6.1.a), the code verifies that the user has an active `consent_records` entry of the appropriate type before proceeding.
- [ ] **Encrypted fields use `encrypt_pii()` helper.** All new PII fields stored in the database use the `encrypt_pii()` / `encrypt_pii_jsonb()` SQL functions or the TypeScript `encryptField()` wrapper. No plaintext PII in new columns.
- [ ] **Data retention policy updated.** If the PR creates a new table that stores personal data, the table is added to the data retention enforcement function (`enforce_data_retention`) with an appropriate TTL.
- [ ] **DPIA reviewed for new monitoring/profiling.** If the PR adds behavioral monitoring, sensor processing, or any automated decision-making feature, the DPIA (`docs/legal/dpia.md`) is reviewed and updated.
- [ ] **DPA verified for new third-party APIs.** If the PR integrates a new third-party service that processes personal data, a Data Processing Agreement requirement is documented and tracked.
- [ ] **Data subject rights unaffected.** The GDPR data export endpoint (`gdpr-data-export.ts`) is updated to include any new PII table, ensuring the Right of Access covers all user data.
- [ ] **Children's data gated by parental consent.** If the PR processes data from family members with age_group in (toddler, child, tween, teenager), it verifies `has_parental_consent()` before processing.
- [ ] **Processing restriction respected.** If the PR adds data processing logic, it checks the `processing_restricted` flag on the user record and skips processing if restricted (Art 18).
- [ ] **Health data requires explicit consent.** Any new processing of CleverAide data verifies `has_active_consent(user_id, 'health_data')` before proceeding (Art 9).
- [ ] **Audit log for GDPR events.** Consent grants, withdrawals, data exports, erasures, and restriction changes are logged in `audit_logs`.

---

## Quick Reference: When to Check What

| If your PR... | Check sections |
|---------------|---------------|
| Adds a new database table | 1, 2, 3, 6, 10 |
| Adds a new API endpoint or Edge Function | 2, 3, 4, 7, 8, 10 |
| Modifies the voice pipeline | 5, 6, 8, 10 |
| Adds guest-related features | 1, 3, 6, 9, 10 |
| Introduces a new environment variable | 4 |
| Modifies user roles or permissions | 1, 2, 3, 6, 10 |
| Adds device command functionality | 6, 7, 8, 10 |
| Stores new PII or health data | 1, 6, 10 |
| Integrates a new third-party API | 4, 10 |
| Adds child/family data processing | 1, 3, 10 |

---

## Automated Enforcement

The following tests enforce this checklist automatically in CI:

| Test File | Checks |
|-----------|--------|
| `rls-isolation.test.ts` | Sections 1, 3 (cross-tenant isolation, role-based access) |
| `auth-flow.test.ts` | Section 2 (JWT validation, token rejection, unauthenticated access) |
| `rate-limiting.test.ts` | Section 7 (rate limit enforcement, per-user buckets) |
| `security.test.ts` | Section 5 (confidence threshold, audio storage, injection prevention) |
| `guest-wipe.test.ts` | Section 9 (wipe completeness, partial failure handling) |
| `credential-scan.test.ts` | Section 4 (hardcoded secrets, .gitignore, .env.example) |

Run all security tests:

```bash
npm run security-test
```

---

## Escalation

If a PR cannot satisfy a checklist item, the author must:

1. Document the reason in the PR description
2. Tag the security-auditor for review
3. Create a follow-up issue to address the gap
4. Do NOT merge without security-auditor approval on the exception
