/**
 * Kitchen Sub-Hub Entry Point
 *
 * Starts the KitchenHubAgent which manages:
 *   - Camera for receipt/barcode/pantry scanning
 *   - Voice commands for shopping list and pantry management
 *   - 7" touchscreen display for kitchen status
 *   - Kitchen timers with audio alerts
 *   - Expiry tracking and auto-restock
 */

export { KitchenHubAgent } from "./agent.js";
export type { KitchenHubConfig } from "./agent.js";

// Direct execution: start the agent
async function main(): Promise<void> {
  const { KitchenHubAgent } = await import("./agent.js");
  const agent = new KitchenHubAgent();
  await agent.start();
}

// Only run main if this file is the entry point
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("index.js");

if (isMainModule) {
  main().catch((err) => {
    console.error("[KitchenHub] Fatal error:", err);
    process.exit(1);
  });
}
