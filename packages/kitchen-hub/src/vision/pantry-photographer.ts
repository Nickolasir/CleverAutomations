/**
 * Pantry/fridge photographer.
 *
 * Captures a photo of the pantry, fridge, or freezer, uploads it,
 * and calls the pantry-analysis Edge Function for AI item identification.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, PantryLocation } from "@clever/shared";
import type { Database } from "@clever/supabase-backend";
import type { CameraCapture } from "../hardware/camera.js";

export class PantryPhotographer {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly camera: CameraCapture,
  ) {}

  /**
   * Capture a pantry/fridge/freezer photo and send for AI analysis.
   * Returns the analysis ID for tracking.
   */
  async captureAndAnalyze(
    tenantId: TenantId,
    location: PantryLocation,
  ): Promise<string> {
    console.log(`[PantryPhoto] Capturing ${location} photo...`);

    // 1. Capture image
    const imageBuffer = await this.camera.capture();

    // 2. Upload to Supabase Storage
    const filename = `pantry-photos/${tenantId as string}/${location}-${Date.now()}.jpg`;
    const { error: uploadError } = await this.supabase.storage
      .from("kitchen-images")
      .upload(filename, imageBuffer, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from("kitchen-images").getPublicUrl(filename);

    // 3. Create analysis record
    const { data: analysis, error: insertError } = await (this.supabase
      .from("pantry_photo_analyses") as any)
      .insert({
        tenant_id: tenantId as unknown as string,
        image_url: publicUrl,
        location,
        processing_status: "pending",
        identified_items: [],
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(`Analysis record failed: ${insertError.message}`);
    }

    // 4. Call pantry-analysis Edge Function
    const { error: fnError } = await this.supabase.functions.invoke(
      "pantry-analysis",
      {
        body: {
          analysis_id: analysis.id,
          image_url: publicUrl,
          location,
        },
      },
    );

    if (fnError) {
      console.error(
        `[PantryPhoto] Analysis function error: ${fnError.message}`,
      );
    }

    console.log(`[PantryPhoto] Analysis submitted: ${analysis.id}`);
    return analysis.id;
  }
}
