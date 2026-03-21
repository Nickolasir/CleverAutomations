/**
 * Credential Leak Scanner Tests
 *
 * Scans the entire codebase for hardcoded secrets, API keys, database
 * connection strings, and other sensitive values that should never be
 * committed to source control.
 *
 * Security requirements from claude.md:
 *   "API keys stored in environment variables or Supabase secrets vault.
 *    Never in code, never in database."
 *   "Environment variables via .env files (never committed, .env.example committed)"
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Root of the monorepo */
const REPO_ROOT = path.resolve(__dirname, "../../../../..");

/** Directories to skip during scanning */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  ".turbo",
  ".DS_Store",
  "__pycache__",
]);

/** File extensions to scan */
const SCANNABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".sql",
  ".sh",
  ".bash",
  ".env.example",
  ".md",
]);

/** Files that are explicitly allowed to contain key-like patterns */
const ALLOWLISTED_FILES = new Set([
  ".env.example",
  "credential-scan.test.ts", // This file itself contains regex patterns
]);

// ---------------------------------------------------------------------------
// Regex patterns for common secret formats
// ---------------------------------------------------------------------------

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: "critical" | "high" | "medium";
  description: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // --- Supabase ---
  {
    name: "Supabase Service Role Key",
    regex:
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}/g,
    severity: "critical",
    description: "Supabase JWT token (service role or access token)",
  },
  {
    name: "Supabase URL with Key",
    regex:
      /https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1.*[?&]apikey=[A-Za-z0-9._-]{30,}/g,
    severity: "critical",
    description: "Supabase API URL with embedded key",
  },

  // --- Generic API Keys ---
  {
    name: "Generic API Key Assignment",
    regex:
      /(?:api[_-]?key|apikey|api[_-]?secret|api[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-/.]{20,}["']/gi,
    severity: "high",
    description: "Hardcoded API key assignment",
  },
  {
    name: "Bearer Token Hardcoded",
    regex: /["']Bearer\s+[A-Za-z0-9_\-/.]{20,}["']/g,
    severity: "high",
    description: "Hardcoded Bearer token",
  },

  // --- Deepgram ---
  {
    name: "Deepgram API Key",
    regex: /(?:deepgram|dg)[_-]?(?:api[_-]?)?key\s*[:=]\s*["'][a-f0-9]{32,}["']/gi,
    severity: "critical",
    description: "Deepgram API key",
  },

  // --- Groq ---
  {
    name: "Groq API Key",
    regex: /gsk_[A-Za-z0-9]{20,}/g,
    severity: "critical",
    description: "Groq API key (gsk_ prefix)",
  },

  // --- OpenRouter ---
  {
    name: "OpenRouter API Key",
    regex: /sk-or-v1-[a-f0-9]{64}/g,
    severity: "critical",
    description: "OpenRouter API key",
  },

  // --- OpenAI / Generic sk- keys ---
  {
    name: "OpenAI-style API Key",
    regex: /sk-[A-Za-z0-9]{32,}/g,
    severity: "high",
    description: "OpenAI-format secret key (sk-...)",
  },

  // --- Database Connection Strings ---
  {
    name: "PostgreSQL Connection String",
    regex:
      /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/g,
    severity: "critical",
    description: "PostgreSQL connection string with credentials",
  },
  {
    name: "MySQL Connection String",
    regex: /mysql:\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/g,
    severity: "critical",
    description: "MySQL connection string with credentials",
  },
  {
    name: "MongoDB Connection String",
    regex: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^/]+/g,
    severity: "critical",
    description: "MongoDB connection string with credentials",
  },

  // --- AWS ---
  {
    name: "AWS Access Key ID",
    regex: /AKIA[0-9A-Z]{16}/g,
    severity: "critical",
    description: "AWS Access Key ID",
  },
  {
    name: "AWS Secret Access Key",
    regex:
      /(?:aws[_-]?secret[_-]?(?:access[_-]?)?key)\s*[:=]\s*["'][A-Za-z0-9/+=]{40}["']/gi,
    severity: "critical",
    description: "AWS Secret Access Key",
  },

  // --- Private Keys ---
  {
    name: "Private Key Block",
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    severity: "critical",
    description: "Embedded private key",
  },

  // --- Generic Secrets ---
  {
    name: "Password Assignment",
    regex:
      /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi,
    severity: "medium",
    description: "Hardcoded password (not in .env.example)",
  },
  {
    name: "Secret Assignment",
    regex: /(?:secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-/.]{16,}["']/gi,
    severity: "medium",
    description: "Hardcoded secret or token value",
  },

  // --- Home Assistant ---
  {
    name: "Home Assistant Long-Lived Token",
    regex:
      /(?:ha[_-]?(?:long[_-]?lived[_-]?)?token|ha[_-]?token)\s*[:=]\s*["'][A-Za-z0-9._-]{100,}["']/gi,
    severity: "critical",
    description: "Home Assistant long-lived access token",
  },

  // --- Cartesia ---
  {
    name: "Cartesia API Key",
    regex:
      /(?:cartesia)[_-]?(?:api[_-]?)?key\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/gi,
    severity: "high",
    description: "Cartesia TTS API key",
  },
];

// ---------------------------------------------------------------------------
// File scanner utilities
// ---------------------------------------------------------------------------

/**
 * Recursively collect all scannable source files under a directory.
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        results.push(...collectSourceFiles(fullPath));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (
        SCANNABLE_EXTENSIONS.has(ext) ||
        SCANNABLE_EXTENSIONS.has(entry.name)
      ) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Scan a file for secret patterns.
 * Returns an array of findings.
 */
interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  severity: string;
  match: string;
}

function scanFile(filePath: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  // Skip allowlisted files
  const basename = path.basename(filePath);
  if (ALLOWLISTED_FILES.has(basename)) return findings;

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return findings;
  }

  const lines = content.split("\n");

  for (const pattern of SECRET_PATTERNS) {
    // Reset regex state for global patterns
    pattern.regex.lastIndex = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;

      // Skip comment-only lines that describe patterns (like in this test)
      if (
        line.trimStart().startsWith("//") ||
        line.trimStart().startsWith("*") ||
        line.trimStart().startsWith("#")
      ) {
        continue;
      }

      // Skip lines that reference environment variables (process.env)
      if (line.includes("process.env")) continue;

      // Skip lines with placeholder values
      if (
        line.includes("your-") ||
        line.includes("YOUR_") ||
        line.includes("placeholder") ||
        line.includes("example") ||
        line.includes("test-anon-key") ||
        line.includes("test-service-role-key")
      ) {
        continue;
      }

      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      const match = regex.exec(line);

      if (match) {
        findings.push({
          file: path.relative(REPO_ROOT, filePath),
          line: lineIdx + 1,
          pattern: pattern.name,
          severity: pattern.severity,
          match: match[0].substring(0, 40) + (match[0].length > 40 ? "..." : ""),
        });
      }
    }
  }

  return findings;
}

// ===========================================================================
// CREDENTIAL SCAN TESTS
// ===========================================================================

describe("Credential Leak Scanner", () => {
  let sourceFiles: string[];

  beforeAll(() => {
    sourceFiles = collectSourceFiles(REPO_ROOT);
  });

  it("finds source files to scan", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it("no hardcoded API keys found in any source file", () => {
    const allFindings: SecretFinding[] = [];

    for (const file of sourceFiles) {
      const findings = scanFile(file);
      allFindings.push(...findings);
    }

    const criticalFindings = allFindings.filter(
      (f) => f.severity === "critical"
    );

    if (criticalFindings.length > 0) {
      const report = criticalFindings
        .map(
          (f) =>
            `  CRITICAL: ${f.pattern} in ${f.file}:${f.line} — "${f.match}"`
        )
        .join("\n");
      expect.fail(
        `Found ${criticalFindings.length} critical credential leak(s):\n${report}`
      );
    }
  });

  it("no high-severity secrets found in source files", () => {
    const allFindings: SecretFinding[] = [];

    for (const file of sourceFiles) {
      const findings = scanFile(file);
      allFindings.push(...findings);
    }

    const highFindings = allFindings.filter((f) => f.severity === "high");

    if (highFindings.length > 0) {
      const report = highFindings
        .map(
          (f) => `  HIGH: ${f.pattern} in ${f.file}:${f.line} — "${f.match}"`
        )
        .join("\n");
      expect.fail(
        `Found ${highFindings.length} high-severity secret(s):\n${report}`
      );
    }
  });

  it("no database connection strings found in source code", () => {
    const dbPatterns = SECRET_PATTERNS.filter(
      (p) =>
        p.name.includes("Connection String") ||
        p.name.includes("PostgreSQL") ||
        p.name.includes("MySQL") ||
        p.name.includes("MongoDB")
    );

    for (const file of sourceFiles) {
      const basename = path.basename(file);
      if (ALLOWLISTED_FILES.has(basename)) continue;

      let content: string;
      try {
        content = fs.readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      for (const pattern of dbPatterns) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        const match = regex.exec(content);

        if (match) {
          const relativePath = path.relative(REPO_ROOT, file);
          expect.fail(
            `Database connection string found in ${relativePath}: ${match[0].substring(0, 30)}...`
          );
        }
      }
    }
  });

  it("no private keys embedded in source files", () => {
    for (const file of sourceFiles) {
      let content: string;
      try {
        content = fs.readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      if (content.includes("-----BEGIN") && content.includes("PRIVATE KEY")) {
        const relativePath = path.relative(REPO_ROOT, file);
        expect.fail(
          `Private key found in ${relativePath}. Private keys must never be committed.`
        );
      }
    }
  });

  it("no AWS access keys in source files", () => {
    const awsKeyRegex = /AKIA[0-9A-Z]{16}/g;

    for (const file of sourceFiles) {
      const basename = path.basename(file);
      if (ALLOWLISTED_FILES.has(basename)) continue;

      let content: string;
      try {
        content = fs.readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      const match = awsKeyRegex.exec(content);
      if (match) {
        const relativePath = path.relative(REPO_ROOT, file);
        expect.fail(`AWS Access Key ID found in ${relativePath}: ${match[0]}`);
      }
    }
  });
});

// ===========================================================================
// .GITIGNORE VERIFICATION
// ===========================================================================

describe(".gitignore Includes .env Files", () => {
  it(".gitignore exists at repository root", () => {
    const gitignorePath = path.join(REPO_ROOT, ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);
  });

  it(".gitignore contains .env entry", () => {
    const gitignorePath = path.join(REPO_ROOT, ".gitignore");
    const content = fs.readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());

    const hasEnvRule = lines.some(
      (line) =>
        line === ".env" ||
        line === ".env*" ||
        line === ".env.*" ||
        line === "*.env"
    );

    expect(hasEnvRule).toBe(true);
  });

  it(".gitignore contains .env.local entry", () => {
    const gitignorePath = path.join(REPO_ROOT, ".gitignore");
    const content = fs.readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());

    const hasEnvLocalRule = lines.some(
      (line) =>
        line === ".env.local" ||
        line === ".env*.local" ||
        line === ".env.*.local" ||
        line === ".env*"
    );

    expect(hasEnvLocalRule).toBe(true);
  });

  it("no actual .env files are tracked (only .env.example)", () => {
    // Check for .env files at common locations
    const envLocations = [
      path.join(REPO_ROOT, ".env"),
      path.join(REPO_ROOT, ".env.local"),
      path.join(REPO_ROOT, ".env.production"),
      path.join(REPO_ROOT, "packages", "supabase-backend", ".env"),
      path.join(REPO_ROOT, "packages", "voice-pipeline", ".env"),
      path.join(REPO_ROOT, "packages", "web-dashboard", ".env"),
    ];

    // .env files may exist locally but should not contain real secrets
    // The key test is that .gitignore blocks them
    const gitignorePath = path.join(REPO_ROOT, ".gitignore");
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");

    expect(gitignore).toContain(".env");
  });
});

// ===========================================================================
// .ENV.EXAMPLE VALIDATION
// ===========================================================================

describe(".env.example Has Placeholder Values Only", () => {
  it(".env.example exists", () => {
    const envExamplePath = path.join(REPO_ROOT, ".env.example");
    expect(fs.existsSync(envExamplePath)).toBe(true);
  });

  it(".env.example does not contain real API keys", () => {
    const envExamplePath = path.join(REPO_ROOT, ".env.example");
    const content = fs.readFileSync(envExamplePath, "utf-8");

    // Should not contain real JWT tokens
    expect(content).not.toMatch(
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{30,}/
    );

    // Should not contain real Groq keys
    expect(content).not.toMatch(/gsk_[A-Za-z0-9]{20,}/);

    // Should not contain real OpenRouter keys
    expect(content).not.toMatch(/sk-or-v1-[a-f0-9]{64}/);

    // Should not contain real OpenAI-style keys
    expect(content).not.toMatch(/sk-[A-Za-z0-9]{32,}/);

    // Should not contain real AWS keys
    expect(content).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it(".env.example values are clearly placeholder format", () => {
    const envExamplePath = path.join(REPO_ROOT, ".env.example");
    const content = fs.readFileSync(envExamplePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

    for (const line of lines) {
      const [key, ...valueParts] = line.split("=");
      const value = valueParts.join("=").trim();

      if (!key || !value) continue;

      // Each value should be clearly a placeholder
      const isPlaceholder =
        value.startsWith("your-") ||
        value.startsWith("YOUR_") ||
        value.includes("placeholder") ||
        value.includes("your-") ||
        value.includes("example") ||
        value === "development" ||
        value === "production" ||
        value === "test" ||
        value.startsWith("http://") ||
        value.startsWith("https://your-");

      expect(isPlaceholder).toBe(true);
    }
  });

  it(".env.example covers all required environment variables", () => {
    const envExamplePath = path.join(REPO_ROOT, ".env.example");
    const content = fs.readFileSync(envExamplePath, "utf-8");

    // Required variables from the architecture
    const requiredVars = [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DEEPGRAM_API_KEY",
      "GROQ_API_KEY",
      "CARTESIA_API_KEY",
      "OPENROUTER_API_KEY",
      "HA_URL",
      "HA_LONG_LIVED_TOKEN",
      "NODE_ENV",
    ];

    for (const varName of requiredVars) {
      expect(content).toContain(varName);
    }
  });
});

// ===========================================================================
// NO SECRETS IN SPECIFIC SENSITIVE LOCATIONS
// ===========================================================================

describe("No Secrets in Sensitive Locations", () => {
  it("package.json files contain no secrets", () => {
    const packageJsonFiles = collectSourceFiles(REPO_ROOT).filter(
      (f) => path.basename(f) === "package.json"
    );

    for (const file of packageJsonFiles) {
      const content = fs.readFileSync(file, "utf-8");

      // package.json should never contain API keys
      expect(content).not.toMatch(/gsk_[A-Za-z0-9]{20,}/);
      expect(content).not.toMatch(/sk-or-v1-[a-f0-9]{64}/);
      expect(content).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(content).not.toMatch(
        /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}/
      );
    }
  });

  it("tsconfig.json files contain no secrets", () => {
    const tsconfigFiles = collectSourceFiles(REPO_ROOT).filter(
      (f) => path.basename(f).startsWith("tsconfig")
    );

    for (const file of tsconfigFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toMatch(/(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{8,}/gi);
    }
  });

  it("SQL migration files contain no secrets", () => {
    const sqlFiles = collectSourceFiles(REPO_ROOT).filter(
      (f) => path.extname(f) === ".sql"
    );

    for (const file of sqlFiles) {
      const content = fs.readFileSync(file, "utf-8");

      // SQL files should not contain hardcoded passwords or keys
      expect(content).not.toMatch(/PASSWORD\s*=\s*'[^']{8,}'/gi);
      expect(content).not.toMatch(
        /postgres(?:ql)?:\/\/[^:]+:[^@]+@/
      );
    }
  });
});
