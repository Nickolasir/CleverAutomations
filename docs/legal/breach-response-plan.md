# Data Breach Response Plan

**GDPR Articles 33 and 34**

## 1. Breach Classification

| Severity | Definition | Notification Required |
|----------|-----------|----------------------|
| **Critical** | Health data, credentials, or financial data compromised | Supervisory authority (72h) + data subjects |
| **High** | PII exposed (emails, names, IPs) for >100 users | Supervisory authority (72h) + data subjects |
| **Medium** | PII exposed for <100 users, encrypted data | Supervisory authority (72h) |
| **Low** | Encrypted data only, no decryption key compromised | Internal record only |

## 2. Response Timeline

| Phase | Timeframe | Actions |
|-------|-----------|---------|
| **Detection** | T+0 | Identify breach scope, affected tenants, data types |
| **Containment** | T+1h | Revoke compromised tokens, rotate encryption keys, block attack vector |
| **Assessment** | T+4h | Determine: # users affected, data categories, risk to rights/freedoms |
| **Authority Notification** | T+72h max | File notification with supervisory authority (Art 33) |
| **Subject Notification** | Without undue delay | Notify affected users if high risk to rights/freedoms (Art 34) |
| **Remediation** | T+1 week | Fix root cause, update security measures, document lessons |
| **Review** | T+30 days | Post-incident review, update DPIA, update this plan |

## 3. Supervisory Authority Notification (Art 33)

Must include:
1. Nature of the breach (categories and approximate number of data subjects)
2. Name and contact details of the DPO or contact point
3. Likely consequences of the breach
4. Measures taken or proposed to address the breach

## 4. Data Subject Notification (Art 34)

Required when breach poses a HIGH risk to rights and freedoms. Must include:
1. Clear, plain language description of the breach
2. Name and contact details of the DPO
3. Likely consequences
4. Measures taken and recommended actions for the data subject

**Notification NOT required if:**
- Data was encrypted and keys were not compromised
- Subsequent measures ensure high risk is no longer likely
- Individual notification would involve disproportionate effort (use public communication)

## 5. Technical Response Procedures

### Compromised Database Access
1. Rotate all Supabase service role keys
2. Rotate all tenant encryption keys via `provision_tenant_encryption_key()`
3. Re-encrypt all PII with new keys
4. Invalidate all active sessions
5. Force password reset for affected users

### Compromised API Keys
1. Rotate affected API key (Deepgram, Groq, Cartesia, etc.)
2. Review audit logs for unauthorized access during exposure window
3. Update env variables across all deployments

### Compromised User Credentials
1. Force password reset for affected accounts
2. Invalidate all sessions for affected users
3. Enable MFA if not already active
4. Review audit logs for unauthorized actions

## 6. Breach Register

All breaches (including low-severity) must be logged in the breach register:

| Field | Description |
|-------|-------------|
| Date/time of detection | |
| Date/time breach occurred | |
| Description | |
| Data categories affected | |
| Number of data subjects | |
| Severity classification | |
| Containment actions taken | |
| Supervisory authority notified? | |
| Data subjects notified? | |
| Root cause | |
| Remediation actions | |
| Lessons learned | |

## 7. Roles and Responsibilities

| Role | Responsibility |
|------|---------------|
| **Incident Commander** | Coordinates response, makes notification decisions |
| **DPO** | Advises on GDPR obligations, drafts notifications |
| **Engineering Lead** | Technical containment and remediation |
| **Legal** | Reviews notifications, advises on liability |
| **Communications** | Drafts user-facing notifications |

## 8. Testing

This plan should be tested via tabletop exercise at least annually. Document results and update procedures as needed.
