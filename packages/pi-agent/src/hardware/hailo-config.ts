/**
 * Hailo AI HAT+ 2 configuration.
 *
 * Detects the Hailo-8L accelerator on the Raspberry Pi 5,
 * reports capabilities (TOPS, memory), configures llama.cpp
 * for potential GPU offloading, and monitors device health.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Expected Hailo device node. */
export const HAILO_DEVICE_PATH = "/dev/hailo0";

/** PCIe vendor/device IDs for Hailo-8L. */
export const HAILO_PCI_VENDOR_ID = "1e60";
export const HAILO_PCI_DEVICE_ID_8L = "2864";

/** Hailo-8L AI HAT+ 2 specifications. */
export const HAILO_SPECS = {
  /** Name of the accelerator module. */
  name: "Hailo-8L AI HAT+ 2",
  /** Tera Operations Per Second. */
  tops: 40,
  /** Dedicated LPDDR4x memory in GB. */
  memoryGB: 8,
  /** PCIe interface generation (Pi 5 supports Gen 3 x1). */
  pcieGen: 3,
  /** Maximum power draw in watts. */
  maxPowerW: 6,
  /** Supported quantization formats for NN inference. */
  supportedFormats: ["int4", "int8", "float16"] as const,
} as const;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface HailoDetectionResult {
  /** Whether the Hailo device node exists. */
  devicePresent: boolean;
  /** Whether the Hailo kernel module is loaded. */
  kernelModuleLoaded: boolean;
  /** Whether the Hailo PCIe device is visible. */
  pcieDetected: boolean;
  /** Firmware version if device is present, null otherwise. */
  firmwareVersion: string | null;
  /** Driver version if loaded. */
  driverVersion: string | null;
}

/**
 * Detect whether the Hailo AI HAT+ is present and operational.
 */
export function detectHailo(): HailoDetectionResult {
  const result: HailoDetectionResult = {
    devicePresent: false,
    kernelModuleLoaded: false,
    pcieDetected: false,
    firmwareVersion: null,
    driverVersion: null,
  };

  // 1. Check device node
  result.devicePresent = existsSync(HAILO_DEVICE_PATH);

  // 2. Check kernel module
  try {
    const modules = execSync("lsmod", { encoding: "utf-8" });
    result.kernelModuleLoaded = modules.includes("hailo_pci");
  } catch {
    result.kernelModuleLoaded = false;
  }

  // 3. Check PCIe bus
  try {
    const lspci = execSync("lspci -nn", { encoding: "utf-8" });
    result.pcieDetected =
      lspci.toLowerCase().includes("hailo") ||
      lspci.includes(HAILO_PCI_VENDOR_ID);
  } catch {
    result.pcieDetected = false;
  }

  // 4. Get firmware version via hailortcli if available
  if (result.devicePresent) {
    try {
      const fwInfo = execSync("hailortcli fw-control identify", {
        encoding: "utf-8",
        timeout: 5_000,
      });
      const fwMatch = fwInfo.match(/Firmware Version:\s+([\d.]+)/);
      if (fwMatch?.[1]) {
        result.firmwareVersion = fwMatch[1];
      }
    } catch {
      // hailortcli not installed or device not responding
    }

    try {
      const drvInfo = execSync("hailortcli fw-control identify", {
        encoding: "utf-8",
        timeout: 5_000,
      });
      const drvMatch = drvInfo.match(/Driver Version:\s+([\d.]+)/);
      if (drvMatch?.[1]) {
        result.driverVersion = drvMatch[1];
      }
    } catch {
      // Ignore
    }
  }

  return result;
}

/**
 * Quick check: is the Hailo accelerator available for inference?
 */
export function isHailoAvailable(): boolean {
  const detection = detectHailo();
  return detection.devicePresent && detection.kernelModuleLoaded;
}

// ---------------------------------------------------------------------------
// llama.cpp GPU offloading configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for llama.cpp when Hailo is available.
 *
 * NOTE: As of early 2026, direct Hailo integration with llama.cpp
 * is experimental. The Hailo SDK primarily targets vision models
 * (YOLO, ResNet, etc.) via the HailoRT runtime. LLM offloading
 * to Hailo is not yet mainstream. This configuration prepares the
 * interface for when GGML gains a Hailo backend.
 *
 * Current strategy: use Hailo for vision tasks (camera processing)
 * and ARM NEON + CPU for LLM inference.
 */
export interface LlamaCppHailoConfig {
  /** Number of layers to offload to Hailo (0 = CPU only). */
  nGpuLayers: number;
  /** Number of CPU threads for non-offloaded layers. */
  nThreads: number;
  /** Context size in tokens. */
  contextSize: number;
  /** Batch size for prompt processing. */
  batchSize: number;
  /** Whether Hailo offloading is actually available. */
  hailoOffloadingAvailable: boolean;
}

/**
 * Generate optimal llama.cpp configuration based on Hailo availability.
 */
export function getLlamaCppConfig(): LlamaCppHailoConfig {
  const available = isHailoAvailable();

  // Detect CPU core count for thread allocation
  let cpuCores = 4; // Pi 5 has 4 cores
  try {
    const nproc = execSync("nproc", { encoding: "utf-8" }).trim();
    cpuCores = parseInt(nproc, 10) || 4;
  } catch {
    // Default to 4
  }

  return {
    // Hailo offloading is experimental — default to 0 (CPU only).
    // Set to a positive number when GGML Hailo backend matures.
    nGpuLayers: 0,
    // Reserve 1 core for the voice pipeline and system
    nThreads: Math.max(1, cpuCores - 1),
    // 2048 is a good balance for smart home commands
    contextSize: 2_048,
    batchSize: 512,
    hailoOffloadingAvailable: available,
  };
}

// ---------------------------------------------------------------------------
// Health monitoring
// ---------------------------------------------------------------------------

export interface HailoHealthStatus {
  /** Whether the device is present and operational. */
  operational: boolean;
  /** Device temperature in Celsius, null if unavailable. */
  temperatureC: number | null;
  /** Power consumption in watts, null if unavailable. */
  powerW: number | null;
  /** Current utilization percentage, null if unavailable. */
  utilizationPercent: number | null;
  /** Available TOPS for this device. */
  tops: number;
  /** Dedicated memory in GB. */
  memoryGB: number;
  /** Uptime of the device in seconds, null if unavailable. */
  uptimeSeconds: number | null;
}

/**
 * Read the current health status of the Hailo AI HAT+.
 */
export function getHailoHealth(): HailoHealthStatus {
  const detection = detectHailo();

  const status: HailoHealthStatus = {
    operational: detection.devicePresent && detection.kernelModuleLoaded,
    temperatureC: null,
    powerW: null,
    utilizationPercent: null,
    tops: HAILO_SPECS.tops,
    memoryGB: HAILO_SPECS.memoryGB,
    uptimeSeconds: null,
  };

  if (!status.operational) {
    return status;
  }

  // Read temperature from sysfs thermal zone
  try {
    const thermalZones = [
      "/sys/class/hailo/hailo0/device/thermal_zone/temp",
      "/sys/class/thermal/thermal_zone1/temp",
    ];
    for (const path of thermalZones) {
      if (existsSync(path)) {
        const raw = readFileSync(path, "utf-8").trim();
        const milliC = parseInt(raw, 10);
        if (!isNaN(milliC)) {
          // sysfs reports in millidegrees
          status.temperatureC = milliC >= 1000 ? milliC / 1000 : milliC;
          break;
        }
      }
    }
  } catch {
    // Temperature reading not available
  }

  // Read power consumption via hailortcli
  try {
    const power = execSync("hailortcli measure-power --duration 1", {
      encoding: "utf-8",
      timeout: 5_000,
    });
    const powerMatch = power.match(/([\d.]+)\s*W/);
    if (powerMatch?.[1]) {
      status.powerW = parseFloat(powerMatch[1]);
    }
  } catch {
    // Power measurement not available
  }

  // Read utilization
  try {
    const util = execSync("hailortcli monitor --count 1", {
      encoding: "utf-8",
      timeout: 5_000,
    });
    const utilMatch = util.match(/([\d.]+)%/);
    if (utilMatch?.[1]) {
      status.utilizationPercent = parseFloat(utilMatch[1]);
    }
  } catch {
    // Utilization not available
  }

  return status;
}

// ---------------------------------------------------------------------------
// Summary for logging
// ---------------------------------------------------------------------------

/**
 * Return a human-readable summary of the Hailo AI HAT+ status.
 */
export function getHailoSummary(): string {
  const health = getHailoHealth();
  const detection = detectHailo();

  const lines: string[] = [
    `Hailo AI HAT+ Status:`,
    `  Operational:  ${health.operational ? "Yes" : "No"}`,
    `  Device:       ${detection.devicePresent ? HAILO_DEVICE_PATH : "not found"}`,
    `  PCIe:         ${detection.pcieDetected ? "detected" : "not found"}`,
    `  Kernel:       ${detection.kernelModuleLoaded ? "hailo_pci loaded" : "module not loaded"}`,
    `  Firmware:     ${detection.firmwareVersion ?? "unknown"}`,
    `  TOPS:         ${health.tops}`,
    `  Memory:       ${health.memoryGB} GB LPDDR4x`,
  ];

  if (health.temperatureC !== null) {
    lines.push(`  Temperature:  ${health.temperatureC.toFixed(1)} C`);
  }
  if (health.powerW !== null) {
    lines.push(`  Power:        ${health.powerW.toFixed(2)} W`);
  }
  if (health.utilizationPercent !== null) {
    lines.push(`  Utilization:  ${health.utilizationPercent.toFixed(1)}%`);
  }

  return lines.join("\n");
}
