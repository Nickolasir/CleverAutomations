# Lawful Basis Register

GDPR Article 6 requires a documented lawful basis for each processing activity.

| # | Processing Activity | Data Categories | Lawful Basis | GDPR Article | Justification |
|---|---------------------|----------------|-------------|-------------|---------------|
| 1 | Account creation & auth | Email, display name | Contract | Art 6.1.b | Necessary to provide the service |
| 2 | Device control | Device states, commands | Contract | Art 6.1.b | Core smart home functionality |
| 3 | Voice command processing | Voice transcripts | Consent | Art 6.1.a | Explicit opt-in at registration |
| 4 | Health data (CleverAide) | Medications, medical info, wellness | Explicit Consent | Art 9.2.a | Special category — explicit consent required |
| 5 | Children's profiles | Family member data, age group | Parental Consent | Art 8 | Children under 16 require parental consent |
| 6 | Guest profile management | WiFi, door codes, TV logins | Contract | Art 6.1.b | STR checkout/check-in process |
| 7 | Sensor telemetry | Temperature, humidity, motion | Legitimate Interest | Art 6.1.f | Smart home automation operation |
| 8 | Audit logging | User actions, IP addresses | Legal Obligation | Art 6.1.c | Security accountability requirement |
| 9 | Caregiver alerts | Health status, alert messages | Vital Interests | Art 6.1.d | Emergency health situations |
| 10 | Marketing / CRM | Leads, affiliates, emails | Consent | Art 6.1.a | Opt-in only |
| 11 | Guest data wipe | All guest PII | Contract | Art 6.1.b | Required by STR checkout process |
| 12 | Parental notifications | Permission events, device commands | Legitimate Interest | Art 6.1.f | Child safety monitoring |
| 13 | Behavioral monitoring | Motion, occupancy patterns | Legitimate Interest | Art 6.1.f | Home automation — LIA documented |

## Legitimate Interest Assessments (LIA)

### Sensor Telemetry (Row 7)
- **Purpose:** Operate smart home automations (e.g., lights on when motion detected, climate control based on occupancy)
- **Necessity:** Cannot provide core service without sensor data
- **Balancing:** Data stays within tenant's own system; no cross-tenant sharing; 30-day retention; opt-out available
- **Conclusion:** Legitimate interest is proportionate

### Parental Notifications (Row 12)
- **Purpose:** Notify parents when children's device commands are denied or emergency commands are issued
- **Necessity:** Child safety requires real-time awareness
- **Balancing:** Only parents/guardians receive notifications; minimal data (action type, timestamp)
- **Conclusion:** Legitimate interest is proportionate — child safety overrides minimal privacy impact

### Behavioral Monitoring (Row 13)
- **Purpose:** Inactivity alerts for CleverAide assisted living users
- **Necessity:** Life-safety feature — prolonged inactivity may indicate fall or medical emergency
- **Balancing:** Only caregiver and user see data; configurable threshold; opt-out available; not used for profiling or marketing
- **Conclusion:** Legitimate interest is proportionate — vital safety function with narrow scope
