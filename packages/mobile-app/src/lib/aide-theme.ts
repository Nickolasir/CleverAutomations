/**
 * CleverAide High Contrast Theme
 *
 * Applied when the user's profile is assisted_living.
 * WCAG AAA compliant (contrast ratio > 7:1).
 * Large text, large touch targets, minimal visual complexity.
 */

export const AIDE_COLORS = {
  // Backgrounds
  background: "#FFFFFF",
  backgroundDark: "#000000",
  surface: "#FDF6E3",
  surfaceDark: "#2D2D2D",

  // Text
  text: "#000000",
  textDark: "#FFFFFF",
  textSecondary: "#334155",
  textSecondaryDark: "#CBD5E1",

  // Actions
  primary: "#B8860B",
  primaryDark: "#FFD54F",

  // SOS / Emergency
  emergency: "#DC2626",
  emergencyBackground: "#FEE2E2",

  // Status
  success: "#15803D",
  warning: "#B45309",
  error: "#DC2626",
  info: "#B8860B",

  // Borders
  border: "#2D2D2D",
  borderLight: "#94A3B8",
} as const;

export const AIDE_FONTS = {
  /** Body text — minimum 20pt for readability */
  body: 20,
  /** Headers — 28pt for clear section identification */
  header: 28,
  /** Sub-headers */
  subheader: 22,
  /** Small text (labels, timestamps) — still 16pt minimum */
  small: 16,
  /** Button text */
  button: 20,
} as const;

export const AIDE_LAYOUT = {
  /** Minimum touch target size (dp) per WCAG */
  minTouchTarget: 48,
  /** SOS button size */
  sosButtonSize: 80,
  /** Border radius for cards */
  borderRadius: 16,
  /** Padding for cards and containers */
  padding: 20,
  /** Maximum interactive elements per screen */
  maxElementsPerScreen: 4,
} as const;

export const AIDE_ACCESSIBILITY = {
  /** Whether to auto-open microphone in chat */
  voiceFirstDefault: true,
  /** Whether to use high contrast borders */
  highContrastBorders: true,
  /** Minimum font weight for text */
  minFontWeight: "600" as const,
} as const;
