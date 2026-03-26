# CleverHub Privacy Policy

**Version:** 1.0
**Effective Date:** [INSERT DATE]
**Last Updated:** [INSERT DATE]

## 1. Data Controller

CleverHub ("we", "us", "our") is the data controller for personal data processed through the CleverHub smart home platform, including CleverHome, CleverHost, and CleverBuilding services.

**Contact:**
- Email: privacy@cleverhub.space
- Address: [INSERT REGISTERED ADDRESS]

## 2. Categories of Personal Data We Process

| Category | Examples | Lawful Basis |
|----------|----------|-------------|
| **Account Data** | Email address, display name, role | Contract (Art 6.1.b) |
| **Device Data** | Device states, commands issued, room assignments | Contract (Art 6.1.b) |
| **Voice Data** | Voice command transcripts (encrypted at rest) | Consent (Art 6.1.a) |
| **Health Data** | Medications, medical info, wellness check-ins (CleverAide only) | Explicit Consent (Art 9.2.a) |
| **Children's Data** | Family member profiles, age group, agent preferences | Parental Consent (Art 8) |
| **Guest Data** | WiFi credentials, door codes, TV logins (encrypted) | Contract (Art 6.1.b) |
| **Sensor Data** | Temperature, humidity, motion, occupancy | Legitimate Interest (Art 6.1.f) |
| **Audit Data** | User actions, IP addresses (hashed), timestamps | Legal Obligation (Art 6.1.c) |
| **Communication Data** | Phone numbers (WhatsApp/Telegram for alerts) | Consent (Art 6.1.a) |

**We do NOT store raw audio recordings.** Only encrypted transcripts of voice commands are retained.

## 3. Purposes of Processing

We process your personal data for the following purposes:
1. **Service Delivery** — operating your smart home devices, processing voice commands, managing automations
2. **Account Management** — authentication, authorization, multi-tenant access control
3. **Safety & Care** — medication reminders, wellness monitoring, caregiver alerts (CleverAide)
4. **Guest Management** — check-in/check-out automation, credential management (CleverHost)
5. **Security & Audit** — maintaining security logs, detecting unauthorized access, rate limiting
6. **Communication** — sending caregiver alerts, parental notifications, system notifications

## 4. Data Retention

| Data Type | Retention Period |
|-----------|-----------------|
| Audit logs | 90 days (configurable per tenant) |
| Voice transcripts | 90 days |
| Sensor telemetry | 30 days (raw data) |
| Health/wellness data | 180 days |
| Medication logs | 365 days |
| Guest profiles | Deleted at checkout (automatic wipe) |
| IP addresses | Hashed after 7 days, deleted with audit logs |
| Account data | Until account deletion |

Retention periods are enforced automatically by our data retention system.

## 5. Data Security

We protect your data using:
- **Encryption at rest:** All personal data is encrypted using AES-256-GCM with per-tenant keys stored in a hardware-backed vault (Supabase Vault / pgsodium)
- **Encryption in transit:** All connections use TLS 1.2 or higher
- **Access control:** Row-Level Security (RLS) with tenant isolation ensures you can only access your own data
- **Hashed identifiers:** Email addresses and IP addresses are stored as one-way hashes for lookups; encrypted copies are used for display
- **Secure mobile storage:** Authentication tokens are stored in OS-level secure storage (iOS Keychain / Android EncryptedSharedPreferences)
- **Audit logging:** All access to personal data is logged

## 6. Third-Party Processors

We use the following third-party services to process your data:

| Processor | Purpose | Data Shared | Location | DPA Status |
|-----------|---------|-------------|----------|------------|
| Supabase | Database, auth, storage | All data (encrypted) | US/EU | Required |
| Deepgram | Speech-to-text | Voice audio (streaming, not stored) | US | Required |
| Groq | Voice intent extraction | Transcripts (ephemeral) | US | Required |
| Cartesia | Text-to-speech | Response text (ephemeral) | US | Required |
| Telegram | Caregiver alerts | Chat IDs, alert messages | Various | Required |
| Meta (WhatsApp) | Caregiver alerts | Phone numbers, alert messages | US | Required |

For US-based processors, we rely on EU Standard Contractual Clauses (SCCs) for cross-border data transfers per GDPR Article 46.

## 7. Your Rights Under GDPR

You have the following rights regarding your personal data:

| Right | Description | How to Exercise |
|-------|-------------|-----------------|
| **Access** (Art 15) | Obtain a copy of all your personal data | Settings > Privacy > Export My Data |
| **Portability** (Art 20) | Download your data in machine-readable JSON format | Settings > Privacy > Export My Data |
| **Rectification** (Art 16) | Correct inaccurate personal data | Settings > Profile > Edit |
| **Erasure** (Art 17) | Delete all your personal data | Settings > Privacy > Delete My Account |
| **Restriction** (Art 18) | Restrict processing while keeping data stored | Settings > Privacy > Restrict Processing |
| **Objection** (Art 21) | Object to specific processing activities | Settings > Privacy > Manage Consents |
| **Withdraw Consent** (Art 7) | Withdraw previously given consent | Settings > Privacy > Manage Consents |

We respond to all data subject requests within 30 days per GDPR Article 12.

## 8. Children's Data

For users under 16, we require verifiable parental consent before processing any personal data (GDPR Article 8). Parents/guardians can:
- Grant or withdraw consent for their children's data processing
- Access, export, or delete their children's data
- Manage permission settings and content restrictions

## 9. Health Data (CleverAide)

Health data (medications, medical information, wellness check-ins) is classified as special category data under GDPR Article 9. We only process this data with your explicit consent. You can withdraw consent at any time, which will trigger immediate deletion of all health-related data.

## 10. Automated Decision-Making

Our system processes voice commands using AI (large language models) to extract intent and control devices. This processing:
- Does NOT constitute automated decision-making with legal or significant effects (Art 22)
- Requires minimum confidence (70%) before executing commands
- Always allows manual override via the app interface
- Sensor data is used for automation only, not for profiling

## 11. Cookies

Our web dashboard uses essential cookies for session management. We do not use tracking cookies or third-party analytics cookies.

## 12. Data Breach Notification

In the event of a personal data breach:
- We will notify the supervisory authority within 72 hours (Art 33)
- We will notify affected data subjects without undue delay if the breach poses a high risk (Art 34)

## 13. Contact & Complaints

For privacy inquiries or to exercise your rights:
- Email: privacy@cleverhub.space
- In-app: Settings > Privacy

You have the right to lodge a complaint with your local supervisory authority.

## 14. Changes to This Policy

We will notify you of material changes to this policy and may require re-consent where necessary. The current version is always available at [APP_URL]/privacy.
