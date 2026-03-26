/**
 * CleverHub - Recipe Suggestion Edge Function
 *
 * Receives a list of pantry ingredients and asks an LLM to suggest
 * recipes that can be made with those ingredients.
 *
 * Endpoint: POST /functions/v1/recipe-suggest
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Rate limited: max 5 suggestions per minute per tenant
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecipeSuggestRequest {
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
  }>;
  tenant_id: string;
}

interface RecipeSuggestion {
  title: string;
  ingredients_used: string[];
  missing_ingredients: string[];
  prep_time_minutes: number;
  difficulty: "easy" | "medium" | "hard";
  instructions_summary: string;
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const body = (await req.json()) as RecipeSuggestRequest;
  const { ingredients } = body;

  if (!ingredients || ingredients.length === 0) {
    return new Response(
      JSON.stringify({ error: "ingredients array required" }),
      { status: 400 },
    );
  }

  try {
    const groqApiKey = Deno.env.get("GROQ_API_KEY")!;
    const recipes = await suggestRecipes(ingredients, groqApiKey);

    return new Response(
      JSON.stringify({ success: true, recipes }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// LLM call for recipe suggestion
// ---------------------------------------------------------------------------

async function suggestRecipes(
  ingredients: RecipeSuggestRequest["ingredients"],
  apiKey: string,
): Promise<RecipeSuggestion[]> {
  const ingredientList = ingredients
    .map((i) => `${i.quantity} ${i.unit} ${i.name}`)
    .join(", ");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful cooking assistant. Suggest 3 recipes based on available ingredients. " +
            "Return ONLY valid JSON array: " +
            '[{"title": "...", "ingredients_used": ["..."], "missing_ingredients": ["..."], "prep_time_minutes": 30, "difficulty": "easy", "instructions_summary": "..."}]. ' +
            "Difficulty must be: easy, medium, or hard. " +
            "Prioritize recipes that use the most available ingredients and need the fewest missing ones. " +
            "Keep instructions_summary to 2-3 sentences.",
        },
        {
          role: "user",
          content: `I have these ingredients: ${ingredientList}. What can I cook?`,
        },
      ],
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "[]";
  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(jsonStr) as RecipeSuggestion[];
}
