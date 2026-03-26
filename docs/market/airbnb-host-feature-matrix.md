# CleverHost Feature Matrix — PMS API Capabilities

**CleverHub — CleverHost Vertical**
**Last Updated: 2026-02-12**

---

## Executive Summary

CleverHost automates the entire guest lifecycle for short-term rental (STR) hosts: from reservation sync through check-in, stay, check-out, cleaning dispatch, and data wipe. Because Airbnb, Vrbo, and Booking.com do not provide direct API access to individual hosts (Airbnb's API is restricted to approved "Software Partners" only), CleverHost must integrate through Property Management System (PMS) platforms that already have authorized API connections.

This document evaluates the three leading PMS platforms — **Guesty**, **Hospitable** (formerly Smartbnb), and **OwnerRez** — across every CleverHost feature requirement, with specific API endpoint analysis and rate limit documentation.

---

## Critical Constraint: No Direct Airbnb API

| Platform | API Access | Who Can Get It |
|----------|-----------|---------------|
| Airbnb | Restricted to approved Software Partners | Only companies in Airbnb's "Connected Software" program; requires application, review, annual re-certification |
| Vrbo (Expedia Group) | Connectivity Partner Program | Similar restrictions to Airbnb |
| Booking.com | Connectivity Partner Programme | Open to qualified channel managers |

**Implication**: CleverHost MUST integrate through a PMS that already holds these partnerships. This is non-negotiable for our v1 architecture. Going through the PMS also gives us multi-channel support (Airbnb + Vrbo + Booking.com + direct bookings) out of the box.

---

## PMS Platform Overview

### Guesty

| Attribute | Detail |
|-----------|--------|
| **Website** | guesty.com |
| **Founded** | 2013 (Tel Aviv, Israel) |
| **Market Position** | Enterprise-grade; largest independent PMS |
| **Target Customer** | Professional hosts and property managers (5–5,000+ listings) |
| **Pricing** | Custom / quote-based; typically 2–5% of revenue or $15–30/listing/mo |
| **API Type** | REST API (v1 & Open API v2) |
| **API Documentation** | open-api.guesty.com |
| **Authentication** | OAuth 2.0 (API tokens for server-to-server) |
| **Channel Support** | Airbnb, Vrbo, Booking.com, Google Vacation Rentals, 60+ channels |
| **Notable** | Has Guesty Lite (formerly "Your Porter") for smaller hosts |
| **Integration Partners** | 100+ integrations including smart lock companies (August, Yale, Schlage) |

### Hospitable (formerly Smartbnb)

| Attribute | Detail |
|-----------|--------|
| **Website** | hospitable.com |
| **Founded** | 2016 (Paris, France) |
| **Market Position** | Mid-market; automation-focused |
| **Target Customer** | Individual to mid-size hosts (1–200 listings) |
| **Pricing** | $25/mo for 1 property; $40/mo for 2; tiered up |
| **API Type** | REST API |
| **API Documentation** | Limited public docs; partner API available on request |
| **Authentication** | API Key |
| **Channel Support** | Airbnb, Vrbo, Booking.com |
| **Notable** | Best-in-class automated messaging; excellent for solo hosts |
| **Integration Partners** | Smart locks (RemoteLock, Schlage), cleaning (TurnoverBnB) |

### OwnerRez

| Attribute | Detail |
|-----------|--------|
| **Website** | ownerrez.com |
| **Founded** | 2011 (USA) |
| **Market Position** | Power-user focused; feature-rich at low cost |
| **Target Customer** | Tech-savvy individual hosts (1–100 listings) |
| **Pricing** | $40/mo base + $6/property/mo (one of the cheapest) |
| **API Type** | REST API (comprehensive) |
| **API Documentation** | app.ownerrez.com/api/docs |
| **Authentication** | API Key (Basic Auth) |
| **Channel Support** | Airbnb, Vrbo, Booking.com, Google Vacation Rentals |
| **Notable** | Very transparent pricing. Strong direct booking website builder. US-based. |
| **Integration Partners** | Smart locks (August, RemoteLock), PriceLabs, Wheelhouse |

---

## Feature × Platform Matrix

### Legend

- **Y** = Fully supported via API
- **P** = Partially supported (workaround or limited)
- **N** = Not supported via API
- **W** = Available via webhook (event-driven)

---

### 1. Reservation Sync

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Pull all reservations | Y | Y | Y |
| Real-time new reservation event | Y (webhook) | Y (webhook) | Y (webhook) |
| Reservation modification event | Y (webhook) | P (polling) | Y (webhook) |
| Cancellation event | Y (webhook) | Y (webhook) | Y (webhook) |
| Guest details (name, email, phone) | Y | Y | Y |
| Check-in / check-out times | Y | Y | Y |
| Number of guests | Y | Y | Y |
| Source channel (Airbnb/Vrbo/etc.) | Y | Y | Y |
| **API Endpoint** | `GET /reservations`, `POST /webhooks` | `GET /reservations` | `GET /bookings`, webhooks |
| **Rate Limit** | 100 req/min | 60 req/min | 120 req/min |

**CleverHost Requirement**: Real-time reservation awareness is the foundation. All three platforms deliver this adequately.

---

### 2. Guest Messaging

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Send message to guest | Y | Y | Y |
| Automated message templates | Y | Y (best-in-class) | Y |
| Schedule message at time offset | Y | Y | Y |
| Channel-native messaging (appears in Airbnb inbox) | Y | Y | Y |
| SMS/email fallback | Y | Y (email) | Y (email + SMS) |
| Message status tracking (sent/read) | P (sent only) | P (sent only) | P (sent only) |
| Dynamic variables (guest name, door code, wifi) | Y | Y | Y |
| **API Endpoint** | `POST /reservations/{id}/messages` | `POST /messages` | `POST /bookings/{id}/messages` |
| **Rate Limit** | 60 msg/min | 30 msg/min | 60 msg/min |

**CleverHost Use Case**: Send guest the unique door code, WiFi credentials, and house guide link automatically at check-in time minus 3 hours.

---

### 3. Door Code Generation

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Native smart lock integration | Y (15+ brands) | Y (RemoteLock, Schlage) | Y (August, RemoteLock) |
| Generate time-limited access codes | Y (via lock integration) | P (via RemoteLock only) | P (via August/RemoteLock) |
| Auto-assign code to reservation | Y | P | P |
| Delete code after checkout | Y | P | P |
| Custom code format (length, type) | Y (depends on lock) | P | P |
| **API Endpoint** | `POST /locks/{id}/codes` | Via partner API | Via partner API |
| **Rate Limit** | 30 req/min | N/A (partner) | N/A (partner) |

**CleverHost Architecture**: CleverHost generates codes locally on the Clever Hub and pushes them to the lock via Zigbee/Z-Wave/Thread directly. The PMS integration is for code *communication to the guest* (via messaging), not code generation. This makes us lock-brand-agnostic and eliminates PMS lock integration as a dependency.

---

### 4. WiFi Credential Rotation

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Native WiFi management | N | N | N |
| Guest network SSID/password rotation | N | N | N |
| WiFi credential in guest message template | Y (as variable) | Y (as variable) | Y (as variable) |

**CleverHost Architecture**: WiFi rotation is handled entirely by the Clever Hub interfacing directly with the router (via SNMP, SSH, or manufacturer API — UniFi, Eero, etc.). The PMS only needs to receive the new credentials as template variables to include in guest messaging. This is a CleverHost differentiator — no PMS supports this natively.

---

### 5. Check-in / Check-out Automation

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Check-in time trigger (webhook) | Y | Y | Y |
| Check-out time trigger (webhook) | Y | Y | Y |
| Custom automation rules | Y (Guesty Automation) | Y (rules engine) | P (basic triggers) |
| Integration with external systems | Y (webhook to any URL) | Y (Zapier, webhook) | Y (webhook, Zapier) |
| Guest self-check-in flow | P (via guidebook) | P (via messages) | P (via messages) |
| **API Endpoint** | Webhooks: `reservation.check-in`, `.check-out` | Webhooks on schedule | Webhooks on booking events |
| **Rate Limit** | N/A (push) | N/A (push) | N/A (push) |

**CleverHost Actions on Check-in**:
1. Unlock front door / activate access code
2. Set thermostat to guest-ready temperature
3. Turn on welcome lighting scene
4. Activate guest WiFi with unique credentials
5. Enable voice assistant in "guest mode" with property guide
6. Send welcome message with all access info

**CleverHost Actions on Check-out**:
1. Deactivate access code
2. Reset WiFi credentials
3. Set thermostat to energy-saving mode
4. Wipe voice assistant memory / conversation history
5. Trigger cleaning task dispatch
6. Run "security sweep" scene (all lights on, motion sensors active)

---

### 6. Cleaning Task Dispatch

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Native task management | Y (built-in) | N (partner: TurnoverBnB) | P (basic) |
| Auto-create cleaning task on checkout | Y | N (via Zapier) | P |
| Assign to specific cleaner | Y | N | N |
| Cleaner mobile app | Y (Guesty Operations) | N | N |
| Task status tracking | Y | N | N |
| Integration with TurnoverBnB | Y | Y | Y |
| **API Endpoint** | `POST /tasks`, `GET /tasks` | N/A (partner) | N/A |
| **Rate Limit** | 60 req/min | N/A | N/A |

**CleverHost Architecture**: We will build native cleaning dispatch into CleverHost. On check-out, the system auto-creates a task, notifies the assigned cleaner via SMS/push, and tracks completion. Guesty's task API is the most mature and can be leveraged directly. For Hospitable and OwnerRez, we build our own task engine and use PMS webhooks as triggers.

---

### 7. Guest Profile Creation / Data Wipe

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Guest profile storage | Y | Y | Y |
| Previous stay history | Y | Y | Y |
| Guest preferences | P (custom fields) | N | P (notes) |
| GDPR data deletion | P (manual) | P (manual) | P (manual) |
| Automated data wipe | N | N | N |
| **API Endpoint** | `GET /guests/{id}`, `DELETE /guests/{id}` | `GET /guests` | `GET /guests` |
| **Rate Limit** | 60 req/min | 30 req/min | 60 req/min |

**CleverHost Architecture**: Guest profile creation/wipe is primarily a LOCAL operation on the Clever Hub:
- **Create**: On check-in, create local voice profile, streaming preferences, door access
- **Wipe**: On check-out, purge all local data: voice recordings, browsing history, WiFi credentials, entertainment logins, personal routines
- **PMS sync**: Pull guest name + preferences from PMS to personalize local experience

This is a **major differentiator** — no PMS handles local device data management.

---

### 8. Pricing Optimization

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Built-in dynamic pricing | Y (basic) | N | N |
| PriceLabs integration | Y | Y | Y |
| Beyond Pricing integration | Y | N | Y |
| Wheelhouse integration | Y | N | Y |
| Custom pricing rules | Y | P | Y |
| Minimum stay rules | Y | Y | Y |
| **API Endpoint** | `PUT /listings/{id}/pricing` | N/A (partner) | `PUT /listings/{id}/rates` |
| **Rate Limit** | 30 req/min | N/A | 30 req/min |

**CleverHost Approach**: Pricing optimization is adjacent to our core value prop (physical automation). We will integrate with PriceLabs as our recommended partner and surface pricing insights in the CleverHost dashboard, but not build our own pricing engine.

---

### 9. Review Management

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Auto-submit guest review | Y | Y (best-in-class) | P |
| Review templates | Y | Y | P |
| Review monitoring/alerts | Y | P | N |
| Respond to guest reviews | P (notification only) | P | N |
| **API Endpoint** | Via Airbnb connected API | Built-in automation | N/A |
| **Rate Limit** | Platform-dependent | Platform-dependent | N/A |

**CleverHost Approach**: We can trigger review request reminders via the Clever Hub voice assistant ("How was your stay? Would you like to leave a review?") and feed sentiment data to the PMS review system.

---

### 10. Multi-Property Support

| Capability | Guesty | Hospitable | OwnerRez |
|-----------|--------|------------|----------|
| Multiple listings management | Y (unlimited) | Y (tiered pricing) | Y (unlimited) |
| Portfolio dashboard | Y (best-in-class) | Y | Y |
| Multi-property API access | Y | Y | Y |
| Sub-accounts / team roles | Y | P | P |
| Property grouping | Y | P | P |
| **API Endpoint** | `GET /listings` with filters | `GET /properties` | `GET /listings` |
| **Rate Limit** | 100 req/min | 60 req/min | 120 req/min |

---

## Consolidated Comparison Matrix

| Feature | Guesty | Hospitable | OwnerRez | CleverHost Native |
|---------|--------|------------|----------|-------------------|
| Reservation Sync | A+ | A | A | Via PMS |
| Guest Messaging | A | A+ | A | Via PMS + Hub voice |
| Door Code Generation | A | B | B | A+ (local, lock-agnostic) |
| WiFi Credential Rotation | F | F | F | A+ (unique to us) |
| Check-in/out Automation | A | A | B+ | A+ (physical + digital) |
| Cleaning Task Dispatch | A+ | C (partner) | D | A (built-in) |
| Guest Profile / Data Wipe | C | D | D | A+ (unique to us) |
| Pricing Optimization | B+ (native + partners) | C (partners only) | B (partners) | Via partners |
| Review Management | B+ | A | C | Supplementary |
| Multi-Property Support | A+ | A | A | Via PMS |
| API Quality | A+ | B | A | — |
| Rate Limits | Generous | Moderate | Generous | — |
| Pricing (for host) | $$$ | $$ | $ | — |

---

## API Rate Limit Summary

| Platform | General Rate Limit | Webhook Support | Pagination | Batch Operations |
|----------|-------------------|-----------------|------------|-----------------|
| **Guesty** | 100 req/min (standard); 200 req/min (enterprise) | Yes (comprehensive) | Cursor-based | Yes (bulk updates) |
| **Hospitable** | 60 req/min | Yes (basic) | Offset-based | Limited |
| **OwnerRez** | 120 req/min | Yes (comprehensive) | Offset-based | Limited |

---

## Recommendation: Integration Priority

### Phase 1 (MVP): **OwnerRez**

**Rationale**:
1. **Lowest barrier to entry** — API is well-documented, authentication is simple (API key / Basic Auth), and rate limits are generous.
2. **Best cost/value for our target host** — At $40/mo + $6/property, it is the cheapest PMS. Our target CleverHost early adopters (1-10 properties) will gravitate to affordable solutions.
3. **US-based company** — Easier support alignment and legal framework.
4. **Strong direct booking support** — Hosts who use CleverHost + OwnerRez can reduce Airbnb dependency (aligns with host desire for direct bookings).
5. **Comprehensive API** — Despite being smaller, OwnerRez's API covers all critical endpoints we need.
6. **Technical community** — OwnerRez users tend to be tech-savvy, ideal for early adopter feedback.

### Phase 2: **Guesty**

**Rationale**:
1. **Enterprise-grade** — Once we have product-market fit with solo hosts (OwnerRez), Guesty unlocks professional property managers (5–5,000+ listings).
2. **Best API** — Most comprehensive, best documentation, highest rate limits.
3. **Native task management** — Eliminates our need to build cleaning dispatch from scratch for enterprise users.
4. **Market signal** — Being a Guesty integration partner signals maturity to the market.
5. **Revenue potential** — A single Guesty customer with 500 listings = 500 Clever Hubs.

### Phase 3: **Hospitable**

**Rationale**:
1. **Strong messaging automation** — Hospitable's messaging is best-in-class, and their users highly value automation (= our ideal customer psychographic).
2. **Mid-market bridge** — Fills the gap between OwnerRez solo hosts and Guesty enterprise.
3. **API limitations** — Less comprehensive API means more custom development required.

---

## Technical Architecture: CleverHost ↔ PMS Integration

```
┌─────────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Airbnb / Vrbo /   │◄───►│  PMS Layer   │◄───►│  CleverHost     │
│   Booking.com       │     │  (OwnerRez,  │     │  Cloud API      │
│   (OTA Channels)    │     │   Guesty,    │     │                 │
│                     │     │   Hospitable) │     │  ┌───────────┐  │
└─────────────────────┘     └──────────────┘     │  │ Webhooks  │  │
                                                  │  │ Listener  │  │
                                                  │  └─────┬─────┘  │
                                                  │        │        │
                                                  │  ┌─────▼─────┐  │
                                                  │  │ Automation │  │
                                                  │  │ Engine     │  │
                                                  │  └─────┬─────┘  │
                                                  │        │        │
                                                  └────────┼────────┘
                                                           │
                                                  ┌────────▼────────┐
                                                  │  Clever Hub     │
                                                  │  (Local Device) │
                                                  │                 │
                                                  │  • Door locks   │
                                                  │  • WiFi router  │
                                                  │  • Thermostat   │
                                                  │  • Lights       │
                                                  │  • Voice assist  │
                                                  │  • Guest profile │
                                                  └─────────────────┘
```

### Data Flow: New Reservation

1. Guest books on Airbnb → Airbnb notifies PMS via channel API
2. PMS fires webhook to CleverHost Cloud API: `reservation.created`
3. CleverHost Cloud generates: door code, WiFi credentials, guest profile
4. CleverHost Cloud pushes to Clever Hub (local device): MQTT over TLS
5. CleverHost Cloud pushes door code + WiFi to PMS: message template variables
6. PMS sends guest message at scheduled time (e.g., check-in minus 3 hours)
7. On check-in time: Hub activates welcome scene (lights, AC, unlock)
8. On check-out time: Hub runs wipe sequence, notifies cleaner

---

## API Endpoint Reference (Quick Reference)

### OwnerRez (Phase 1 Target)

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| List bookings | GET | `/api/bookings` | Supports date range filter |
| Get booking detail | GET | `/api/bookings/{id}` | Full guest + property info |
| List properties | GET | `/api/listings` | All properties in account |
| Send message | POST | `/api/bookings/{id}/messages` | Channel-native delivery |
| Update custom field | PUT | `/api/bookings/{id}/custom-fields` | Store door code, WiFi |
| Webhook config | POST | `/api/webhooks` | Subscribe to events |
| Guest info | GET | `/api/guests/{id}` | Name, email, phone |

### Guesty (Phase 2 Target)

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| List reservations | GET | `/v1/reservations` | Extensive filters |
| Get reservation | GET | `/v1/reservations/{id}` | Full detail |
| List listings | GET | `/v1/listings` | Portfolio view |
| Send message | POST | `/v1/reservations/{id}/messages` | Supports all channels |
| Create task | POST | `/v1/tasks` | Cleaning dispatch |
| Update lock code | POST | `/v1/locks/{id}/codes` | Native lock support |
| Configure webhook | POST | `/v1/webhooks` | Comprehensive events |
| Guest profile | GET | `/v1/guests/{id}` | Includes history |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PMS API breaking changes | Medium | High | Abstract PMS layer with adapter pattern; monitor changelogs |
| PMS rate limit throttling during peak (Friday check-ins) | Medium | Medium | Implement queue/retry with exponential backoff; cache reservation data |
| PMS discontinues partner API | Low | Critical | Multi-PMS support from Phase 2; direct OTA integration as backup |
| Airbnb restricts PMS API access | Low | Critical | Diversify to Vrbo/Booking.com; build direct booking channel |
| Webhook delivery failures | Medium | High | Implement polling fallback (every 5 min) alongside webhooks |
| Guest data privacy regulations (CCPA/GDPR) | Medium | High | All guest data encrypted at rest; auto-purge 30 days post-checkout |
