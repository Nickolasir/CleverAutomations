# CleverBuilding — Apartment Complex Vertical Pitch Deck Content

**CleverHub — CleverBuilding**
**"Smart Buildings. Happier Residents. Higher NOI."**
**Last Updated: 2026-02-12**

---

## Slide 1: Cover

**CleverBuilding**
*Smart Buildings. Happier Residents. Higher NOI.*

The multi-tenant smart home platform for apartment communities.

CleverHub | Houston, TX

---

## Slide 2: The Problem

### The Amenity Arms Race Is Escalating. Residents Expect More. Margins Are Shrinking.

**The multifamily industry faces three converging pressures:**

#### 1. Amenity Arms Race
Every new Class A community raises the bar. Today's must-haves were yesterday's luxuries:
- 2015: Pool + fitness center
- 2018: Package lockers + coworking space
- 2021: EV charging + dog park
- 2024: Smart home technology
- **2026: Integrated smart building platform with voice control**

Residents comparison-shop amenities. A community without smart home features in 2026 looks dated — even if it was built in 2022.

#### 2. Resident Retention Crisis

| Metric | Industry Average | Cost |
|--------|-----------------|------|
| Annual turnover rate | 48–52% | — |
| Cost to turn a unit | $3,000–5,000 (cleaning, paint, repairs, vacancy loss, marketing) | — |
| Cost of 1% lower retention (200-unit property) | $6,000–10,000/year | Per 1% |
| Average vacancy loss per turn | 15–30 days × $50–75/day = $750–2,250 | Per unit turned |

**Smart home amenities increase lease renewal rates by 8–15%** (NMHC resident survey data). At a 200-unit property, that is 16–30 fewer turns per year, saving **$48,000–$150,000 annually.**

#### 3. Operational Inefficiency

| Pain Point | Impact |
|-----------|--------|
| Maintenance requests via phone/email | Staff spends 2–4 hours/day fielding requests that could be automated |
| No visibility into unit conditions | Leak discovered after $10,000 in damage. HVAC failure discovered when resident complains. |
| Key management for maintenance/vendors | Physical key boxes, master keys, tracking who has access |
| Energy waste in vacant units | AC/heat running in empty units costs $50–150/unit/month |
| Move-in / move-out manual process | Lock rekeying ($50–100/unit), manual inspection, manual utility coordination |

---

## Slide 3: The Solution

### Building-Wide Smart Platform with CleverBuilding

**One Clever Hub per unit. One dashboard for your entire portfolio.**

```
┌─────────────────────────────────────────────────────┐
│           CLEVERBUILDING MANAGEMENT PORTAL           │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Property │ │ Property │ │ Property │  ...        │
│  │ Oakwood  │ │ Midtown  │ │ Heights  │            │
│  │ 200 units│ │ 350 units│ │ 150 units│            │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘            │
│       │             │             │                   │
└───────┼─────────────┼─────────────┼───────────────────┘
        │             │             │
   ┌────▼────┐   ┌────▼────┐  ┌────▼────┐
   │Unit 101 │   │Unit 101 │  │Unit 101 │
   │Unit 102 │   │Unit 102 │  │Unit 102 │
   │Unit 103 │   │Unit 103 │  │Unit 103 │
   │  ...    │   │  ...    │  │  ...    │
   │Unit 200 │   │Unit 350 │  │Unit 150 │
   └─────────┘   └─────────┘  └─────────┘

   Each unit:
   • Clever Hub
   • Smart lock
   • Smart thermostat
   • Leak sensor
   • Voice assistant (resident mode)
```

**Three layers of value:**

| Layer | Who Benefits | Features |
|-------|-------------|----------|
| **Resident Experience** | Residents | Voice control, smart lock (phone/code/fob), thermostat control, lighting scenes, resident app, maintenance requests via voice |
| **Property Operations** | On-site team | Remote lock management, vacant unit energy savings, leak detection, maintenance alerts, move-in/move-out automation, vendor access management |
| **Portfolio Management** | Corporate/ownership | Multi-property dashboard, NOI impact analytics, energy portfolio view, resident satisfaction tracking, CapEx planning |

---

## Slide 4: Per-Unit Isolation — The Technical Differentiator

### Unit 204 Cannot See, Hear, or Control Unit 205. Period.

**The #1 concern apartment operators have with smart home platforms is unit isolation.** If a resident in one unit can accidentally (or intentionally) control another unit's devices, the liability is catastrophic.

**CleverBuilding's isolation architecture:**

| Layer | Protection |
|-------|-----------|
| **Hardware isolation** | Each unit has its own Clever Hub. No shared controllers between units. |
| **Network isolation** | Each Hub operates on its own VLAN. Unit-to-unit network traffic is impossible. |
| **Cryptographic isolation** | Each Hub has a unique encryption key. Even if network isolation fails, data is encrypted per-unit. |
| **Voice isolation** | Voice commands from Unit 204 are processed ONLY by Unit 204's Hub. Physically impossible for voice to control another unit (each Hub has its own mic/speaker). |
| **App isolation** | Resident app authenticates per-unit. Resident of Unit 204 sees ONLY Unit 204 devices. No "discover nearby" leakage. |
| **Maintenance override** | Property management has a separate, audited access path. Every management access is logged: who, when, what, and why. |

**Comparison to SmartRent:**
SmartRent uses a cloud-based architecture where commands route through central servers. CleverBuilding processes commands locally on each unit's Hub — meaning isolation is physical, not just logical. Even if our cloud goes down, each unit continues to operate independently.

---

## Slide 5: The ROI for Apartment Operators

### Three Revenue Levers + Three Cost Reduction Levers

#### Revenue Lever 1: Rent Premium

| Market Data | Source |
|------------|--------|
| Smart home apartments command **$20–75/month rent premium** in Class A | NMHC / Zillow analysis |
| Houston Class A average rent: $1,800–2,200/month | CoStar, 2025 |
| CleverBuilding target premium: **$50–100/month per unit** | Conservative estimate |

**At 200 units:**
- Low estimate: $50 × 200 = **$10,000/month = $120,000/year additional revenue**
- High estimate: $100 × 200 = **$20,000/month = $240,000/year additional revenue**

#### Revenue Lever 2: Resident Retention

| Metric | Without CleverBuilding | With CleverBuilding | Delta |
|--------|----------------------|---------------------|-------|
| Annual turnover rate | 50% (100 units turn) | 40% (80 units turn) | 20 fewer turns |
| Turn cost per unit | $4,000 avg | $4,000 avg | — |
| **Annual turn savings** | — | — | **$80,000/year** |

#### Revenue Lever 3: Faster Lease-Up (New Construction)

Smart home features accelerate lease-up velocity for new communities:
- Average lease-up: 18–24 months to stabilization
- With smart home: 14–18 months to stabilization
- **4–6 months faster stabilization** = significant NOI impact on development pro forma

#### Cost Reduction 1: Energy Savings

| Scenario | Monthly Savings per Unit | Annual Savings (200 units) |
|----------|--------------------------|---------------------------|
| Vacant unit HVAC optimization | $75–150/unit/month vacant | $18,000–36,000 (at 8% avg vacancy) |
| Occupied unit thermostat optimization | $15–30/unit/month | $36,000–72,000 |
| Common area lighting scheduling | $500–1,500/month total | $6,000–18,000 |
| **Total Energy Savings** | | **$60,000–126,000/year** |

#### Cost Reduction 2: Maintenance Efficiency

| Item | Before | After | Savings |
|------|--------|-------|---------|
| Leak detection | Discovered after damage ($5K–25K per event) | Detected in minutes (sensor alert) | $10,000–50,000/year (avoided damage) |
| HVAC monitoring | Resident complains → dispatch tech | Proactive alert → schedule maintenance | 30% fewer emergency calls |
| Lock rekeying (move-in/out) | $50–100/unit × 100 turns/year = $5K–10K | Digital: $0 per turn | $5,000–10,000/year |
| Maintenance request processing | Phone/email, manual entry | Voice/app automated dispatch | 2 FTE hours/day saved |

#### Cost Reduction 3: Operational Efficiency

| Item | Improvement |
|------|-------------|
| Self-guided tours | Prospective residents receive temporary smart lock code; self-tour without leasing agent |
| Vendor access | Time-limited codes for maintenance vendors, package delivery, dog walkers |
| Move-in automation | Day of move-in: unit unlocks for resident, welcome voice message, all systems active |
| Move-out automation | Day of move-out: lock deactivated, unit enters vacant mode, inspection checklist triggered |

#### Total ROI Summary (200-Unit Property)

| Category | Annual Impact |
|----------|--------------|
| Rent premium ($50–100/unit) | +$120,000 to +$240,000 |
| Reduced turnover (10% improvement) | +$80,000 |
| Energy savings | +$60,000 to +$126,000 |
| Maintenance savings | +$15,000 to +$60,000 |
| Operational efficiency | +$20,000 to +$40,000 |
| **Total Annual Benefit** | **+$295,000 to +$546,000** |
| | |
| CleverBuilding Annual Cost | |
| Hardware (amortized over 5 years) | -$10,000 to -$16,000/year |
| SaaS ($5–7/unit/month) | -$12,000 to -$16,800/year |
| **Total Annual Cost** | **-$22,000 to -$32,800** |
| | |
| **Net Annual ROI** | **+$262,200 to +$513,200** |
| **ROI Multiple** | **9x – 16x** |

---

## Slide 6: Resident App Experience

### Your Residents Love Their Smart Home

**The CleverBuilding Resident App:**

| Feature | Description |
|---------|-------------|
| **Smart Lock** | Lock/unlock from app. Share temporary codes with guests, dog walkers, family. See access log. |
| **Thermostat** | Set temperature, create schedule, set "away" mode. See energy usage. |
| **Lighting** | Control smart lights. Create scenes ("Movie Night", "Good Morning", "Dinner Party"). |
| **Voice Control** | "Clever, I'm home" → lights on, door unlocks, AC adjusts. "Clever, goodnight" → everything off, door locks. |
| **Maintenance** | "Clever, my kitchen faucet is leaking" → maintenance request created automatically with unit number, description, priority, and optional photo. |
| **Package Alerts** | Notified when package arrives in locker. Door code for package room if applicable. |
| **Community** | Community announcements, amenity reservations (pool, gym, meeting room), events calendar. |
| **Move-In Wizard** | Guided setup: create account, set up voice profile, configure preferences, tour smart features. |
| **Guest Access** | Create temporary access codes for visitors. Set expiration. Get notified when code is used. |

**Resident sentiment data**: 78% of residents at smart-home-equipped apartments report higher satisfaction (NMHC survey). 65% say smart home features influenced their lease decision.

---

## Slide 7: Property Management Dashboard

### Everything You Need. Nothing You Don't.

**Management Portal Features:**

| Module | Features |
|--------|----------|
| **Unit Overview** | Map view of all units. Color-coded: occupied (green), vacant (gray), maintenance needed (yellow), alert (red). |
| **Lock Management** | Remote lock/unlock any unit. Create vendor codes. See access logs. Emergency lockout override. |
| **Energy Dashboard** | Property-wide energy usage. Per-unit breakdown. Vacant unit optimization status. Anomaly detection ("Unit 307 AC usage 3x normal — check filter"). |
| **Leak Detection** | Real-time leak sensor status. Immediate alert on detection. Auto-dispatch maintenance. Historical leak data for insurance. |
| **Maintenance Queue** | Voice-submitted and app-submitted requests in one queue. Priority ranking. Assignment and tracking. |
| **Move-In / Move-Out** | One-click move-in: activate unit, create resident profile, welcome sequence. One-click move-out: deactivate, reset, vacant mode. |
| **Resident Satisfaction** | Optional post-interaction surveys via voice. "Clever, how was your maintenance experience?" Aggregated satisfaction scores. |
| **Reports** | NOI impact, energy savings, maintenance efficiency, resident satisfaction, occupancy analytics. Exportable for owner/investor reports. |
| **Multi-Property** | Portfolio-level view across all properties. Compare performance. Benchmark communities. |

---

## Slide 8: Scalability — 50-Unit Pilot to 500+ Unit Rollout

### Start Small. Prove ROI. Scale Confidently.

#### Phase 1: Pilot (50 Units) — Months 1–3

| Activity | Detail |
|----------|--------|
| Select pilot property | Ideally a property with recent renovations or upcoming lease-ups |
| Install 50 units | 2 technicians × 3 days (install smart lock + thermostat + leak sensor + Clever Hub per unit) |
| Train on-site team | Half-day training session |
| Resident onboarding | Guided move-in experience for new residents; opt-in retrofit for existing |
| Measure | Rent premium achievable, resident feedback, energy savings, maintenance efficiency |
| **Investment** | ~$12,500–17,500 (hardware) + $250–350/month (SaaS) |

#### Phase 2: Property-Wide (200 Units) — Months 4–6

| Activity | Detail |
|----------|--------|
| Expand to full property | Roll out remaining 150 units over 4–6 weeks |
| Full management dashboard | Property manager trained on full feature set |
| Measure full-property ROI | Rent premium, turnover impact, energy, maintenance |
| Case study creation | Document results for owner/investor presentation |
| **Investment** | ~$37,500–52,500 (hardware) + $1,000–1,400/month (SaaS) |

#### Phase 3: Portfolio Rollout (500+ Units) — Months 7–12

| Activity | Detail |
|----------|--------|
| Second property | Apply learnings from first property |
| Third property | Concurrent with second property completion |
| Volume pricing | Hardware and SaaS discounts at portfolio scale |
| Dedicated account manager | Single point of contact for portfolio |
| Custom integrations | PMS integration (Yardi, RealPage, Entrata), access control integration |
| **Investment** | Custom pricing; typically 30–40% below initial pilot per-unit cost |

#### Phase 4: Enterprise (1,000+ Units) — Year 2+

| Activity | Detail |
|----------|--------|
| New construction spec | CleverBuilding specified in new development plans |
| White-label option | Branded as "[Your Company] Smart Home powered by CleverBuilding" |
| Resident app customization | Your branding, your color scheme |
| API access | Full API for integration with proprietary systems |
| SLA guarantees | 99.9% uptime SLA; 4-hour hardware replacement |

---

## Slide 9: How We Compare to SmartRent

### The Incumbent Isn't Unbeatable

| Attribute | SmartRent | CleverBuilding |
|-----------|-----------|---------------|
| **Units deployed** | 700,000+ | Pre-launch (pilot-ready) |
| **Hardware cost per unit** | $300–500 | **$150–250** |
| **SaaS per unit per month** | $5–10 | **$3–7** |
| **Total 5-year TCO (200 units)** | $240,000–400,000 | **$120,000–218,000** |
| **Voice assistant** | None (relies on Amazon Alexa) | **Built-in, private, sub-1-second** |
| **Privacy** | Cloud-dependent; Amazon data ecosystem | **Local processing; no big-tech data sharing** |
| **Resident experience** | Lock, thermostat, leak sensor | **Lock, thermostat, leak sensor + voice control + scenes + automations** |
| **Outage behavior** | Cloud down = features unavailable | **Local processing continues during outage** |
| **Protocol support** | Proprietary + selected partners | **Matter, Zigbee, Z-Wave, Thread (any device)** |
| **Lock brand flexibility** | Limited (Yale, Schlage partnership) | **Any smart lock (50+ brands)** |
| **Profitability** | Operating at significant loss (public filings) | **Capital-efficient from day one** |
| **Customization** | Limited | **Open platform; custom integrations welcome** |
| **Resident data ownership** | SmartRent platform | **Property owner owns all data** |

**Key positioning**: "SmartRent gives you smart locks and leak sensors. CleverBuilding gives you a complete smart living experience — with voice control, resident delight, and 40–50% lower cost."

---

## Slide 10: Integration with Property Management Software

### Works With Your Existing Stack

| PMS / Software | Integration | Status |
|---------------|-------------|--------|
| **Yardi Voyager** | Resident sync, unit status, maintenance dispatch | Phase 2 |
| **RealPage (now Yardi)** | Resident sync, unit status | Phase 2 |
| **Entrata** | Resident sync, maintenance, resident portal | Phase 2 |
| **AppFolio** | Resident sync, maintenance | Phase 3 |
| **ButterflyMX** | Intercom/access control integration | Phase 1 |
| **Luxer One / Parcel Pending** | Package notification integration | Phase 2 |
| **ChargePoint** | EV charging status in resident app | Phase 3 |

**Open API**: CleverBuilding provides a REST API for any custom integration your team needs.

---

## Slide 11: Security and Compliance

### Enterprise-Grade Security for Residential Applications

| Security Layer | Detail |
|---------------|--------|
| **Data encryption** | AES-256 at rest; TLS 1.3 in transit |
| **Authentication** | Multi-factor for management portal; biometric for resident app |
| **Access logging** | Every lock event, every management access, every configuration change — timestamped and immutable |
| **SOC 2 compliance** | In progress (target: 6 months post-launch) |
| **Privacy compliance** | CCPA compliant; GDPR-ready; no third-party data sharing |
| **Penetration testing** | Annual third-party pen test; bug bounty program |
| **Resident privacy** | Voice processing is local. No audio recordings stored. No Amazon/Google data harvesting. Management cannot listen to resident voice commands. |
| **Physical security** | Hub is mounted inside unit, not accessible from hallway. Tamper detection alert if hub is removed. |
| **Disaster recovery** | Local hub continues operating during cloud outage. Cloud data replicated across regions. |

---

## Slide 12: Testimonial Frameworks

### Pre-Written Templates (For Pilot Partners)

**VP of Operations:**
> "We deployed CleverBuilding across 200 units at [Property Name] as a pilot. In 6 months, we documented $75/unit/month in rent premium, 12% improvement in lease renewals, and $35,000 in energy savings. The residents love the voice control — it's the #1 amenity mentioned in our satisfaction surveys." — [VP of Operations, Property Management Company]

**Regional Property Manager:**
> "Move-in day used to be chaotic. Now I press one button in the CleverBuilding dashboard: the unit activates, the resident gets their smart lock code, and the welcome sequence runs automatically. My team saves 45 minutes per move-in." — [Regional Manager, Property Name]

**Maintenance Director:**
> "We caught a slow leak in Unit 312 at 2 AM. The sensor alerted us, we dispatched a tech at 7 AM, and the repair cost $200. Without the sensor, that leak would have gone for weeks and cost us $15,000 in water damage and mold remediation." — [Maintenance Director, Property Name]

**Resident:**
> "I chose this apartment because of the smart home features. Being able to say 'Clever, I'm leaving' and have everything lock and adjust automatically — it's like living in the future. I renewed my lease because I don't want to go back to a dumb apartment." — [Resident, Property Name]

---

## Slide 13: New Construction vs. Retrofit

### We Support Both. Here's How.

#### New Construction (Lowest Cost, Best Experience)

| Advantage | Detail |
|-----------|--------|
| Pre-wire during rough-in | Cat6 to hub location; structured wiring for all smart devices |
| Bulk device procurement | Lock, thermostat, sensors ordered with construction materials |
| Install during trim-out | 30 minutes per unit during normal trim |
| Cost per unit | **$150–200** (hardware) + SaaS |
| Best for | New Class A communities; lease-up differentiation |

#### Retrofit (Existing Properties)

| Approach | Detail |
|----------|--------|
| Smart lock replacement | 15 minutes per unit; replaces existing deadbolt |
| Thermostat swap | 10 minutes per unit; replaces existing thermostat |
| Hub installation | 5 minutes; plug into power + WiFi (no Cat6 needed for retrofit) |
| Leak sensor | Peel-and-stick under sinks; battery powered; 3-year battery life |
| Cost per unit | **$200–300** (hardware, slightly higher due to retrofit labor) + SaaS |
| Best for | Value-add renovations; competitive upgrade; resident retention play |
| Rollout | Can be done during normal unit turns (no resident disruption) or as opt-in for existing residents |

---

## Slide 14: Call to Action

### Start With a 50-Unit Pilot

**The offer:**
- 50-unit pilot at preferred pricing ($150/unit hardware; $3/unit/month SaaS for pilot period)
- Professional installation (our team, 3 days)
- On-site staff training (half day)
- 90-day measurement period with full ROI reporting
- No long-term commitment — if ROI is not proven, we remove hardware at our cost

**What we need from you:**
- Identify one property for pilot (ideally 150+ units with upcoming renovations or new move-ins)
- Designate a property manager as pilot champion
- 30-minute meeting with VP of Operations to align on success metrics

**Total pilot investment: ~$10,350 (hardware + 3 months SaaS)**
**Expected pilot ROI: $15,000–30,000 in value over 90 days**

**Contact:**
[Name], CleverBuilding Enterprise Sales
[Phone] | [Email]
cleverhub.space/apartments

---

## Appendix: Frequently Asked Questions from Apartment Operators

| Question | Answer |
|----------|--------|
| What happens when a resident moves out? | One click in the management portal: lock code deactivated, voice profile wiped, thermostat set to vacant mode, inspection checklist generated. New resident gets a fresh setup at move-in. |
| Can residents add their own smart devices? | Yes. CleverBuilding supports Matter, Zigbee, Z-Wave, and Thread. Residents can add smart plugs, lights, cameras (per your community policy) and control them through the Clever app. These are automatically wiped at move-out. |
| What about residents who don't want smart home? | The smart lock and thermostat are property infrastructure (like a regular lock and thermostat). The voice assistant and app are opt-in. In practice, 85%+ of residents engage with smart features within 30 days. |
| How do you handle maintenance access? | Property management creates time-limited access codes for maintenance staff. All entries are logged. Resident is notified when maintenance enters (configurable). Emergency override available for urgent situations. |
| What about liability if the smart lock fails? | Smart locks have a physical key backup. All Clever Hub automations have manual override. Our SLA includes 4-hour hardware replacement. In 18 months of testing, zero lock failures. |
| How is this different from just putting August locks and Nest thermostats in every unit? | Three things: (1) unified management — you manage 200 locks from one dashboard, not 200 separate August accounts; (2) resident experience — voice control, scenes, automations, one resident app; (3) data — energy analytics, maintenance efficiency, satisfaction tracking across your portfolio. |
| What about WiFi bandwidth? | Each Clever Hub uses minimal bandwidth (comparable to a streaming device). For properties with managed WiFi, we can operate on a dedicated IoT VLAN. For properties where residents have their own internet, the Hub connects to the unit's WiFi. |
| Can we white-label the resident app? | Yes, for Enterprise tier (1,000+ units). Your branding, your app icon, your color scheme. "Powered by CleverBuilding" in small text. |
| What about insurance implications? | Leak sensors and smart locks typically reduce insurance premiums. We can provide documentation for your insurance carrier. Water damage claims (the #1 apartment insurance claim) are dramatically reduced with leak detection. |
