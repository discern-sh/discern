export type TokenCategory =
  | "Color"
  | "Typography"
  | "Spacing"
  | "Shape"
  | "Motion"
  | "Layout";

export interface DesignToken {
  readonly name: `--ds-${string}`;
  readonly value: string;
  readonly category: TokenCategory;
  readonly description: string;
}

export interface ThemeToken {
  readonly name: `--ds-${string}`;
  readonly light: string;
  readonly dark: string;
  readonly category: "Color";
  readonly description: string;
}

const token = (
  name: DesignToken["name"],
  value: string,
  category: TokenCategory,
  description: string,
): DesignToken => ({ name, value, category, description });

const themeToken = (
  name: ThemeToken["name"],
  light: string,
  dark: string,
  description: string,
): ThemeToken => ({ name, light, dark, category: "Color", description });

export const designTokens = [
  token(
    "--ds-accent-hue",
    "259",
    "Color",
    "Master hue for the azure accent family.",
  ),
  token("--ds-ink-hue", "225", "Color", "Master hue for cool ink neutrals."),
  token("--ds-canvas-hue", "288", "Color", "Master hue for canvas neutrals."),
  token(
    "--ds-color-accent-100",
    "oklch(96.2% 0.019 var(--ds-accent-hue))",
    "Color",
    "Subtlest accent surface.",
  ),
  token(
    "--ds-color-accent-200",
    "oklch(92% 0.045 var(--ds-accent-hue))",
    "Color",
    "Quiet accent surface.",
  ),
  token(
    "--ds-color-accent-300",
    "oklch(85% 0.082 var(--ds-accent-hue))",
    "Color",
    "Soft accent fill.",
  ),
  token(
    "--ds-color-accent-400",
    "oklch(73% 0.128 var(--ds-accent-hue))",
    "Color",
    "Mid accent fill.",
  ),
  token(
    "--ds-color-accent-500",
    "oklch(61% 0.185 var(--ds-accent-hue))",
    "Color",
    "Strong accent fill.",
  ),
  token(
    "--ds-color-accent-600",
    "oklch(52% 0.208 var(--ds-accent-hue))",
    "Color",
    "Default accent action.",
  ),
  token(
    "--ds-color-accent-700",
    "oklch(44% 0.185 var(--ds-accent-hue))",
    "Color",
    "Strong accent text.",
  ),
  token(
    "--ds-color-accent-800",
    "oklch(34% 0.13 var(--ds-accent-hue))",
    "Color",
    "Deepest accent text.",
  ),
  token(
    "--ds-font-display",
    '"EB Garamond", "Iowan Old Style", Georgia, serif',
    "Typography",
    "Editorial display face; font loading is external.",
  ),
  token(
    "--ds-font-body",
    '"Inter", "Helvetica Neue", system-ui, sans-serif',
    "Typography",
    "Body face; font loading is external.",
  ),
  token(
    "--ds-font-mono",
    '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
    "Typography",
    "Code and annotation face.",
  ),
  token(
    "--ds-font-ui",
    '"IBM Plex Sans", system-ui, "Helvetica Neue", sans-serif',
    "Typography",
    "Dense interface chrome face.",
  ),
  token(
    "--ds-font-size-xs",
    "0.75rem",
    "Typography",
    "Fine print and compact labels.",
  ),
  token(
    "--ds-font-size-sm",
    "0.84375rem",
    "Typography",
    "Secondary interface copy.",
  ),
  token("--ds-font-size-md", "1rem", "Typography", "Body copy."),
  token("--ds-font-size-lg", "1.125rem", "Typography", "Lead copy."),
  token(
    "--ds-font-size-display-sm",
    "1.5rem",
    "Typography",
    "Small display heading.",
  ),
  token(
    "--ds-font-size-display-md",
    "2rem",
    "Typography",
    "Medium display heading.",
  ),
  token(
    "--ds-font-size-display-lg",
    "2.75rem",
    "Typography",
    "Large display heading.",
  ),
  token(
    "--ds-font-size-display-xl",
    "clamp(2.75rem, 5.4vw, 4.125rem)",
    "Typography",
    "Hero display heading.",
  ),
  token("--ds-font-weight-body", "400", "Typography", "Normal body weight."),
  token(
    "--ds-font-weight-strong",
    "650",
    "Typography",
    "Strong body and UI weight.",
  ),
  token(
    "--ds-font-weight-display",
    "700",
    "Typography",
    "Display heading weight.",
  ),
  token("--ds-leading-tight", "1.06", "Typography", "Display line height."),
  token(
    "--ds-leading-snug",
    "1.28",
    "Typography",
    "Compact heading line height.",
  ),
  token("--ds-leading-body", "1.62", "Typography", "Body line height."),
  ...([1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24] as const).map((step) =>
    token(
      `--ds-space-${step}`,
      `${step * 4}px`,
      "Spacing",
      `${step * 4}px spacing step.`,
    )
  ),
  token("--ds-radius-xs", "4px", "Shape", "Fine control radius."),
  token("--ds-radius-sm", "6px", "Shape", "Input radius."),
  token("--ds-radius-md", "8px", "Shape", "Button and card radius."),
  token("--ds-radius-lg", "12px", "Shape", "Window and dialog radius."),
  token("--ds-radius-pill", "999px", "Shape", "Badge and tag pill radius."),
  token(
    "--ds-shadow-card",
    "4px 4px 0 color-mix(in oklab, var(--ds-shadow-color) 10%, transparent)",
    "Shape",
    "Quiet hard-offset card shadow.",
  ),
  token(
    "--ds-shadow-window",
    "8px 10px 0 color-mix(in oklab, var(--ds-shadow-color) 12%, transparent)",
    "Shape",
    "Hard-offset presentation window shadow.",
  ),
  token(
    "--ds-shadow-pop",
    "6px 6px 0 color-mix(in oklab, var(--ds-shadow-color) 18%, transparent)",
    "Shape",
    "Raised overlay shadow.",
  ),
  token("--ds-duration-fast", "150ms", "Motion", "Hover and press response."),
  token(
    "--ds-duration-medium",
    "300ms",
    "Motion",
    "Ordinary state transition.",
  ),
  token("--ds-duration-reveal", "650ms", "Motion", "Choreographed reveal."),
  token(
    "--ds-ease-out",
    "cubic-bezier(0.22, 1, 0.36, 1)",
    "Motion",
    "Primary deceleration curve.",
  ),
  token(
    "--ds-ease-in-out",
    "cubic-bezier(0.65, 0, 0.35, 1)",
    "Motion",
    "Balanced state curve.",
  ),
  token("--ds-page-max", "66.25rem", "Layout", "Maximum editorial page width."),
  token("--ds-measure", "62ch", "Layout", "Readable prose measure."),
  token(
    "--ds-section-space",
    "clamp(4.5rem, 9vw, 7.75rem)",
    "Layout",
    "Section rhythm.",
  ),
] satisfies readonly DesignToken[];

export const themeTokens = [
  themeToken(
    "--ds-color-ink",
    "oklch(24% 0.03 var(--ds-ink-hue))",
    "oklch(93% 0.012 var(--ds-ink-hue))",
    "Primary ink.",
  ),
  themeToken(
    "--ds-color-ink-muted",
    "oklch(40% 0.026 var(--ds-ink-hue))",
    "oklch(76% 0.016 var(--ds-ink-hue))",
    "Secondary ink.",
  ),
  themeToken(
    "--ds-color-ink-faint",
    "oklch(56% 0.02 var(--ds-ink-hue))",
    "oklch(60% 0.018 var(--ds-ink-hue))",
    "Tertiary ink.",
  ),
  themeToken(
    "--ds-color-canvas",
    "oklch(96.6% 0.008 var(--ds-canvas-hue))",
    "oklch(20% 0.018 var(--ds-ink-hue))",
    "Page canvas.",
  ),
  themeToken(
    "--ds-color-surface",
    "#fff",
    "oklch(24.5% 0.02 var(--ds-ink-hue))",
    "Raised surface.",
  ),
  themeToken(
    "--ds-color-surface-sunken",
    "oklch(94.2% 0.01 var(--ds-canvas-hue))",
    "oklch(17.5% 0.016 var(--ds-ink-hue))",
    "Inset surface.",
  ),
  themeToken(
    "--ds-color-accent-wash",
    "var(--ds-color-accent-100)",
    "color-mix(in oklab, var(--ds-color-canvas) 84%, var(--ds-color-accent-600))",
    "Quiet accent wash over the page canvas.",
  ),
  themeToken(
    "--ds-color-accent-wash-strong",
    "var(--ds-color-accent-300)",
    "color-mix(in oklab, var(--ds-color-canvas) 62%, var(--ds-color-accent-500))",
    "Emphasised accent glow over the page canvas.",
  ),
  themeToken(
    "--ds-color-border",
    "oklch(89.5% 0.012 var(--ds-canvas-hue))",
    "oklch(31% 0.022 var(--ds-ink-hue))",
    "Hairline border.",
  ),
  themeToken(
    "--ds-color-border-strong",
    "oklch(81% 0.016 var(--ds-canvas-hue))",
    "oklch(42% 0.026 var(--ds-ink-hue))",
    "Emphasised border.",
  ),
  themeToken(
    "--ds-color-success",
    "oklch(55% 0.145 152)",
    "oklch(72% 0.15 152)",
    "Successful outcome.",
  ),
  themeToken(
    "--ds-color-success-soft",
    "oklch(95% 0.05 152)",
    "oklch(29% 0.06 152)",
    "Successful outcome surface.",
  ),
  themeToken(
    "--ds-color-warning",
    "oklch(61% 0.14 74)",
    "oklch(76% 0.13 82)",
    "Warning state.",
  ),
  themeToken(
    "--ds-color-warning-soft",
    "oklch(96% 0.045 82)",
    "oklch(30% 0.055 82)",
    "Warning surface.",
  ),
  themeToken(
    "--ds-color-danger",
    "oklch(54% 0.19 28)",
    "oklch(70% 0.17 28)",
    "Danger and invalid state.",
  ),
  themeToken(
    "--ds-color-danger-soft",
    "oklch(96% 0.035 28)",
    "oklch(29% 0.055 28)",
    "Danger surface.",
  ),
  themeToken(
    "--ds-shadow-color",
    "oklch(20% 0.025 var(--ds-ink-hue))",
    "oklch(4% 0.01 var(--ds-ink-hue))",
    "Shadow pigment.",
  ),
  themeToken(
    "--ds-color-overlay",
    "color-mix(in oklab, var(--ds-color-ink) 34%, transparent)",
    "color-mix(in oklab, #000 58%, transparent)",
    "Modal backdrop.",
  ),
] satisfies readonly ThemeToken[];

export const allTokens = [...designTokens, ...themeTokens] as const;
