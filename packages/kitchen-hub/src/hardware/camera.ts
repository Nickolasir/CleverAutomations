/**
 * Pi Camera capture module.
 *
 * Wraps libcamera-still (Pi Camera) or fswebcam (USB webcam) for
 * image capture. Images are saved as JPEG for upload to Supabase Storage.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function isCameraPresent(device?: string): boolean {
  const path = device ?? "/dev/video0";
  return existsSync(path);
}

export class CameraCapture {
  private readonly device: string;

  constructor(device?: string) {
    this.device = device ?? "/dev/video0";
  }

  /**
   * Capture a still image and return it as a Buffer.
   * Uses libcamera-still if available, falls back to fswebcam.
   */
  async capture(): Promise<Buffer> {
    const tmpPath = join(
      tmpdir(),
      `clever-capture-${Date.now()}.jpg`,
    );

    try {
      // Try libcamera-still first (Pi Camera Module)
      await execFileAsync("libcamera-still", [
        "-o",
        tmpPath,
        "--width",
        "2048",
        "--height",
        "1536",
        "--quality",
        "90",
        "--nopreview",
        "--timeout",
        "1000",
      ]);
    } catch {
      // Fall back to fswebcam (USB webcam)
      await execFileAsync("fswebcam", [
        "-d",
        this.device,
        "-r",
        "1920x1080",
        "--jpeg",
        "90",
        "--no-banner",
        tmpPath,
      ]);
    }

    const buffer = await readFile(tmpPath);
    await unlink(tmpPath).catch(() => {});
    return buffer;
  }

  /**
   * Capture a single frame optimized for barcode scanning.
   * Lower resolution for faster capture and decode.
   */
  async captureForBarcode(): Promise<Buffer> {
    const tmpPath = join(
      tmpdir(),
      `clever-barcode-${Date.now()}.jpg`,
    );

    try {
      await execFileAsync("libcamera-still", [
        "-o",
        tmpPath,
        "--width",
        "1280",
        "--height",
        "720",
        "--quality",
        "85",
        "--nopreview",
        "--timeout",
        "500",
      ]);
    } catch {
      await execFileAsync("fswebcam", [
        "-d",
        this.device,
        "-r",
        "1280x720",
        "--jpeg",
        "85",
        "--no-banner",
        tmpPath,
      ]);
    }

    const buffer = await readFile(tmpPath);
    await unlink(tmpPath).catch(() => {});
    return buffer;
  }
}
