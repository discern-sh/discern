export type TokenCategory =
  | "Color"
  | "Typography"
  | "Spacing"
  | "Shape"
  | "Motion"
  | "Layout";

export interface DesignToken {
  readonly name: `--discern-${string}`;
  readonly value: string;
  readonly category: TokenCategory;
  readonly description: string;
}

export interface ThemeToken {
  readonly name: `--discern-${string}`;
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
    "--discern-accent-hue",
    "259",
    "Color",
    "Master hue for the azure accent family.",
  ),
  token(
    "--discern-ink-hue",
    "225",
    "Color",
    "Master hue for cool ink neutrals.",
  ),
  token(
    "--discern-canvas-hue",
    "80.72",
    "Color",
    "Master hue for canvas neutrals.",
  ),
  token(
    "--discern-font-display",
    '"Crimson Pro", "Iowan Old Style", Georgia, serif',
    "Typography",
    "Editorial display face; font loading is external.",
  ),
  token(
    "--discern-font-body",
    '"Inter", "Helvetica Neue", system-ui, sans-serif',
    "Typography",
    "Body face; font loading is external.",
  ),
  token(
    "--discern-font-mono",
    '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
    "Typography",
    "Code and annotation face.",
  ),
  token(
    "--discern-font-ui",
    '"Inter", "Helvetica Neue", system-ui, sans-serif',
    "Typography",
    "Dense interface chrome face.",
  ),
  token(
    "--discern-font-features-ui",
    "'liga' 1, 'calt' 1, 'dlig' 1, 'tnum' 1, 'zero' 1, 'ss03' 1, 'salt' 1",
    "Typography",
    "OpenType features for interface chrome.",
  ),
  token(
    "--discern-font-size-xs",
    "0.85rem",
    "Typography",
    "Fine print and compact labels.",
  ),
  token(
    "--discern-font-size-sm",
    "0.95rem",
    "Typography",
    "Secondary interface copy.",
  ),
  token("--discern-font-size-md", "1.05rem", "Typography", "Body copy."),
  token("--discern-font-size-lg", "1.125rem", "Typography", "Lead copy."),
  token(
    "--discern-font-size-card-title",
    "var(--discern-font-size-lg)",
    "Typography",
    "Primary title within a card surface.",
  ),
  token(
    "--discern-font-size-display-sm",
    "1.5rem",
    "Typography",
    "Small display heading.",
  ),
  token(
    "--discern-font-size-display-md",
    "2rem",
    "Typography",
    "Medium display heading.",
  ),
  token(
    "--discern-font-size-display-lg",
    "2.75rem",
    "Typography",
    "Large display heading.",
  ),
  token(
    "--discern-font-size-display-xl",
    "clamp(2.75rem, 5.4vw, 4.125rem)",
    "Typography",
    "Hero display heading.",
  ),
  token(
    "--discern-font-weight-body",
    "400",
    "Typography",
    "Normal body weight.",
  ),
  token(
    "--discern-font-weight-strong",
    "650",
    "Typography",
    "Strong body and UI weight.",
  ),
  token(
    "--discern-font-weight-display",
    "700",
    "Typography",
    "Display heading weight.",
  ),
  token(
    "--discern-leading-tight",
    "1.08",
    "Typography",
    "Display line height.",
  ),
  token(
    "--discern-leading-snug",
    "1.3",
    "Typography",
    "Compact heading line height.",
  ),
  token("--discern-leading-body", "1.58", "Typography", "Body line height."),
  ...([1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24] as const).map((step) =>
    token(
      `--discern-space-${step}`,
      `${step * 4}px`,
      "Spacing",
      `${step * 4}px spacing step.`,
    )
  ),
  token("--discern-radius-xs", "4px", "Shape", "Fine control radius."),
  token("--discern-radius-sm", "6px", "Shape", "Input radius."),
  token("--discern-radius-md", "8px", "Shape", "Button and card radius."),
  token("--discern-radius-lg", "12px", "Shape", "Window and dialog radius."),
  token(
    "--discern-radius-pill",
    "999px",
    "Shape",
    "Badge and tag pill radius.",
  ),
  token(
    "--discern-duration-fast",
    "150ms",
    "Motion",
    "Hover and press response.",
  ),
  token(
    "--discern-duration-medium",
    "300ms",
    "Motion",
    "Ordinary state transition.",
  ),
  token(
    "--discern-duration-reveal",
    "650ms",
    "Motion",
    "Choreographed reveal.",
  ),
  token(
    "--discern-ease-out",
    "cubic-bezier(0.22, 1, 0.36, 1)",
    "Motion",
    "Primary deceleration curve.",
  ),
  token(
    "--discern-ease-in-out",
    "cubic-bezier(0.65, 0, 0.35, 1)",
    "Motion",
    "Balanced state curve.",
  ),
  token(
    "--discern-page-max",
    "66.25rem",
    "Layout",
    "Maximum editorial page width.",
  ),
  token("--discern-measure", "62ch", "Layout", "Readable prose measure."),
  token(
    "--discern-section-space",
    "clamp(4.5rem, 9vw, 7.75rem)",
    "Layout",
    "Section rhythm.",
  ),
] satisfies readonly DesignToken[];

export const themeTokens = [
  themeToken(
    "--discern-color-ink",
    "oklch(24% 0.03 var(--discern-ink-hue))",
    "oklch(93% 0.012 var(--discern-ink-hue))",
    "Primary ink.",
  ),
  themeToken(
    "--discern-color-ink-muted",
    "oklch(40% 0.026 var(--discern-ink-hue))",
    "oklch(76% 0.016 var(--discern-ink-hue))",
    "Secondary ink.",
  ),
  themeToken(
    "--discern-color-ink-faint",
    "oklch(56% 0.02 var(--discern-ink-hue))",
    "oklch(60% 0.018 var(--discern-ink-hue))",
    "Tertiary ink.",
  ),
  themeToken(
    "--discern-color-canvas",
    "oklch(98.97% 0.0028 var(--discern-canvas-hue))",
    "oklch(20% 0.018 var(--discern-ink-hue))",
    "Page canvas.",
  ),
  themeToken(
    "--discern-color-surface",
    "#fff",
    "oklch(24.5% 0.02 var(--discern-ink-hue))",
    "Raised surface.",
  ),
  themeToken(
    "--discern-color-surface-sunken",
    "oklch(96.5% 0.004 var(--discern-canvas-hue))",
    "oklch(17.5% 0.016 var(--discern-ink-hue))",
    "Inset surface.",
  ),
  themeToken(
    "--discern-color-inverse-surface",
    "oklch(24% 0.03 var(--discern-ink-hue))",
    "oklch(14.5% 0.018 var(--discern-ink-hue))",
    "Stable dark surface for inverse and contrast treatments.",
  ),
  themeToken(
    "--discern-color-inverse-ink",
    "oklch(98.97% 0.0028 var(--discern-canvas-hue))",
    "oklch(98.97% 0.0028 var(--discern-canvas-hue))",
    "Readable light ink on inverse surfaces.",
  ),
  themeToken(
    "--discern-color-accent-100",
    "oklch(96.2% 0.019 var(--discern-accent-hue))",
    "oklch(29% 0.055 var(--discern-accent-hue))",
    "Subtlest accent surface.",
  ),
  themeToken(
    "--discern-color-accent-200",
    "oklch(92% 0.045 var(--discern-accent-hue))",
    "oklch(35% 0.08 var(--discern-accent-hue))",
    "Quiet accent surface.",
  ),
  themeToken(
    "--discern-color-accent-300",
    "oklch(85% 0.082 var(--discern-accent-hue))",
    "oklch(46% 0.115 var(--discern-accent-hue))",
    "Soft accent fill.",
  ),
  themeToken(
    "--discern-color-accent-400",
    "oklch(73% 0.128 var(--discern-accent-hue))",
    "oklch(58% 0.15 var(--discern-accent-hue))",
    "Mid accent fill.",
  ),
  themeToken(
    "--discern-color-accent-500",
    "oklch(61% 0.185 var(--discern-accent-hue))",
    "oklch(67% 0.165 var(--discern-accent-hue))",
    "Strong accent fill.",
  ),
  themeToken(
    "--discern-color-accent-600",
    "oklch(52% 0.208 var(--discern-accent-hue))",
    "oklch(74% 0.14 var(--discern-accent-hue))",
    "Default accent action.",
  ),
  themeToken(
    "--discern-color-accent-700",
    "oklch(44% 0.185 var(--discern-accent-hue))",
    "oklch(82% 0.105 var(--discern-accent-hue))",
    "Strong accent text.",
  ),
  themeToken(
    "--discern-color-accent-800",
    "oklch(34% 0.13 var(--discern-accent-hue))",
    "oklch(90% 0.06 var(--discern-accent-hue))",
    "Deepest accent text.",
  ),
  themeToken(
    "--discern-color-border",
    "oklch(89.5% 0.012 var(--discern-canvas-hue))",
    "oklch(31% 0.022 var(--discern-ink-hue))",
    "Hairline border.",
  ),
  themeToken(
    "--discern-color-border-strong",
    "oklch(81% 0.016 var(--discern-canvas-hue))",
    "oklch(42% 0.026 var(--discern-ink-hue))",
    "Emphasised border.",
  ),
  themeToken(
    "--discern-color-stripe",
    "oklch(85% 0.014 var(--discern-canvas-hue))",
    "oklch(33% 0.022 var(--discern-ink-hue))",
    "Decorative hatch and window-chrome pigment.",
  ),
  themeToken(
    "--discern-color-success",
    "oklch(64% 0.165 152)",
    "oklch(70% 0.155 152)",
    "Successful outcome.",
  ),
  themeToken(
    "--discern-color-success-soft",
    "oklch(95% 0.05 152)",
    "oklch(29% 0.06 152)",
    "Successful outcome surface.",
  ),
  themeToken(
    "--discern-color-success-deep",
    "oklch(37% 0.09 152)",
    "oklch(88% 0.1 152)",
    "Successful outcome text on a tinted surface.",
  ),
  themeToken(
    "--discern-color-warning",
    "oklch(61% 0.14 74)",
    "oklch(76% 0.13 82)",
    "Warning state.",
  ),
  themeToken(
    "--discern-color-warning-soft",
    "oklch(96% 0.045 82)",
    "oklch(30% 0.055 82)",
    "Warning surface.",
  ),
  themeToken(
    "--discern-color-danger",
    "oklch(54% 0.19 28)",
    "oklch(70% 0.17 28)",
    "Danger and invalid state.",
  ),
  themeToken(
    "--discern-color-danger-soft",
    "oklch(96% 0.035 28)",
    "oklch(29% 0.055 28)",
    "Danger surface.",
  ),
  themeToken(
    "--discern-shadow-color",
    "var(--discern-color-ink)",
    "oklch(6% 0.01 var(--discern-ink-hue))",
    "Shadow pigment.",
  ),
  themeToken(
    "--discern-shadow-card",
    "4px 4px 0 color-mix(in oklab, var(--discern-shadow-color) 6%, transparent)",
    "4px 4px 0 color-mix(in oklab, var(--discern-shadow-color) 40%, transparent)",
    "Quiet hard-offset card shadow.",
    "Shape",
  ),
  themeToken(
    "--discern-shadow-window",
    "8px 10px 0 color-mix(in oklab, var(--discern-shadow-color) 6%, transparent)",
    "8px 10px 0 color-mix(in oklab, var(--discern-shadow-color) 40%, transparent)",
    "Hard-offset presentation window shadow.",
    "Shape",
  ),
  themeToken(
    "--discern-shadow-pop",
    "6px 6px 0 color-mix(in oklab, var(--discern-shadow-color) 12%, transparent)",
    "6px 6px 0 color-mix(in oklab, var(--discern-shadow-color) 55%, transparent)",
    "Raised overlay shadow.",
    "Shape",
  ),
  themeToken(
    "--discern-color-overlay",
    "color-mix(in oklab, var(--discern-color-ink) 34%, transparent)",
    "color-mix(in oklab, #000 58%, transparent)",
    "Modal backdrop.",
  ),
] satisfies readonly ThemeToken[];

export const allTokens = [...designTokens, ...themeTokens] as const;
