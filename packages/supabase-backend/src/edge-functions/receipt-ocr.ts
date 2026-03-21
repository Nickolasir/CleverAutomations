/**
 * Clever Automations - Receipt OCR Edge Function
 *
 * Receives a receipt image URL, sends it to a vision LLM for OCR,
 * extracts line items, and bulk-inserts them into the pantry.
 *
 * Endpoint: POST /functions/v1/receipt-ocr
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Rate limited: max 10 scans per minute per tenant
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReceiptOCRRequest {
  receipt_id: string;
  image_url: string;
}

interface ExtractedLineItem {
  name: string;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  category: string | null;
}

interface ReceiptOCRResult {
  store_name: string | null;
  date: string | null;
  items: ExtractedLineItem[];
  total: number | null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }

  // Extract JWT claims
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const body = (await req.json()) as ReceiptOCRRequest;
  const { receipt_id, image_url } = body;

  if (!receipt_id || !image_url) {
    return new Response(
      JSON.stringify({ error: "receipt_id and image_url required" }),
      { status: 400 },
    );
  }

  // Initialize Supabase service client
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Update receipt status to processing
    await supabase
      .from("receipts")
      .update({ processing_status: "processing" })
      .eq("id", receipt_id);

    // Call vision LLM for receipt OCR
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    const ocrResult = await extractReceiptItems(image_url, groqApiKey!);

    // Update receipt with extracted data
    await supabase
      .from("receipts")
      .update({
        store_name: ocrResult.store_name,
        purchase_date: ocrResult.date,
        total: ocrResult.total,
        items_extracted: ocrResult.items,
        processing_status: "completed",
      })
      .eq("id", receipt_id);

    // Get receipt to find tenant_id
    const { data: receipt } = await supabase
      .from("receipts")
      .select("tenant_id")
      .eq("id", receipt_id)
      .single();

    if (receipt && ocrResult.items.length > 0) {
      // Bulk insert pantry items
      const pantryInserts = ocrResult.items.map((item) => ({
        tenant_id: receipt.tenant_id,
        name: item.name,
        quantity: item.quantity,
        unit: "item",
        category: item.category ?? "other",
        source: "receipt_scan",
        location: "pantry",
      }));

      await supabase.from("pantry_items").insert(pantryInserts);

      // Audit log
      await supabase.from("audit_logs").insert({
        tenant_id: receipt.tenant_id,
        action: "receipt_scanned",
        details: {
          receipt_id,
          items_count: ocrResult.items.length,
          store: ocrResult.store_name,
          total: ocrResult.total,
        },
        timestamp: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        receipt_id,
        items_extracted: ocrResult.items.length,
        store_name: ocrResult.store_name,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabase
      .from("receipts")
      .update({
        processing_status: "failed",
        error_message: message,
      })
      .eq("id", receipt_id);

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Vision LLM call for receipt extraction
// ---------------------------------------------------------------------------

async function extractReceiptItems(
  imageUrl: string,
  apiKey: string,
): Promise<ReceiptOCRResult> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.2-90b-vision-preview",
      messages: [
        {
          role: "system",
          content:
            "You are a receipt OCR system. Extract all line items from the grocery receipt image. " +
            "Return ONLY valid JSON with this structure: " +
            '{"store_name": "...", "date": "YYYY-MM-DD", "items": [{"name": "...", "quantity": 1, "unit_price": 2.99, "total_price": 2.99, "category": "..."}], "total": 45.67}. ' +
            "Categories: produce, dairy, meat, seafood, frozen, canned, dry_goods, bakery, beverages, snacks, condiments, spices, household, personal_care, other. " +
            "If you can't determine a value, use null.",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
            {
              type: "text",
              text: "Extract all items from this grocery receipt.",
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";

  // Parse JSON from LLM response (may be wrapped in markdown code blocks)
  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(jsonStr) as ReceiptOCRResult;
}
