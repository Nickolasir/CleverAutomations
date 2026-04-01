/**
 * Receipt scanner.
 *
 * Captures a receipt image via camera, uploads to Supabase Storage,
 * and calls the receipt-ocr Edge Function for AI-powered item extraction.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";
import type { Database } from "@clever/supabase-backend";
import type { CameraCapture } from "../hardware/camera.js";

export class ReceiptScanner {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly camera: CameraCapture,
  ) {}

  /**
   * Capture a receipt image, upload it, and send for OCR processing.
   * Returns the receipt ID for tracking.
   */
  async scanReceipt(tenantId: TenantId, userId: UserId): Promise<string> {
    console.log("[ReceiptScanner] Capturing receipt image...");

    // 1. Capture image
    const imageBuffer = await this.camera.capture();

    // 2. Upload to Supabase Storage
    const filename = `receipts/${tenantId as string}/${Date.now()}.jpg`;
    const { error: uploadError } = await this.supabase.storage
      .from("kitchen-images")
      .upload(filename, imageBuffer, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // 3. Get public URL
    const {
      data: { publicUrl },
    } = this.supabase.storage.from("kitchen-images").getPublicUrl(filename);

    // 4. Create receipt record with pending status
    const { data: receipt, error: insertError } = await (this.supabase
      .from("receipts") as any)
      .insert({
        tenant_id: tenantId as unknown as string,
        image_url: publicUrl,
        processing_status: "pending",
        scanned_by: userId as unknown as string,
        items_extracted: [],
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(`Receipt record failed: ${insertError.message}`);
    }

    // 5. Call receipt-ocr Edge Function
    const { error: fnError } = await this.supabase.functions.invoke(
      "receipt-ocr",
      {
        body: {
          receipt_id: receipt.id,
          image_url: publicUrl,
        },
      },
    );

    if (fnError) {
      console.error(`[ReceiptScanner] OCR function error: ${fnError.message}`);
      // Non-fatal: the receipt is stored, OCR can be retried
    }

    console.log(`[ReceiptScanner] Receipt submitted: ${receipt.id}`);
    return receipt.id;
  }
}
