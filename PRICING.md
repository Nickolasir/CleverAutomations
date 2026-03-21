# CleverHub Standard System — Bill of Materials & Ordering Guide

**Retail Price: $2,500.00** (one-time) + $100/mo cloud AI features

---

## Main Hub

| # | Component | Part | Qty | Est. Unit Cost | Order Link |
|---|-----------|------|-----|---------------|------------|
| 1 | Single-board computer | Raspberry Pi 5 (8GB) | 1 | $80.00 | [Raspberry Pi](https://www.raspberrypi.com/products/raspberry-pi-5/) \| [PiShop](https://www.pishop.us/product/raspberry-pi-5-8gb/) \| [CanaKit](https://www.canakit.com/raspberry-pi-5-8gb.html) |
| 2 | AI accelerator | Raspberry Pi AI HAT+ 2 (Hailo-10H, 40 TOPS) | 1 | $130.00 | [Raspberry Pi](https://www.raspberrypi.com/products/ai-hat-plus-2/) \| [PiShop](https://www.pishop.us/product/raspberry-pi-ai-hat-2/) |
| 3 | MEMS microphone | INMP441 I2S breakout | 1 | $1.50 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=INMP441+I2S) \| [Amazon](https://www.amazon.com/s?k=INMP441+I2S+microphone) |
| 4 | Audio amplifier | MAX98357A I2S amp module | 1 | $2.00 | [Adafruit](https://www.adafruit.com/product/3006) \| [AliExpress](https://www.aliexpress.com/wholesale?SearchText=MAX98357A+I2S) |
| 5 | Speaker | 40mm 4-ohm 3W driver | 1 | $0.50 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=40mm+3W+4ohm+speaker) \| [Amazon](https://www.amazon.com/s?k=40mm+3W+4+ohm+speaker) |
| 6 | Temp/humidity sensor | Sensirion SHT40 I2C module | 1 | $2.00 | [Adafruit](https://www.adafruit.com/product/4885) \| [DigiKey](https://www.digikey.com/en/products/filter/humidity-moisture-sensors/529?s=sht40) \| [Mouser](https://www.mouser.com/c/?q=sht40) |
| 7 | Ambient light sensor | BH1750 I2C module | 1 | $0.40 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=BH1750+light+sensor) \| [Amazon](https://www.amazon.com/s?k=BH1750+light+sensor+module) |
| 8 | mmWave presence sensor | HLK-LD2410C 24GHz | 1 | $2.75 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=LD2410C) \| [Amazon](https://www.amazon.com/s?k=HLK-LD2410C) |
| 9 | Air quality / VOC sensor | ScioSense ENS160 I2C module | 1 | $3.00 | [Adafruit](https://www.adafruit.com/product/5606) \| [SparkFun](https://www.sparkfun.com/products/20844) \| [DigiKey](https://www.digikey.com/en/products/filter/gas-sensors/535?s=ens160) |
| 10 | NFC reader | PN532 NFC/RFID module (I2C/SPI) | 1 | $4.00 | [Adafruit](https://www.adafruit.com/product/364) \| [AliExpress](https://www.aliexpress.com/wholesale?SearchText=PN532+NFC+module) |
| 11 | IR blaster + receiver | IR LED + TSOP38238 | 1 | $0.20 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=IR+LED+TSOP38238) \| [DigiKey](https://www.digikey.com/en/products/detail/vishay/TSOP38238/1768188) |
| 12 | RGB status LED | WS2812B (NeoPixel) | 1 | $0.08 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=WS2812B+LED) \| [Adafruit](https://www.adafruit.com/product/1655) |
| 13 | Power supply | USB-C 27W (5.1V/5A) for Pi 5 | 1 | $11.00 | [Raspberry Pi](https://www.raspberrypi.com/products/27w-power-supply/) \| [CanaKit](https://www.canakit.com/official-raspberry-pi-5-power-supply-27w-usb-c.html) |
| 14 | Enclosure | Custom injection molded ABS (2-piece) | 1 | $7.50* | Custom — see notes below |
| | | | | | |
| | **Hub subtotal** | | | **~$245** | |

> \* Enclosure cost amortized over 1,000 units. Tooling is $3,000–$5,000 one-time.

### Hub Specs Summary

- **Compute:** Raspberry Pi 5 (8GB RAM, quad-core Cortex-A76 @ 2.4GHz)
- **AI:** Hailo-10H via AI HAT+ 2 — 40 TOPS INT4 inference, 8GB dedicated LPDDR4X
- **Audio:** I2S MEMS mic (INMP441) + I2S amplifier (MAX98357A) + 3W speaker
- **Sensors:** Temperature/humidity (SHT40), ambient light (BH1750), mmWave presence (LD2410C), air quality/VOC (ENS160)
- **Connectivity:** WiFi 5 (802.11ac dual-band), Bluetooth 5.0/BLE, NFC (PN532), IR blaster
- **Indicators:** WS2812B addressable RGB LED
- **Power:** 27W USB-C

---

## Satellite Node (x4 per standard system)

| # | Component | Part | Qty/Node | Est. Unit Cost | Order Link |
|---|-----------|------|----------|---------------|------------|
| 1 | Microcontroller | ESP32-S3-MINI module | 1 | $3.00 | [DigiKey](https://www.digikey.com/en/products/filter/rf-modules/867?s=ESP32-S3-MINI) \| [LCSC](https://www.lcsc.com/search?q=ESP32-S3-MINI) \| [Mouser](https://www.mouser.com/c/?q=ESP32-S3-MINI) |
| 2 | MEMS microphone | INMP441 I2S breakout | 1 | $1.50 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=INMP441+I2S) \| [Amazon](https://www.amazon.com/s?k=INMP441+I2S+microphone) |
| 3 | Audio amplifier | MAX98357A I2S amp module | 1 | $2.00 | [Adafruit](https://www.adafruit.com/product/3006) \| [AliExpress](https://www.aliexpress.com/wholesale?SearchText=MAX98357A+I2S) |
| 4 | Speaker | 28mm 4-ohm 2W driver | 1 | $0.40 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=28mm+2W+4ohm+speaker) |
| 5 | Temp/humidity sensor | Sensirion SHT40 I2C | 1 | $1.25 | [Adafruit](https://www.adafruit.com/product/4885) \| [DigiKey](https://www.digikey.com/en/products/filter/humidity-moisture-sensors/529?s=sht40) |
| 6 | Ambient light sensor | BH1750 I2C module | 1 | $0.40 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=BH1750+light+sensor) |
| 7 | mmWave presence sensor | HLK-LD2410C 24GHz | 1 | $2.75 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=LD2410C) \| [Amazon](https://www.amazon.com/s?k=HLK-LD2410C) |
| 8 | Air quality / VOC sensor | ScioSense ENS160 I2C | 1 | $3.00 | [Adafruit](https://www.adafruit.com/product/5606) \| [DigiKey](https://www.digikey.com/en/products/filter/gas-sensors/535?s=ens160) |
| 9 | IR blaster + receiver | IR LED + TSOP38238 | 1 | $0.20 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=IR+LED+TSOP38238) |
| 10 | RGB status LED | WS2812B (NeoPixel) | 1 | $0.08 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=WS2812B+LED) |
| 11 | Power supply | USB-C 5V/2A adapter | 1 | $2.00 | [AliExpress](https://www.aliexpress.com/wholesale?SearchText=USB+C+5V+2A+adapter) \| [Amazon](https://www.amazon.com/s?k=USB+C+5V+2A+power+adapter) |
| 12 | Custom PCB | 2-layer ~50x50mm (PCBA assembled) | 1 | $5.00 | [JLCPCB](https://jlcpcb.com/) \| [PCBWay](https://www.pcbway.com/) |
| 13 | Enclosure | Custom injection molded ABS | 1 | $3.00* | Custom — see notes below |
| | | | | | |
| | **Per-node subtotal** | | | **~$25** | |
| | **x4 nodes subtotal** | | | **~$100** | |

> \* Enclosure cost amortized over 1,000 units. Tooling is $3,000–$5,000 one-time (separate mold from hub).

### Satellite Node Specs Summary

- **Compute:** ESP32-S3 (dual-core Xtensa LX7 @ 240MHz, 512KB SRAM)
- **Connectivity:** WiFi 4 (802.11b/g/n), Bluetooth 5.0/BLE
- **Audio:** I2S MEMS mic (INMP441) + I2S amplifier (MAX98357A) + 2W speaker
- **Sensors:** Temperature/humidity (SHT40), ambient light (BH1750), mmWave presence (LD2410C), air quality/VOC (ENS160)
- **Control:** IR blaster + receiver (TSOP38238)
- **Indicators:** WS2812B addressable RGB LED
- **Power:** USB-C 5V/2A

---

## Full System BOM Summary

| Component Group | Cost |
|----------------|------|
| Hub (all components) | ~$245 |
| 4x Satellite Nodes | ~$100 |
| **Total BOM** | **~$345** |
| **Retail Price** | **$2,500.00** |
| **Gross Margin** | **~86%** |

---

## Recurring Revenue

| Service | Price |
|---------|-------|
| Cloud AI (standard) | $100/mo |

Cloud AI includes: advanced LLM-powered voice understanding, cloud-based routine suggestions, remote access, OTA firmware updates, and priority support.

---

## Enclosure & PCB Notes

- **Hub enclosure:** Custom 2-piece ABS injection mold. Recommend minimum 1,000-unit run. Tooling quotes: request from [Protolabs](https://www.protolabs.com/), [Xometry](https://www.xometry.com/), or direct from Shenzhen suppliers via [Alibaba](https://www.alibaba.com/showroom/custom-abs-injection-molding.html).
- **Satellite enclosure:** Smaller, simpler mold. Same sourcing as above.
- **PCB fabrication + assembly (PCBA):** [JLCPCB](https://jlcpcb.com/) and [PCBWay](https://www.pcbway.com/) offer turnkey SMT assembly. Upload Gerbers + BOM + pick-and-place file. Typical lead time: 5–7 days.
- **For prototyping (< 100 units):** Use 3D-printed enclosures ($2–5/unit) and hand-soldered through-hole components to avoid tooling costs.

---

## Recommended Suppliers (Bulk)

| Supplier | Best For | Link |
|----------|----------|------|
| DigiKey | ICs, sensors (US stock) | [digikey.com](https://www.digikey.com/) |
| Mouser | ICs, sensors (US stock) | [mouser.com](https://www.mouser.com/) |
| LCSC | Components (China, low cost) | [lcsc.com](https://www.lcsc.com/) |
| Adafruit | Breakout boards, prototyping | [adafruit.com](https://www.adafruit.com/) |
| SparkFun | Breakout boards, prototyping | [sparkfun.com](https://www.sparkfun.com/) |
| AliExpress | Bulk modules, lowest price | [aliexpress.com](https://www.aliexpress.com/) |
| JLCPCB | PCB fab + SMT assembly | [jlcpcb.com](https://jlcpcb.com/) |
| PCBWay | PCB fab + SMT assembly | [pcbway.com](https://www.pcbway.com/) |
| PiShop.us | Raspberry Pi products (US) | [pishop.us](https://www.pishop.us/) |
| CanaKit | Raspberry Pi kits (US) | [canakit.com](https://www.canakit.com/) |
