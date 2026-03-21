/**
 * Barcode scanner using zbar library.
 *
 * Decodes barcodes (UPC, EAN, QR, etc.) from camera frames.
 * Requires: apt install zbar-tools
 */

import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CameraCapture } from "./camera.js";

const execFileAsync = promisify(execFile);

export interface BarcodeResult {
  type: string; // e.g., "EAN-13", "UPC-A", "QR-Code"
  data: string; // the barcode value
}

export class BarcodeScanner {
  constructor(private readonly camera: CameraCapture) {}

  /**
   * Capture a frame and attempt to decode any barcodes in it.
   * Returns all decoded barcodes from the frame.
   */
  async scan(): Promise<BarcodeResult[]> {
    const imageBuffer = await this.camera.captureForBarcode();
    return this.decodeFromBuffer(imageBuffer);
  }

  /**
   * Decode barcodes from a JPEG buffer using zbarimg.
   */
  async decodeFromBuffer(buffer: Buffer): Promise<BarcodeResult[]> {
    const tmpPath = join(
      tmpdir(),
      `clever-zbar-${Date.now()}.jpg`,
    );

    await writeFile(tmpPath, buffer);

    try {
      const { stdout } = await execFileAsync("zbarimg", [
        "--quiet",
        "--raw",
        tmpPath,
      ]);

      const results: BarcodeResult[] = [];

      // zbarimg output format: "TYPE:DATA\n"
      for (const line of stdout.trim().split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          results.push({
            type: line.substring(0, colonIndex),
            data: line.substring(colonIndex + 1),
          });
        }
      }

      return results;
    } catch {
      // zbarimg exits with code 4 if no barcode found
      return [];
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }
}
