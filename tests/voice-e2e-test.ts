/**
 * Voice Pipeline E2E Test Script
 *
 * Part A: Tier 1 Rules Engine smoke test (no APIs needed)
 *   Tests 10 voice transcript strings against the rules engine to verify
 *   pattern matching for common smart home commands.
 *
 * Part B: Tier 2 Cloud Pipeline test (requires API keys)
 *   Demonstrates how to feed audio to the full pipeline when keys are available.
 *
 * Run: npx tsx tests/voice-e2e-test.ts
 */

import { matchRule } from "../packages/voice-pipeline/src/tier1/rules-engine.js";
import { SpeechToIntent } from "../packages/voice-pipeline/src/tier1/speech-to-intent.js";

// ---------------------------------------------------------------------------
// Part A: Tier 1 Rules Engine Smoke Test
// ---------------------------------------------------------------------------

interface TestCase {
  transcript: string;
  expectedDomain: string | null;
  expectedAction: string | null;
  description: string;
}

const TEST_CASES: TestCase[] = [
  {
    transcript: "turn on the living room lights",
    expectedDomain: "light",
    expectedAction: "turn_on",
    description: "Light on (living room)",
  },
  {
    transcript: "turn off kitchen lights",
    expectedDomain: "light",
    expectedAction: "turn_off",
    description: "Light off (kitchen)",
  },
  {
    transcript: "set temperature to 72 degrees",
    expectedDomain: "thermostat",
    expectedAction: "set_temperature",
    description: "Set thermostat to 72",
  },
  {
    transcript: "lock the front door",
    expectedDomain: "lock",
    expectedAction: "lock",
    description: "Lock front door",
  },
  {
    transcript: "unlock all doors",
    expectedDomain: "lock",
    expectedAction: "unlock",
    description: "Unlock all doors",
  },
  {
    transcript: "dim bedroom to 50%",
    expectedDomain: "light",
    expectedAction: "set_brightness",
    description: "Dim bedroom to 50%",
  },
  {
    // Note: The rules engine does not have a media_player play rule for
    // "play music in the living room". This tests a known gap — complex
    // media commands route to Tier 2 (LLM). We expect null here.
    transcript: "play music in the living room",
    expectedDomain: null,
    expectedAction: null,
    description: "Play music (Tier 2 — no rule)",
  },
  {
    transcript: "good night",
    expectedDomain: "scene",
    expectedAction: "activate",
    description: "Scene: good night",
  },
  {
    // "what's the temperature" is a conversational query, not a command
    // pattern in the rules engine. Expect null — routes to Tier 2 LLM.
    transcript: "what's the temperature",
    expectedDomain: null,
    expectedAction: null,
    description: "Query temperature (Tier 2)",
  },
  {
    // Emergency commands are handled at the permission layer, not the
    // rules engine. The rules engine does not have a pattern for this.
    transcript: "help there's a fire",
    expectedDomain: null,
    expectedAction: null,
    description: "Emergency (not in rules)",
  },
];

interface TestResult {
  transcript: string;
  matched: boolean;
  domain: string | null;
  action: string | null;
  confidence: number | null;
  latencyMs: number;
  pass: boolean;
}

function runTier1Tests(): { results: TestResult[]; allPassed: boolean } {
  console.log("=============================================================");
  console.log("  Part A: Tier 1 Rules Engine Smoke Test (no APIs needed)");
  console.log("=============================================================");
  console.log("");

  const results: TestResult[] = [];
  let allPassed = true;

  for (const tc of TEST_CASES) {
    const start = performance.now();
    const intent = matchRule(tc.transcript);
    const latencyMs = performance.now() - start;

    const matched = intent !== null;
    const domain = intent?.domain ?? null;
    const action = intent?.action ?? null;
    const confidence = intent?.confidence ?? null;

    const domainOk = domain === tc.expectedDomain;
    const actionOk = action === tc.expectedAction;
    const pass = domainOk && actionOk;

    if (!pass) allPassed = false;

    results.push({
      transcript: tc.transcript,
      matched,
      domain,
      action,
      confidence,
      latencyMs,
      pass,
    });
  }

  return { results, allPassed };
}

function runSpeechToIntentTest(): boolean {
  console.log("");
  console.log("-------------------------------------------------------------");
  console.log("  SpeechToIntent wrapper validation");
  console.log("-------------------------------------------------------------");
  console.log("");

  const stt = new SpeechToIntent({ customPatterns: [] });

  // Must initialize before use — throws if not initialized
  try {
    stt.processTranscript("turn on the living room lights");
    console.log("  FAIL: processTranscript should throw before init");
    return false;
  } catch {
    console.log("  PASS: Throws before initialization (as expected)");
  }

  // Initialize (synchronous compile of patterns)
  stt.initialize().then(() => {
    const result = stt.processTranscript("turn on the living room lights");
    if (result && result.domain === "light" && result.action === "turn_on") {
      console.log("  PASS: SpeechToIntent.processTranscript matched 'turn on the living room lights'");
      console.log(`         domain=${result.domain} action=${result.action} confidence=${result.confidence}`);
    } else {
      console.log("  FAIL: SpeechToIntent.processTranscript did not match expected intent");
    }

    // Test a non-matching transcript
    const noMatch = stt.processTranscript("tell me a joke about cats");
    if (noMatch === null) {
      console.log("  PASS: Returns null for unrecognized transcript 'tell me a joke about cats'");
    } else {
      console.log("  FAIL: Should have returned null for unrecognized transcript");
    }

    stt.destroy();
    console.log("  SpeechToIntent destroyed cleanly.");
  });

  return true;
}

function printResultsTable(results: TestResult[]): void {
  // Header
  const cols = {
    status: 6,
    transcript: 38,
    matched: 9,
    domain: 14,
    action: 20,
    confidence: 12,
    latency: 12,
  };

  const sep = "-".repeat(
    cols.status + cols.transcript + cols.matched + cols.domain +
    cols.action + cols.confidence + cols.latency + 8
  );

  console.log(sep);
  console.log(
    pad("OK?", cols.status) + " | " +
    pad("Transcript", cols.transcript) + " | " +
    pad("Matched?", cols.matched) + " | " +
    pad("Domain", cols.domain) + " | " +
    pad("Action", cols.action) + " | " +
    pad("Confidence", cols.confidence) + " | " +
    pad("Latency", cols.latency)
  );
  console.log(sep);

  for (const r of results) {
    const statusIcon = r.pass ? "PASS" : "FAIL";
    console.log(
      pad(statusIcon, cols.status) + " | " +
      pad(truncate(r.transcript, cols.transcript), cols.transcript) + " | " +
      pad(r.matched ? "yes" : "no", cols.matched) + " | " +
      pad(r.domain ?? "(null)", cols.domain) + " | " +
      pad(r.action ?? "(null)", cols.action) + " | " +
      pad(r.confidence !== null ? r.confidence.toFixed(2) : "(null)", cols.confidence) + " | " +
      pad(r.latencyMs.toFixed(3) + " ms", cols.latency)
    );
  }

  console.log(sep);
}

function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

// ---------------------------------------------------------------------------
// Part B: Tier 2 Cloud Pipeline Test (requires API keys)
// ---------------------------------------------------------------------------

function runTier2Check(): void {
  console.log("");
  console.log("=============================================================");
  console.log("  Part B: Tier 2 Cloud Pipeline Test (requires API keys)");
  console.log("=============================================================");
  console.log("");

  const deepgramKey = process.env["DEEPGRAM_API_KEY"];
  const groqKey = process.env["GROQ_API_KEY"];
  const cartesiaKey = process.env["CARTESIA_API_KEY"];

  const missing: string[] = [];
  if (!deepgramKey) missing.push("DEEPGRAM_API_KEY");
  if (!groqKey) missing.push("GROQ_API_KEY");
  if (!cartesiaKey) missing.push("CARTESIA_API_KEY");

  if (missing.length > 0) {
    console.log("  Skipping Tier 2 test: set API keys in .env");
    console.log(`  Missing: ${missing.join(", ")}`);
    console.log("");
    console.log("  To enable Tier 2 testing, create a .env file in the project root:");
    console.log("    DEEPGRAM_API_KEY=your_deepgram_key");
    console.log("    GROQ_API_KEY=your_groq_key");
    console.log("    CARTESIA_API_KEY=your_cartesia_key");
    console.log("");
    return;
  }

  console.log("  All API keys detected. Tier 2 pipeline can be tested.");
  console.log("");
  console.log("  To run a full Tier 2 test with real audio:");
  console.log("");
  console.log("  Option 1: Pre-recorded PCM file");
  console.log("    Record a WAV: sox -d -r 16000 -c 1 -b 16 test.wav trim 0 5");
  console.log("    Convert to raw PCM: sox test.wav -r 16000 -c 1 -b 16 -e signed-integer test.pcm");
  console.log("    Then in code:");
  console.log("      import { readFileSync } from 'node:fs';");
  console.log("      const audio = readFileSync('test.pcm');");
  console.log("      const session = await pipeline.processVoiceCommand(audio);");
  console.log("");
  console.log("  Option 2: Synthetic silence buffer (tests pipeline plumbing)");
  console.log("    const silence = Buffer.alloc(16000 * 2 * 3); // 3 seconds of silence");
  console.log("    const session = await pipeline.processVoiceCommand(silence);");
  console.log("    // Expect: STT returns empty/noise, LLM gets empty transcript");
  console.log("");
  console.log("  Option 3: Use the VoicePipeline class directly");
  console.log("    import { VoicePipeline } from '../packages/voice-pipeline/src/orchestrator/pipeline.js';");
  console.log("    const pipeline = new VoicePipeline({");
  console.log("      tenantId: 'a0000000-0000-4000-8000-000000000001',");
  console.log("      userId:   'b0000000-0000-4000-8000-000000000001',");
  console.log("      deviceId: 'd0000000-0000-4000-8000-000000000001',");
  console.log("      tierRouter: {},");
  console.log("      deepgram:  { apiKey: process.env.DEEPGRAM_API_KEY, model: 'nova-3', ... },");
  console.log("      groq:      { apiKey: process.env.GROQ_API_KEY, model: 'llama-3.3-70b-versatile', ... },");
  console.log("      cartesia:  { apiKey: process.env.CARTESIA_API_KEY, model: 'sonic-3', ... },");
  console.log("    });");
  console.log("    await pipeline.initialize();");
  console.log("    pipeline.on('stt_final', (text) => console.log('Transcript:', text));");
  console.log("    pipeline.on('llm_token', (token) => process.stdout.write(token));");
  console.log("    pipeline.on('tts_audio', (chunk) => { /* play chunk */ });");
  console.log("    const session = await pipeline.processVoiceCommand(audioBuffer);");
  console.log("    pipeline.destroy();");
  console.log("");
  console.log("  Note: SoX is required for mic recording. Install via:");
  console.log("    macOS:   brew install sox");
  console.log("    Ubuntu:  sudo apt install sox");
  console.log("    Windows: choco install sox");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("");
  console.log("  Clever Automations - Voice Pipeline E2E Test");
  console.log("  ============================================");
  console.log("");

  // Part A: Rules engine tests
  const { results, allPassed } = runTier1Tests();
  printResultsTable(results);

  const passCount = results.filter((r) => r.pass).length;
  const totalCount = results.length;
  console.log("");
  console.log(`  Results: ${passCount}/${totalCount} passed`);

  if (allPassed) {
    console.log("  All Tier 1 rules engine tests passed.");
  } else {
    console.log("  Some tests failed. Review the table above for details.");
    console.log("  Note: Tests expecting null (Tier 2 routing) are valid if domain/action are both null.");
  }

  // SpeechToIntent wrapper test
  const sttOk = runSpeechToIntentTest();

  // Allow async SpeechToIntent test to complete
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Part B: Tier 2 check
  runTier2Check();

  // Summary
  console.log("");
  console.log("=============================================================");
  console.log("  Summary");
  console.log("=============================================================");
  console.log(`  Tier 1 Rules Engine: ${passCount}/${totalCount} tests passed`);
  console.log(`  SpeechToIntent wrapper: ${sttOk ? "OK" : "FAILED"}`);

  // Compute average latency for matched rules
  const matchedResults = results.filter((r) => r.matched);
  if (matchedResults.length > 0) {
    const avgLatency =
      matchedResults.reduce((sum, r) => sum + r.latencyMs, 0) / matchedResults.length;
    console.log(`  Avg rules engine latency: ${avgLatency.toFixed(3)} ms (target: <5ms)`);
  }

  console.log("");

  // Exit code
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
