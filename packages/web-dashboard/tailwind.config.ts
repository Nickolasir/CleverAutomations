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
         *  provide the CleverHub brand palette. */
        brand: {
          50: "var(--color-brand-50, #FFF8E1)",
          100: "var(--color-brand-100, #FFECB3)",
          200: "var(--color-brand-200, #FFE082)",
          300: "var(--color-brand-300, #FFD54F)",
          400: "var(--color-brand-400, #FFCA28)",
          500: "var(--color-brand-500, #D4A843)",
          600: "var(--color-brand-600, #C9952B)",
          700: "var(--color-brand-700, #B8860B)",
          800: "var(--color-brand-800, #8D6E0A)",
          900: "var(--color-brand-900, #5D4A08)",
          950: "var(--color-brand-950, #3D3005)",
        },
        surface: {
          DEFAULT: "var(--color-surface, #ffffff)",
          secondary: "var(--color-surface-secondary, #FFFDF7)",
          tertiary: "var(--color-surface-tertiary, #FFF8E1)",
        },
        sidebar: {
          bg: "var(--color-sidebar-bg, #1F1F1F)",
          text: "var(--color-sidebar-text, #E8E0D0)",
          hover: "var(--color-sidebar-hover, #2D2D2D)",
          active: "var(--color-sidebar-active, #3D3D3D)",
        },
        tv: {
          bg: "#1a1a1a",
          surface: "#2D2D2D",
          "surface-hover": "#3D3D3D",
          text: "#FDF6E3",
          muted: "#A8A29E",
          focus: "#D4A843",
          success: "#22c55e",
          error: "#dc2626",
          warning: "#B45309",
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
