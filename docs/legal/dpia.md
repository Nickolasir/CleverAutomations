# Data Protection Impact Assessment (DPIA)

**GDPR Article 35**
**Date:** [INSERT DATE]
**Assessor:** [INSERT NAME]
**Status:** Draft — requires DPO review before production deployment

---

## 1. Why a DPIA Is Required

GDPR Article 35 requires a DPIA when processing is likely to result in a high risk to rights and freedoms. CleverHub triggers this requirement due to:

- **(a) Systematic monitoring:** Sensor telemetry (motion, occupancy) in private homes
- **(b) Special category data at scale:** Health data (medications, medical info, wellness) via CleverAide
- **(c) Children's data:** Family member profiles for users under 16
- **(d) Innovative technology:** AI-powered voice control with LLM intent extraction

## 2. Description of Processing

### 2.1 Nature
CleverHub is a multi-tenant AI-powered smart home platform that processes voice commands, controls IoT devices, monitors health data for assisted living users, and manages guest lifecycles for short-term rental properties.

### 2.2 Scope
- **Data subjects:** Homeowners, family members (including children), guests, elderly/disabled users, caregivers
- **Data types:** Voice transcripts, device states, sensor readings, health/medication data, location inference (room-level), behavioral patterns (occupancy)
- **Volume:** Per-tenant (household-level), not mass surveillance
- **Geography:** EU and non-EU users; data processed via US-based cloud APIs

### 2.3 Context
- Private residential homes — heightened expectation of privacy
- Health data for vulnerable individuals (elderly, disabled)
- Children's data with age-specific restrictions
- Voice data in private living spaces

### 2.4 Purpose
- Smart home device control
- Health and safety monitoring for assisted living
- Guest credential management for short-term rentals
- Family safety (parental controls, emergency alerts)

## 3. Necessity and Proportionality Assessment

| Principle | Assessment |
|-----------|-----------|
| **Lawful basis** | Documented per processing activity (see lawful-basis-register.md) |
| **Purpose limitation** | Data used only for stated purposes; no secondary use for marketing/profiling |
| **Data minimization** | No raw audio stored; transcripts only; 30-90 day retention limits |
| **Accuracy** | Users can rectify data via GDPR endpoint; real-time device state sync |
| **Storage limitation** | Automated retention enforcement with configurable per-tenant TTLs |
| **Integrity & confidentiality** | AES-256-GCM encryption, RLS, JWT auth, TLS 1.2+ |

## 4. Risk Assessment

### 4.1 Risks to Data Subjects

| Risk | Likelihood | Severity | Overall | Mitigation |
|------|-----------|----------|---------|------------|
| Health data breach | Low | Critical | High | Field-level encryption (pgsodium), RLS, audit logging |
| Voice data interception | Low | High | Medium | TLS 1.2+ in transit, encrypted at rest, no raw audio stored |
| Unauthorized device control | Low | High | Medium | JWT auth, RLS, rate limiting, confidence threshold |
| Children's data exposure | Low | High | Medium | Parental consent gating, age-based permissions, RLS |
| Cross-tenant data leak | Very Low | Critical | Medium | Tenant isolation via JWT claims + RLS on every table |
| Behavioral profiling | Very Low | Medium | Low | Sensor data used only for automation; 30-day retention; opt-out |
| Third-party processor breach | Low | High | Medium | DPAs required; data encrypted before transmission; ephemeral processing |
| Guest credential exposure | Low | High | Medium | Field-level encryption; automatic wipe on checkout; 6-category checklist |

### 4.2 Risks to the Organization

| Risk | Mitigation |
|------|-----------|
| GDPR fine (up to 4% annual turnover) | Full compliance framework implemented |
| Reputational damage from breach | Encryption, audit logging, breach notification procedure |
| Regulatory investigation | Complete audit trail, DSAR endpoints, documented lawful basis |

## 5. Measures to Address Risks

### 5.1 Technical Measures
- [x] Field-level encryption (AES-256-GCM via pgsodium + Supabase Vault)
- [x] Per-tenant encryption keys
- [x] TLS 1.2+ for all data in transit
- [x] Row-Level Security on all database tables
- [x] JWT-based authentication with role hierarchy
- [x] Rate limiting on device commands (60/min)
- [x] Confidence threshold for voice commands (0.7)
- [x] Secure mobile token storage (OS keychain)
- [x] Automated data retention enforcement
- [x] Guest data wipe with 6-category checklist
- [x] IP address hashing after 7 days

### 5.2 Organizational Measures
- [x] Privacy policy published and versioned
- [x] Lawful basis documented per processing activity
- [x] Consent management system with withdrawal support
- [x] Data subject rights endpoints (access, erasure, rectification, restriction)
- [x] Breach notification procedure documented
- [ ] DPAs executed with all third-party processors
- [ ] Staff training on data protection
- [ ] Annual DPIA review scheduled
- [ ] DPO appointed (required if processing health data at scale)

### 5.3 Residual Risks
After implementing all measures:
- **Health data breach:** Reduced to Very Low (encrypted at rest + in transit + RLS)
- **Cross-tenant leak:** Reduced to Negligible (RLS + JWT tenant isolation tested)
- **Voice interception:** Reduced to Very Low (TLS + no raw audio storage)

## 6. Consultation

- [ ] DPO review and sign-off
- [ ] Supervisory authority consultation (if residual risk remains high per Art 36)
- [ ] Annual review date set

## 7. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Data Controller | | | |
| DPO | | | |
| CTO | | | |
