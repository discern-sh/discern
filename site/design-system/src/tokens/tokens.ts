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
  readonly category: TokenCategory;
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
  category: TokenCategory = "Color",
): ThemeToken => ({ name, light, dark, category, description });

export const designTokens = [
  token(
    "--ds-accent-hue",
    "259",
    "Color",
    "Master hue for the azure accent family.",
  ),
  token("--ds-ink-hue", "225", "Color", "Master hue for cool ink neutrals."),
  token("--ds-canvas-hue", "80.72", "Color", "Master hue for canvas neutrals."),
  token(
    "--ds-font-display",
    '"Crimson Pro", "Iowan Old Style", Georgia, serif',
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
    '"Inter", "Helvetica Neue", system-ui, sans-serif',
    "Typography",
    "Dense interface chrome face.",
  ),
  token(
    "--ds-font-features-ui",
    "'liga' 1, 'calt' 1, 'dlig' 1, 'tnum' 1, 'zero' 1, 'ss03' 1, 'salt' 1",
    "Typography",
    "OpenType features for interface chrome.",
  ),
  token(
    "--ds-font-size-xs",
    "0.85rem",
    "Typography",
    "Fine print and compact labels.",
  ),
  token(
    "--ds-font-size-sm",
    "0.95rem",
    "Typography",
    "Secondary interface copy.",
  ),
  token("--ds-font-size-md", "1.05rem", "Typography", "Body copy."),
  token("--ds-font-size-lg", "1.125rem", "Typography", "Lead copy."),
  token(
    "--ds-font-size-card-title",
    "var(--ds-font-size-lg)",
    "Typography",
    "Primary title within a card surface.",
  ),
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
  token("--ds-leading-tight", "1.08", "Typography", "Display line height."),
  token(
    "--ds-leading-snug",
    "1.3",
    "Typography",
    "Compact heading line height.",
  ),
  token("--ds-leading-body", "1.58", "Typography", "Body line height."),
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
    "oklch(98.97% 0.0028 var(--ds-canvas-hue))",
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
    "oklch(96.5% 0.004 var(--ds-canvas-hue))",
    "oklch(17.5% 0.016 var(--ds-ink-hue))",
    "Inset surface.",
  ),
  themeToken(
    "--ds-color-accent-100",
    "oklch(96.2% 0.019 var(--ds-accent-hue))",
    "oklch(29% 0.055 var(--ds-accent-hue))",
    "Subtlest accent surface.",
  ),
  themeToken(
    "--ds-color-accent-200",
    "oklch(92% 0.045 var(--ds-accent-hue))",
    "oklch(35% 0.08 var(--ds-accent-hue))",
    "Quiet accent surface.",
  ),
  themeToken(
    "--ds-color-accent-300",
    "oklch(85% 0.082 var(--ds-accent-hue))",
    "oklch(46% 0.115 var(--ds-accent-hue))",
    "Soft accent fill.",
  ),
  themeToken(
    "--ds-color-accent-400",
    "oklch(73% 0.128 var(--ds-accent-hue))",
    "oklch(58% 0.15 var(--ds-accent-hue))",
    "Mid accent fill.",
  ),
  themeToken(
    "--ds-color-accent-500",
    "oklch(61% 0.185 var(--ds-accent-hue))",
    "oklch(67% 0.165 var(--ds-accent-hue))",
    "Strong accent fill.",
  ),
  themeToken(
    "--ds-color-accent-600",
    "oklch(52% 0.208 var(--ds-accent-hue))",
    "oklch(74% 0.14 var(--ds-accent-hue))",
    "Default accent action.",
  ),
  themeToken(
    "--ds-color-accent-700",
    "oklch(44% 0.185 var(--ds-accent-hue))",
    "oklch(82% 0.105 var(--ds-accent-hue))",
    "Strong accent text.",
  ),
  themeToken(
    "--ds-color-accent-800",
    "oklch(34% 0.13 var(--ds-accent-hue))",
    "oklch(90% 0.06 var(--ds-accent-hue))",
    "Deepest accent text.",
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
    "--ds-color-stripe",
    "oklch(85% 0.014 var(--ds-canvas-hue))",
    "oklch(33% 0.022 var(--ds-ink-hue))",
    "Decorative hatch and window-chrome pigment.",
  ),
  themeToken(
    "--ds-color-success",
    "oklch(64% 0.165 152)",
    "oklch(70% 0.155 152)",
    "Successful outcome.",
  ),
  themeToken(
    "--ds-color-success-soft",
    "oklch(95% 0.05 152)",
    "oklch(29% 0.06 152)",
    "Successful outcome surface.",
  ),
  themeToken(
    "--ds-color-success-deep",
    "oklch(37% 0.09 152)",
    "oklch(88% 0.1 152)",
    "Successful outcome text on a tinted surface.",
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
    "var(--ds-color-ink)",
    "oklch(6% 0.01 var(--ds-ink-hue))",
    "Shadow pigment.",
  ),
  themeToken(
    "--ds-shadow-card",
    "4px 4px 0 color-mix(in oklab, var(--ds-shadow-color) 6%, transparent)",
    "4px 4px 0 color-mix(in oklab, var(--ds-shadow-color) 40%, transparent)",
    "Quiet hard-offset card shadow.",
    "Shape",
  ),
  themeToken(
    "--ds-shadow-window",
    "8px 10px 0 color-mix(in oklab, var(--ds-shadow-color) 6%, transparent)",
    "8px 10px 0 color-mix(in oklab, var(--ds-shadow-color) 40%, transparent)",
    "Hard-offset presentation window shadow.",
    "Shape",
  ),
  themeToken(
    "--ds-shadow-pop",
    "6px 6px 0 color-mix(in oklab, var(--ds-shadow-color) 12%, transparent)",
    "6px 6px 0 color-mix(in oklab, var(--ds-shadow-color) 55%, transparent)",
    "Raised overlay shadow.",
    "Shape",
  ),
  themeToken(
    "--ds-color-overlay",
    "color-mix(in oklab, var(--ds-color-ink) 34%, transparent)",
    "color-mix(in oklab, #000 58%, transparent)",
    "Modal backdrop.",
  ),
] satisfies readonly ThemeToken[];

export const allTokens = [...designTokens, ...themeTokens] as const;
