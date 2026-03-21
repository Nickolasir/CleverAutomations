import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /** White-label theming via CSS custom properties.
         *  Tenants override these in their settings; the defaults
         *  provide the Clever Automations brand palette. */
        brand: {
          50: "var(--color-brand-50, #eff6ff)",
          100: "var(--color-brand-100, #dbeafe)",
          200: "var(--color-brand-200, #bfdbfe)",
          300: "var(--color-brand-300, #93c5fd)",
          400: "var(--color-brand-400, #60a5fa)",
          500: "var(--color-brand-500, #3b82f6)",
          600: "var(--color-brand-600, #2563eb)",
          700: "var(--color-brand-700, #1d4ed8)",
          800: "var(--color-brand-800, #1e40af)",
          900: "var(--color-brand-900, #1e3a8a)",
          950: "var(--color-brand-950, #172554)",
        },
        surface: {
          DEFAULT: "var(--color-surface, #ffffff)",
          secondary: "var(--color-surface-secondary, #f8fafc)",
          tertiary: "var(--color-surface-tertiary, #f1f5f9)",
        },
        sidebar: {
          bg: "var(--color-sidebar-bg, #0f172a)",
          text: "var(--color-sidebar-text, #e2e8f0)",
          hover: "var(--color-sidebar-hover, #1e293b)",
          active: "var(--color-sidebar-active, #334155)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans, Inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono, JetBrains Mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
