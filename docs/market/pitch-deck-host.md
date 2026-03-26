# CleverHost — Airbnb/STR Host Vertical Pitch Deck Content

**CleverHub — CleverHost**
**"Automate Your Guest Experience. Reclaim Your Time."**
**Last Updated: 2026-02-12**

---

## Slide 1: Cover

**CleverHost**
*Automate Your Guest Experience. Reclaim Your Time.*

The smart home platform purpose-built for short-term rental hosts.

CleverHub | Houston, TX

---

## Slide 2: The Problem

### Guest Turnover Is Manual, Risky, and Unscalable

**Every guest check-in and check-out costs you time, money, and peace of mind.**

| Pain Point | Reality |
|-----------|---------|
| **Key/code management** | Manually changing door codes for every guest. Forgetting means security risk. Physical keys get lost, copied, or not returned. |
| **WiFi credentials** | Guests share your WiFi password publicly. Previous guests still have access. No way to rotate automatically. |
| **No personalization** | Guest walks into a cold, dark house with no welcome. Feels like a hotel, not a "home." |
| **Cleaning coordination** | Texting your cleaner after every checkout. Miscommunication = dirty property for next guest. 1-star review. |
| **Security gaps** | Previous guest data on smart TV. Netflix still logged in. Alexa history from last guest. Smart speaker recorded private conversations. |
| **Energy waste** | AC running at 68 between guests. Lights left on. Water running. Costs $200–500/mo in an empty property. |
| **Time sink** | Average host spends **8–12 hours per week** on guest turnover tasks for a single property. For 5+ properties, it is a full-time job. |
| **Scaling wall** | Hosts hit a wall at 3–5 properties. The manual work does not scale. Hiring a property manager costs 20–30% of revenue. |

**The average Houston Airbnb host earns $35,000–65,000/year per property but spends 15–25% of gross on turnover-related costs and labor.**

---

## Slide 3: The Solution

### Automated Guest Lifecycle with CleverHost

**One Clever Hub per property. Complete guest automation.**

```
BOOKING           PRE-CHECK-IN       CHECK-IN          DURING STAY
────────          ─────────────      ─────────         ────────────
PMS detects       3 hrs before:      At check-in       Voice assistant
new reservation   • Generate         time:              in "guest mode":
                    unique door      • Unlock door      • Property guide
CleverHost          code             • Welcome          • Local recs
receives          • Rotate WiFi       lighting on      • Service requests
guest details       credentials     • AC set to 72     • Emergency info
                  • Send guest      • Voice: "Welcome
Auto-creates:       all access        to [Property],   Clever monitors:
• Door code         info via PMS      [Guest Name]!"   • Energy usage
• WiFi creds                                           • Noise levels
• Guest profile                                        • Occupancy


CHECK-OUT          POST-CHECKOUT     BETWEEN GUESTS    NEXT GUEST
─────────          ──────────────    ──────────────    ──────────
At check-out       Automatic:        Hub enters        Cycle repeats
time:              • Deactivate      "vacant mode":    automatically
• Door code          door code       • AC to 78
  deactivated      • Wipe WiFi       • Lights off      Zero manual
• Voice assistant    credentials      • Motion alerts     intervention
  wiped            • Clear voice       active
• Smart TV           history         • Leak monitoring
  logged out       • Log out all
• Cleaning task      streaming
  dispatched       • Notify
  to cleaner         cleaner
```

---

## Slide 4: Feature Deep Dive

### Every Feature Exists to Save You Time or Make You Money

#### Auto Door Codes

| Feature | Detail |
|---------|--------|
| **How it works** | CleverHost generates a unique, time-limited door code for each guest. Code activates at check-in time, deactivates at check-out time. |
| **Lock compatibility** | Any Zigbee, Z-Wave, or Thread smart lock: Schlage Encode, Yale Assure, Kwikset Halo, August, and 50+ more |
| **Code format** | Configurable: 4-digit, 6-digit, or alphanumeric. Optional: last 4 digits of guest phone number for easy recall. |
| **Guest notification** | Code automatically sent to guest via PMS messaging (appears in Airbnb inbox) at configurable time before check-in. |
| **Cleaner codes** | Separate persistent code for your cleaning team. Can be time-restricted (e.g., only works 10am–4pm). |
| **Emergency codes** | Master code for owner. Never changes. Never shared. |
| **Locksmith savings** | Eliminates $100–200/year in locksmith calls for rekeying or lockout situations. |

#### WiFi Credential Rotation

| Feature | Detail |
|---------|--------|
| **How it works** | CleverHost creates a unique guest WiFi network (or rotates the password on existing guest network) for each reservation. |
| **Router compatibility** | UniFi, Eero, Netgear, TP-Link, Asus — most consumer and prosumer routers with API or SSH access. |
| **Why it matters** | Previous guests can no longer access your network. Eliminates bandwidth theft. Prevents unauthorized device connections. |
| **Guest notification** | WiFi name + password sent to guest in same message as door code. |
| **Unique to CleverHost** | No other smart home platform or PMS offers automatic WiFi rotation. This is a CleverHost exclusive. |

#### Complete Data Wipe

| Feature | Detail |
|---------|--------|
| **What gets wiped** | Voice assistant memory (all conversations, routines, preferences), smart TV logins (Netflix, Hulu, YouTube, etc.), browsing history, saved WiFi credentials on guest devices, any personal routines created during stay |
| **How it works** | On check-out trigger, Clever Hub executes factory reset on voice profile, sends CEC commands to reset smart TV, rotates WiFi to disconnect all guest devices |
| **Why it matters** | Privacy liability. If Guest B sees Guest A's Netflix history or hears Guest A's Alexa recordings, it is a PR nightmare and potential legal issue. |
| **Unique to CleverHost** | No other platform automates full data wipe across all smart devices in the property. |

#### Voice Assistant for Guests

| Feature | Detail |
|---------|--------|
| **Guest mode** | Limited voice profile: can control lights, AC, and ask property questions. Cannot access owner settings, security cameras, or automation rules. |
| **Property guide** | "Clever, where is the nearest grocery store?" → Custom answers from your property guide. "Clever, what's the WiFi password?" → Reads current guest WiFi credentials. |
| **Emergency info** | "Clever, emergency" → Displays/reads property address, nearest hospital, emergency contacts, exit routes. |
| **House rules** | "Clever, what are the house rules?" → Reads your house rules: quiet hours, parking, trash day, pool rules. |
| **Local recommendations** | "Clever, recommend a restaurant" → Your curated list of local restaurants, bars, attractions. |
| **Concierge requests** | "Clever, I need more towels" → Sends notification to host/manager. |
| **Language support** | Multi-language voice support for international guests. |

#### Cleaning Task Dispatch

| Feature | Detail |
|---------|--------|
| **Trigger** | Automatic on check-out time (or when motion sensor confirms guest departure). |
| **Notification** | SMS + app notification to assigned cleaner with property address, access code, and cleaning checklist. |
| **Checklist** | Customizable per property: standard clean, deep clean, linen change, supply restock. |
| **Confirmation** | Cleaner marks task complete in app. Host receives confirmation. Optional photo verification. |
| **Back-to-back** | For same-day turnovers, system calculates cleaner arrival time and alerts if turnover window is tight. |

#### Energy Management

| Feature | Detail |
|---------|--------|
| **Occupied mode** | Guest comfort settings: AC at guest-preferred temperature, lights available. |
| **Vacant mode** | Between guests: AC at 78F (Houston summer) / 62F (winter), all lights off, smart plugs off. |
| **Smart scheduling** | AC pre-cools 2 hours before next check-in so property is comfortable on arrival. |
| **Savings estimate** | $150–400/month savings per property in Houston (high AC costs, especially June–September). |

#### Noise Monitoring

| Feature | Detail |
|---------|--------|
| **How it works** | Ambient noise level sensor (does NOT record audio or conversations — privacy safe). |
| **Threshold alerts** | Configurable: "Alert me if noise exceeds 80dB for more than 10 minutes between 10pm–8am." |
| **Why it matters** | Party prevention. Neighbor complaint prevention. HOA violation prevention. |
| **Integration** | Works with NoiseAware protocol. Clip-on sensor, no installation. |

---

## Slide 5: The ROI

### Time Saved + Costs Reduced + Revenue Increased

#### Time Savings Per Turnover

| Task | Manual Time | With CleverHost | Saved |
|------|------------|-----------------|-------|
| Change door code | 5–15 min | Automatic | 5–15 min |
| Send guest access info | 10–20 min (compose, proofread, send) | Automatic | 10–20 min |
| Coordinate cleaner | 5–10 min (text, confirm, follow up) | Automatic | 5–10 min |
| Reset WiFi password | 5–10 min (log into router, change, update listing) | Automatic | 5–10 min |
| Log out streaming accounts | 5–10 min (per TV, per account) | Automatic | 5–10 min |
| Adjust thermostat | 2–5 min (drive to property or app per device) | Automatic | 2–5 min |
| **Total per turnover** | **32–70 min** | **0 min** | **32–70 min** |

**At 15 turnovers/month (typical Houston Airbnb):**
- **8–17.5 hours saved per month per property**
- At $50/hr host time value: **$400–875 saved per month per property**

#### Cost Savings

| Item | Annual Cost Without CleverHost | Annual Cost With CleverHost | Savings |
|------|-------------------------------|----------------------------|---------|
| Locksmith / rekeying | $100–200 | $0 | $100–200 |
| Energy (vacant property) | $2,400–4,800 | $1,200–2,400 | $1,200–2,400 |
| Property manager (if applicable) | $7,000–15,000 (20–25% of revenue) | $0 (self-managed with automation) | $7,000–15,000 |
| Guest complaints / refunds due to issues | $500–2,000 | $100–500 (fewer issues) | $400–1,500 |
| **Total Annual Savings** | | | **$8,700–19,100** |

#### Revenue Increase

| Item | Impact |
|------|--------|
| Higher guest reviews (better experience) | +0.2–0.5 star average → 5–15% more bookings |
| "Smart Home" listing differentiation | 10–20% more listing views in competitive markets |
| Faster turnovers (same-day possible) | 1–3 additional bookings per month |
| Premium pricing (smart home listing) | $10–25/night premium |
| **Additional Annual Revenue** | **$3,000–12,000 per property** |

#### Net ROI Summary

| | Per Property / Year |
|--|-------------------|
| CleverHost cost (hardware + SaaS) | -$1,020 to -$1,800 |
| Time savings value | +$4,800 to +$10,500 |
| Cost savings | +$8,700 to +$19,100 |
| Revenue increase | +$3,000 to +$12,000 |
| **Net Annual ROI** | **+$15,480 to +$39,800** |
| **ROI multiple** | **8.6x to 22.1x** |

---

## Slide 6: How It Connects to Your PMS

### Works With Your Existing Workflow

CleverHost integrates with your existing Property Management System (PMS). No need to switch tools or change your workflow.

| PMS Platform | Integration Status | Notes |
|-------------|-------------------|-------|
| **OwnerRez** | Launch Partner (Phase 1) | Full API integration: reservations, messaging, custom fields |
| **Guesty** | Phase 2 | Enterprise-grade: reservations, tasks, lock codes, messaging |
| **Hospitable** | Phase 3 | Automation-focused: messaging, reservation sync |
| **Direct Booking** | Phase 1 | Manual reservation entry or calendar sync for non-PMS hosts |

**How the integration works:**

1. Connect your PMS account to CleverHost (one-time, 5 minutes)
2. CleverHost receives reservation data automatically via webhooks
3. CleverHost generates door codes and WiFi credentials
4. CleverHost pushes access info back to PMS as message template variables
5. PMS sends guest the info on your schedule (e.g., 3 hours before check-in)
6. At check-in: Clever Hub activates welcome sequence
7. At check-out: Clever Hub runs wipe + cleaning dispatch

**You do not change your workflow. You just stop doing the manual parts.**

---

## Slide 7: Pricing

### Simple, Predictable Pricing That Scales With You

#### Solo Host (1 Property)

| Item | Cost |
|------|------|
| Clever Hub hardware | $199 (one-time) |
| Smart lock (if needed) | $200–300 (one-time, your choice of brand) |
| Smart thermostat (if needed) | $120 (one-time, your choice of brand) |
| **CleverHost SaaS** | **$29/month** |
| | |
| **Includes:** | Guest lifecycle automation, door code generation, WiFi rotation, data wipe, energy management, voice assistant (guest mode), cleaning dispatch, noise monitoring, dashboard, mobile app, 24/7 support |

#### Growing Host (2–5 Properties)

| Item | Cost |
|------|------|
| Clever Hub hardware | $179 each (one-time; 10% volume discount) |
| **CleverHost SaaS** | **$24/month per property** ($120/mo for 5 properties) |
| | |
| **Additional features:** | Multi-property dashboard, portfolio analytics, cleaner team management, bulk messaging |

#### Professional Host (6–10 Properties)

| Item | Cost |
|------|------|
| Clever Hub hardware | $159 each (one-time; 20% volume discount) |
| **CleverHost SaaS** | **$19/month per property** ($190/mo for 10 properties) |
| | |
| **Additional features:** | Priority support, dedicated onboarding specialist, custom automations, API access |

#### Portfolio Host (11+ Properties)

| Item | Cost |
|------|------|
| Clever Hub hardware | Custom pricing |
| **CleverHost SaaS** | **$14/month per property** (negotiable at scale) |
| | |
| **Additional features:** | White-label option, dedicated account manager, SLA guarantees, custom integrations |

### Pricing Comparison

| Solution | Monthly Cost (per property) | What You Get |
|----------|---------------------------|-------------|
| Property Manager | $583–1,250/mo (20–25% of $35K–60K revenue) | Human coordination of everything |
| CleverHost Solo | $29/mo | Full automation of guest lifecycle |
| Hospitable (PMS only) | $25–40/mo | Messaging automation only (no physical devices) |
| SmartThings + Schlage + manual | $0–5/mo | DIY headache, no automation, no guest lifecycle |
| Ring + Nest + manual | $13–23/mo (subscriptions) | Camera alerts, thermostat control, still manual everything else |

**CleverHost is 5–10% the cost of a property manager and automates 90% of what they do.**

---

## Slide 8: Guest Experience

### 5-Star Reviews Start With a 5-Star Arrival

**What your guest experiences:**

**3 Hours Before Check-in:**
> Guest receives Airbnb message: "Welcome, Sarah! Your home is ready. Here's everything you need..."
> - Door code: 4829 (active from 4:00 PM today until 11:00 AM Saturday)
> - WiFi: "GuestNet-Maple" / Password: "sunshine2847"
> - Parking: Driveway, pull all the way up
> - House guide: [link]

**At Check-in (4:00 PM):**
> Sarah enters door code. Door unlocks. She walks in.
>
> The home is cool (AC has been running for 2 hours). Living room lights are on at a warm glow.
>
> Voice: "Welcome to the Maple Street house, Sarah. I'm Clever, your home assistant. The WiFi password is sunshine-two-eight-four-seven. Say 'Clever, help' anytime you need something."
>
> Sarah: "Clever, where's the nearest coffee shop?"
> Clever: "The nearest highly-rated coffee shop is Catalina Coffee, 0.8 miles south on Washington Ave. They close at 6 PM today."

**During Stay:**
> "Clever, set the AC to 70."
> "Clever, turn off the bedroom lights."
> "Clever, what's the WiFi password?" (she forgot)
> "Clever, what time is checkout?"

**At Check-out (11:00 AM Saturday):**
> Sarah leaves. Door code stops working. Within 60 seconds:
> - WiFi credentials rotated
> - Voice assistant memory wiped
> - Smart TV logged out of all accounts
> - Thermostat set to 78 (energy saving)
> - Cleaner notified: "Maple Street ready for turnover. Code: 1234 (active until 4 PM)"

**Result: 5-star review. "The smart home features were incredible. Everything was so easy."**

---

## Slide 9: Houston Market Opportunity

### Why Houston Is the Best Market for CleverHost

| Factor | Houston Detail |
|--------|---------------|
| **Active Airbnb/STR listings** | 15,000+ in Greater Houston |
| **Average nightly rate** | $125–175 (varies by area) |
| **Average occupancy** | 55–70% |
| **Annual revenue per listing** | $25,000–65,000 |
| **Regulation** | Houston has NO short-term rental registration requirement (as of 2025). Host-friendly. |
| **Tourism drivers** | NASA/Space Center, Medical Center, Rodeo (March), sports (Texans, Astros, Rockets, Dynamo), conventions (GRB), energy industry business travel |
| **Growth** | Houston STR market growing 12–18% annually |
| **Key neighborhoods** | Heights, Montrose, Midtown, EaDo, Galleria, Medical Center, Clear Lake, The Woodlands |
| **Seasonality** | Rodeo season (Feb–March), summer family travel, fall business travel. Less seasonal than coastal markets. |
| **Host demographics** | Mix of solo hosts (1–3 properties), growing cohort of "accidental landlords" converting to STR, and professional operators (10+ properties) |

**Houston STR total addressable market for CleverHost: $3.5M–5.5M ARR** (at 15–25% market penetration over 3 years)

---

## Slide 10: Competitive Landscape

### Nobody Does What CleverHost Does

| Feature | CleverHost | Hospitable | Guesty | Ring + Manual | Property Manager |
|---------|-----------|------------|--------|-------------|-----------------|
| Auto door codes | Yes | Via partner | Via partner | No | Manual |
| WiFi rotation | **Yes (unique)** | No | No | No | No |
| Complete data wipe | **Yes (unique)** | No | No | No | Manual (unreliable) |
| Voice assistant (guest) | **Yes (unique)** | No | No | Alexa (privacy risk) | No |
| Cleaning dispatch | Yes | Via partner | Yes | No | Yes |
| Energy management | Yes | No | No | Thermostat only | No |
| Noise monitoring | Yes | No | No | No | Sometimes |
| Guest messaging | Via PMS | Yes (best) | Yes | No | Yes |
| Pricing optimization | Via partner | Via partner | Yes | No | Yes |
| Physical device control | **Yes** | No | No | Partial | No |
| **Monthly cost** | **$19–29** | $25–40 | $15–30/listing (%) | $0–23 | $583–1,250 |

**CleverHost is the only solution that combines physical smart home automation with digital guest lifecycle management.**

---

## Slide 11: Getting Started

### Up and Running in Under an Hour

| Step | Time | What Happens |
|------|------|-------------|
| 1. Order Clever Hub | 2 min | Order online. Ships in 2 business days. |
| 2. Install Hub | 15 min | Plug into power + ethernet (or WiFi). Mount on wall or place on shelf. |
| 3. Install smart lock | 20 min | Replace existing deadbolt with smart lock. Screwdriver only. |
| 4. Connect PMS | 5 min | Enter PMS API key in CleverHost app. |
| 5. Configure | 10 min | Set check-in/out times, customize guest message, set up cleaner. |
| 6. Done | — | Next reservation is fully automated. |

**Total setup time: ~52 minutes. One time.**

No electrician. No contractor. No drilling. No wiring. If you can replace a deadbolt and plug in a router, you can install CleverHost.

---

## Slide 12: Testimonial Frameworks

### Pre-Written Testimonial Templates (For Early Adopters)

**Solo Host (1 property):**
> "I was spending 2 hours every turnover day managing codes, texting my cleaner, and driving to the property to check the thermostat. Now I don't even think about it. CleverHost handles everything. My reviews went from 4.6 to 4.9 in two months." — [Host Name, Heights Area]

**Multi-Property Host (5 properties):**
> "I was about to hire a property manager at 25% of my revenue. That's $40,000 a year. Instead, I got CleverHost for $1,440 a year. It automates 90% of what a property manager does. I kept the other $38,560." — [Host Name, Montrose]

**Professional Host (10+ properties):**
> "WiFi rotation alone was worth the price. I had a previous guest use 500GB of bandwidth torrenting because they still had my WiFi password. With CleverHost, every guest gets a unique password that expires at checkout." — [Host Name, Galleria Area]

**Guest Review (on Airbnb listing):**
> "The smart home was amazing! When we walked in, the house welcomed us by name, the AC was perfect, and the voice assistant knew everything about the neighborhood. This was so much better than a hotel. 10/10 would stay again." — [Guest Review]

---

## Slide 13: Roadmap

### What's Coming Next

| Timeline | Feature | Benefit |
|----------|---------|---------|
| **Now** | Core automation (door codes, WiFi, data wipe, energy, cleaning dispatch) | Full guest lifecycle automation |
| **Q2 2026** | Noise monitoring integration | Party prevention, neighbor peace |
| **Q3 2026** | Multi-language voice assistant | International guest support |
| **Q4 2026** | Revenue analytics dashboard | Track revenue per property, per season, per listing platform |
| **Q1 2027** | Direct booking website integration | Reduce Airbnb dependency; keep 100% of revenue |
| **Q2 2027** | Dynamic pricing advisor | AI-powered pricing suggestions based on local events, weather, competition |
| **2027+** | Guest loyalty program | Repeat guest recognition across CleverHost properties |

---

## Slide 14: Call to Action

### Try CleverHost Free for 30 Days

**The offer:**
- One Clever Hub at cost ($199) — fully refundable if returned within 30 days
- 30 days of CleverHost SaaS free
- Guided setup call (30 minutes, 1-on-1)
- If your reviews don't improve and your turnover time doesn't drop, return it for a full refund

**Who this is perfect for:**
- Houston Airbnb hosts spending too much time on turnover
- Hosts considering hiring a property manager (try this first — save $40K/year)
- Hosts with 2+ properties who hit the "scaling wall"
- Hosts who care about guest privacy and experience

**Contact:**
[Name], CleverHost
[Phone] | [Email]
cleverhub.space/hosts

---

## Appendix: Frequently Asked Questions from Hosts

| Question | Answer |
|----------|--------|
| Does it work with Airbnb directly? | CleverHost integrates through your PMS (OwnerRez, Guesty, Hospitable). The PMS connects to Airbnb, Vrbo, Booking.com, and direct bookings. Airbnb does not offer direct API access to individual hosts. |
| What if my internet goes out? | Core smart home functions (door lock, lights, thermostat) work locally without internet. Guest will lose voice assistant and remote access. Internet outages in Houston are rare but we have fallback handling. |
| Do I need to replace my locks? | If you have a compatible smart lock (Schlage, Yale, Kwikset, August with Zigbee/Z-Wave), no. If you have a traditional deadbolt, yes — you will need to upgrade to a smart lock ($150–300). This is a one-time cost. |
| Is the voice assistant always listening? | The voice assistant activates on a wake word ("Clever") or optional proximity detection. It processes speech locally on the device — no audio is sent to the cloud, Amazon, or Google. This is a major privacy advantage. |
| What about guest privacy laws? | CleverHost does NOT record audio or video inside the property. Noise monitoring measures decibel levels only, not conversations. All smart devices comply with Airbnb's recording device policy. |
| Can guests mess with my settings? | Guest mode is sandboxed. Guests can control lights, AC (within your set range), and ask questions. They cannot access cameras, security settings, automation rules, or owner controls. |
| What happens if a guest overstays? | Door code deactivates at checkout time. Guest is locked out. You receive an alert. You can remotely extend the code if you choose to allow a late checkout. |
| Do I need a specific router? | CleverHost works best with UniFi, Eero, or Netgear routers that support guest network management via API. For WiFi rotation on other routers, we support SSH/SNMP configuration. We can recommend a compatible router ($80–150) if yours is not supported. |
