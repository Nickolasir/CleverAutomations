/**
 * Kitchen Sub-Hub Agent
 *
 * Raspberry Pi-based kitchen satellite that extends the CleverHub
 * platform with ePantry inventory, shopping list management, receipt/barcode
 * scanning, pantry photo analysis, kitchen timers, and recipe suggestions.
 *
 * Follows the PiAgent pattern: registers with Supabase, subscribes to
 * Realtime channels, manages local hardware, and runs periodic tasks.
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type { TenantId, UserId, KitchenTimer } from "@clever/shared";
import type { Database } from "@clever/supabase-backend";

import { CameraCapture, isCameraPresent } from "./hardware/camera.js";
import { BarcodeScanner } from "./hardware/barcode-scanner.js";
import { ScanButton, type ButtonEvent } from "./hardware/scan-button.js";
import { LEDStatusRing, type LEDColor } from "./hardware/led-ring.js";
import { ReceiptScanner } from "./vision/receipt-scanner.js";
import { PantryPhotographer } from "./vision/pantry-photographer.js";
import { BarcodeLookup } from "./vision/barcode-lookup.js";
import { PantryManager } from "./pantry/pantry-manager.js";
import { ExpiryTracker } from "./pantry/expiry-tracker.js";
import { StockMonitor } from "./pantry/stock-monitor.js";
import { ShoppingListManager } from "./shopping/shopping-list-manager.js";
import { TimerManager } from "./kitchen/timer-manager.js";
import { RecipeSuggester } from "./kitchen/recipe-suggester.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface KitchenHubConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  deviceJwt: string;
  tenantId: TenantId;
  deviceId: string;
  cameraDevice?: string;
  scanButtonGpioPin?: number;
  ledRingGpioPin?: number;
  heartbeatIntervalMs?: number;
}

function loadConfigFromEnv(): KitchenHubConfig {
  const required = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`Missing required env var: ${key}`);
    return value;
  };

  return {
    supabaseUrl: required("SUPABASE_URL"),
    supabaseAnonKey: required("SUPABASE_ANON_KEY"),
    deviceJwt: required("DEVICE_JWT"),
    tenantId: required("TENANT_ID") as TenantId,
    deviceId:
      process.env["DEVICE_ID"] ??
      `kitchen-${process.env["HOSTNAME"] ?? "unknown"}`,
    cameraDevice: process.env["KITCHEN_HUB_CAMERA_DEVICE"] ?? "/dev/video0",
    scanButtonGpioPin: parseInt(
      process.env["SCAN_BUTTON_GPIO_PIN"] ?? "17",
      10,
    ),
    ledRingGpioPin: parseInt(process.env["LED_RING_GPIO_PIN"] ?? "18", 10),
    heartbeatIntervalMs: parseInt(
      process.env["HEARTBEAT_INTERVAL_MS"] ?? "30000",
      10,
    ),
  };
}

// ---------------------------------------------------------------------------
// Kitchen Hub Agent
// ---------------------------------------------------------------------------

export class KitchenHubAgent {
  private readonly config: KitchenHubConfig;
  private readonly supabase: SupabaseClient<Database>;

  // Hardware
  private readonly camera: CameraCapture;
  private readonly barcodeScanner: BarcodeScanner;
  private readonly scanButton: ScanButton;
  private readonly ledRing: LEDStatusRing;

  // Vision processors
  private readonly receiptScanner: ReceiptScanner;
  private readonly pantryPhotographer: PantryPhotographer;
  private readonly barcodeLookup: BarcodeLookup;

  // Data managers
  private readonly pantryManager: PantryManager;
  private readonly expiryTracker: ExpiryTracker;
  private readonly stockMonitor: StockMonitor;
  private readonly shoppingListManager: ShoppingListManager;

  // Kitchen features
  private readonly timerManager: TimerManager;
  private readonly recipeSuggester: RecipeSuggester;

  // Realtime
  private kitchenChannel: RealtimeChannel | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private expiryCheckTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config?: KitchenHubConfig) {
    this.config = config ?? loadConfigFromEnv();

    this.supabase = createClient<Database>(
      this.config.supabaseUrl,
      this.config.supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${this.config.deviceJwt}`,
          },
        },
        realtime: { params: { eventsPerSecond: 10 } },
      },
    );

    // Hardware
    this.camera = new CameraCapture(this.config.cameraDevice);
    this.barcodeScanner = new BarcodeScanner(this.camera);
    this.scanButton = new ScanButton(this.config.scanButtonGpioPin ?? 17);
    this.ledRing = new LEDStatusRing(this.config.ledRingGpioPin ?? 18);

    // Vision
    this.receiptScanner = new ReceiptScanner(this.supabase, this.camera);
    this.pantryPhotographer = new PantryPhotographer(this.supabase, this.camera);
    this.barcodeLookup = new BarcodeLookup(
      this.supabase,
      this.barcodeScanner,
      this.config.tenantId,
    );

    // Data managers
    this.pantryManager = new PantryManager(
      this.supabase,
      this.config.tenantId,
    );
    this.expiryTracker = new ExpiryTracker(
      this.supabase,
      this.config.tenantId,
    );
    this.stockMonitor = new StockMonitor(this.supabase, this.config.tenantId);
    this.shoppingListManager = new ShoppingListManager(
      this.supabase,
      this.config.tenantId,
    );

    // Kitchen features
    this.timerManager = new TimerManager();
    this.recipeSuggester = new RecipeSuggester(
      this.supabase,
      this.config.tenantId,
    );
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("[KitchenHub] Starting Kitchen Sub-Hub Agent...");
    console.log(`[KitchenHub] Device ID: ${this.config.deviceId}`);
    console.log(`[KitchenHub] Tenant:    ${this.config.tenantId as string}`);

    // 1. Detect hardware
    await this.detectHardware();

    // 2. Register with Supabase
    await this.registerDevice();

    // 3. Subscribe to kitchen Realtime channel (receives commands from Pi hub)
    this.subscribeToKitchenChannel();

    // 4. Set up scan button handler
    this.setupScanButton();

    // 5. Start heartbeat
    this.startHeartbeat();

    // 6. Start daily expiry check (every 24h, first run after 1min)
    this.startExpiryChecker();

    // 7. Start stock monitor (checks every hour)
    this.startStockMonitor();

    // 8. LED: ready
    this.ledRing.show("blue");

    console.log("[KitchenHub] Kitchen Sub-Hub Agent started.");
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    console.log("[KitchenHub] Stopping...");

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.expiryCheckTimer) clearInterval(this.expiryCheckTimer);

    this.timerManager.cancelAll();
    this.scanButton.cleanup();

    if (this.kitchenChannel) {
      this.supabase.removeChannel(this.kitchenChannel);
    }

    this.ledRing.off();
    console.log("[KitchenHub] Stopped.");
  }

  // -----------------------------------------------------------------------
  // Hardware detection
  // -----------------------------------------------------------------------

  private async detectHardware(): Promise<void> {
    console.log("[KitchenHub] Detecting hardware...");

    if (isCameraPresent(this.config.cameraDevice)) {
      console.log("[KitchenHub]   Camera: detected");
    } else {
      console.warn("[KitchenHub]   Camera: NOT detected");
    }

    console.log(
      `[KitchenHub]   Scan button: GPIO ${this.config.scanButtonGpioPin}`,
    );
    console.log(
      `[KitchenHub]   LED ring: GPIO ${this.config.ledRingGpioPin}`,
    );
  }

  // -----------------------------------------------------------------------
  // Device registration
  // -----------------------------------------------------------------------

  private async registerDevice(): Promise<void> {
    const { error } = await this.supabase.from("pi_devices" as never).upsert(
      {
        device_id: this.config.deviceId,
        tenant_id: this.config.tenantId,
        hostname: process.env["HOSTNAME"] ?? "unknown",
        status: "online",
        version: process.env["npm_package_version"] ?? "0.1.0",
        hardware: {
          camera: isCameraPresent(this.config.cameraDevice),
          scan_button: true,
          led_ring: true,
          display: true,
          type: "kitchen_hub",
        },
        last_seen: new Date().toISOString(),
        registered_at: new Date().toISOString(),
      } as never,
      { onConflict: "device_id,tenant_id" },
    );

    if (error) {
      console.error(`[KitchenHub] Registration failed: ${error.message}`);
    } else {
      console.log("[KitchenHub] Device registered.");
    }
  }

  // -----------------------------------------------------------------------
  // Realtime: listen for kitchen commands from Pi hub
  // -----------------------------------------------------------------------

  private subscribeToKitchenChannel(): void {
    const channelName = `kitchen:${this.config.tenantId as string}`;

    this.kitchenChannel = this.supabase.channel(channelName);
    this.kitchenChannel
      .on(
        "broadcast",
        { event: "kitchen_command" },
        (message) => {
          const payload = message.payload as {
            action: string;
            parameters: Record<string, unknown>;
            user_id: string;
          };

          this.handleKitchenCommand(
            payload.action,
            payload.parameters,
            payload.user_id as UserId,
          ).catch((err) => {
            console.error(
              "[KitchenHub] Command error:",
              err instanceof Error ? err.message : err,
            );
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[KitchenHub] Kitchen channel subscribed.");
        }
      });
  }

  private async handleKitchenCommand(
    action: string,
    parameters: Record<string, unknown>,
    userId: UserId,
  ): Promise<void> {
    console.log(`[KitchenHub] Received command: ${action}`);

    switch (action) {
      case "scan_receipt":
        this.ledRing.show("yellow");
        await this.receiptScanner.scanReceipt(
          this.config.tenantId,
          userId,
        );
        this.ledRing.flash("green");
        break;

      case "scan_barcode":
        this.ledRing.show("yellow");
        await this.barcodeLookup.scanAndAdd(userId);
        this.ledRing.flash("green");
        break;

      case "scan_barcode_remove":
        this.ledRing.show("yellow");
        await this.barcodeLookup.scanAndRemove(userId);
        this.ledRing.flash("red");
        break;

      case "scan_pantry_photo": {
        const location =
          (parameters["location"] as "pantry" | "fridge" | "freezer") ??
          "pantry";
        this.ledRing.show("yellow");
        await this.pantryPhotographer.captureAndAnalyze(
          this.config.tenantId,
          location,
        );
        this.ledRing.flash("green");
        break;
      }

      case "set_timer": {
        const duration = parameters["duration"] as number;
        const unit = (parameters["unit"] as string) ?? "minute";
        const label = parameters["label"] as string | undefined;

        let seconds = duration;
        if (unit === "minute") seconds = duration * 60;
        if (unit === "hour") seconds = duration * 3600;

        this.timerManager.setTimer(seconds, label, () => {
          // Timer complete — play alert sound
          console.log(
            `[KitchenHub] Timer${label ? ` "${label}"` : ""} complete!`,
          );
          this.ledRing.flash("green");
          // Audio alert would be played via the speaker here
        });
        break;
      }

      case "cancel_timer":
        this.timerManager.cancelAll();
        break;

      case "check_timer": {
        const timers = this.timerManager.getActiveTimers();
        if (timers.length === 0) {
          console.log("[KitchenHub] No active timers.");
        } else {
          for (const t of timers) {
            console.log(
              `[KitchenHub] Timer${t.label ? ` "${t.label}"` : ""}: ${t.remaining_seconds}s remaining`,
            );
          }
        }
        break;
      }

      case "suggest_recipe":
        await this.recipeSuggester.suggestFromPantry();
        break;

      default:
        console.warn(`[KitchenHub] Unknown action: ${action}`);
    }
  }

  // -----------------------------------------------------------------------
  // Scan button handler
  // -----------------------------------------------------------------------

  private setupScanButton(): void {
    this.scanButton.onPress((event: ButtonEvent) => {
      if (event.type === "short_press") {
        // Short press: barcode scan
        console.log("[KitchenHub] Button: short press → barcode scan");
        this.ledRing.show("yellow");
        this.barcodeLookup
          .scanAndAdd("system" as UserId)
          .then(() => this.ledRing.flash("green"))
          .catch((err) => {
            console.error("[KitchenHub] Barcode scan error:", err);
            this.ledRing.flash("red");
          });
      } else if (event.type === "long_press") {
        // Long press (2s): receipt scan
        console.log("[KitchenHub] Button: long press → receipt scan");
        this.ledRing.show("yellow");
        this.receiptScanner
          .scanReceipt(this.config.tenantId, "system" as UserId)
          .then(() => this.ledRing.flash("green"))
          .catch((err) => {
            console.error("[KitchenHub] Receipt scan error:", err);
            this.ledRing.flash("red");
          });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Periodic tasks
  // -----------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      await this.supabase
        .from("pi_devices" as never)
        .update({
          status: "online",
          last_seen: new Date().toISOString(),
        } as never)
        .eq("device_id" as never, this.config.deviceId as never)
        .eq("tenant_id" as never, this.config.tenantId as never);
    }, this.config.heartbeatIntervalMs ?? 30_000);
  }

  private startExpiryChecker(): void {
    // Run first check after 1 minute, then every 24 hours
    setTimeout(async () => {
      await this.expiryTracker.checkAndNotify();
      this.expiryCheckTimer = setInterval(
        () => void this.expiryTracker.checkAndNotify(),
        24 * 60 * 60 * 1000,
      );
    }, 60_000);
  }

  private startStockMonitor(): void {
    // Check every hour
    setInterval(
      () => void this.stockMonitor.checkAndAutoRestock(),
      60 * 60 * 1000,
    );
  }
}
