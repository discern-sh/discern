/**
 * Discern's process-to-terminal boundary.
 *
 * The design-system CLI graph is pure: callers supply capabilities, theme, and
 * text. This module is the single place that turns process facts into those
 * inputs. Feature renderers consume a {@link TerminalContext}; they do not read
 * environment variables, terminal attachment, or console dimensions directly.
 */

import {
  detectTerminalCapabilities,
  styleText,
  type TerminalCapabilities,
  type TerminalColorTokenName,
  type TerminalSemanticTone,
  type TerminalTextRole,
  type TerminalTextStyle,
  type TerminalTheme,
  terminalThemeColor,
  terminalThemes,
  type TerminalThemeVariant,
  terminalToneColor,
} from "discern-design-system/cli";
import type { EnvReader } from "../shared/env.ts";

const DEFAULT_TERMINAL_COLUMNS = 80;
const DEFAULT_TERMINAL_ROWS = 24;
const CAPABILITY_ENVIRONMENT_KEYS = [
  "TERM",
  "COLORTERM",
  "LC_ALL",
  "LC_CTYPE",
  "LANG",
] as const;
const DIMENSION_ENVIRONMENT_KEYS = ["COLUMNS", "LINES"] as const;
const TERMINAL_ENVIRONMENT_KEYS = [
  ...CAPABILITY_ENVIRONMENT_KEYS,
  ...DIMENSION_ENVIRONMENT_KEYS,
  "NO_COLOR",
] as const;

declare const terminalLineBrand: unique symbol;
declare const terminalMultilineBrand: unique symbol;

/** Control-free product text intended for one terminal line. */
export type TerminalLine = string & { readonly [terminalLineBrand]: true };

/** Control-free product text whose line feeds were explicitly retained. */
export type TerminalMultiline = string & {
  readonly [terminalMultilineBrand]: true;
};

/** A terminal viewport measured in character cells. */
export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

/** Fully explicit process inputs for deterministic terminal adaptation. */
export interface TerminalProcessInput {
  readonly noColor: boolean;
  readonly env: EnvReader;
  readonly isTerminal: () => boolean;
  readonly consoleSize: () => TerminalSize;
  readonly fallbackColumns?: number;
  readonly fallbackRows?: number;
  readonly theme?: TerminalThemeVariant;
}

/** Optional overrides accepted by the stable production constructor. */
export interface ProductionTerminalOptions {
  readonly noColor?: boolean;
  readonly env?: EnvReader;
  readonly isTerminal?: () => boolean;
  readonly consoleSize?: () => TerminalSize;
  readonly fallbackColumns?: number;
  readonly fallbackRows?: number;
  readonly theme?: TerminalThemeVariant;
}

/** Injectable boundaries retained by the terminal-size compatibility facade. */
export interface TerminalSizeOptions {
  readonly env?: EnvReader;
  readonly fallbackColumns?: number;
  readonly fallbackRows?: number;
  readonly consoleSize?: () => TerminalSize;
}

/** Injectable boundaries retained by the terminal-width compatibility facade. */
export interface TerminalWidthOptions {
  readonly env?: EnvReader;
  readonly fallback?: number;
  readonly consoleSize?: () => { readonly columns: number };
}

/**
 * Package presentation facts and small Token-derived styling helpers used by
 * Discern renderers. The effective environment includes a synthetic NO_COLOR
 * entry when the global flag forces colour off.
 */
export interface TerminalContext {
  readonly capabilities: TerminalCapabilities;
  readonly color: boolean;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly size: TerminalSize;
  readonly theme: TerminalTheme;
  readonly themeVariant: TerminalThemeVariant;
  role(text: string, role: TerminalTextRole): string;
  tone(
    text: string,
    tone: TerminalSemanticTone,
    role?: TerminalTextRole,
  ): string;
  token(
    text: string,
    token: TerminalColorTokenName,
    role?: TerminalTextRole,
  ): string;
}

/** Raw affixes retained only for untouched feature renderers crossing in 3A. */
export interface TerminalStyleFragments {
  readonly reset: string;
  readonly strong: string;
  readonly muted: string;
  readonly danger: string;
  readonly success: string;
  readonly warning: string;
  readonly accent: string;
}

/** Resolve one positive integer dimension through observation, env, fallback. */
function resolveDimension(
  observed: number | undefined,
  environment: Readonly<Record<string, string | undefined>>,
  name: "COLUMNS" | "LINES",
  fallback: number,
  conventionalFallback: number,
): number {
  if (Number.isFinite(observed) && (observed ?? 0) > 0) {
    return Math.max(1, Math.floor(observed as number));
  }
  const parsed = Number(environment[name]);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, Math.floor(parsed));
  }
  return Number.isFinite(fallback) && fallback > 0
    ? Math.max(1, Math.floor(fallback))
    : conventionalFallback;
}

/** Read only the requested terminal facts once from an injected reader. */
function environmentSnapshot(
  env: EnvReader,
  keys: readonly string[] = TERMINAL_ENVIRONMENT_KEYS,
): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const name of keys) {
    const value = env.get(name);
    if (value !== undefined && (name !== "NO_COLOR" || value !== "")) {
      snapshot[name] = value;
    }
  }
  return snapshot;
}

/** Observe the console once and degrade to environment/fallback dimensions. */
function resolveSize(
  consoleSize: () => TerminalSize,
  environment: Readonly<Record<string, string | undefined>>,
  fallbackColumns: number,
  fallbackRows: number,
): TerminalSize {
  let observed: TerminalSize | undefined;
  try {
    observed = consoleSize();
  } catch {
    observed = undefined;
  }
  return {
    columns: resolveDimension(
      observed?.columns,
      environment,
      "COLUMNS",
      fallbackColumns,
      DEFAULT_TERMINAL_COLUMNS,
    ),
    rows: resolveDimension(
      observed?.rows,
      environment,
      "LINES",
      fallbackRows,
      DEFAULT_TERMINAL_ROWS,
    ),
  };
}

/** Build Token styling helpers around one immutable presentation snapshot. */
function contextFromFacts(
  capabilities: TerminalCapabilities,
  size: TerminalSize,
  environment: Readonly<Record<string, string | undefined>>,
  themeVariant: TerminalThemeVariant,
): TerminalContext {
  const theme = terminalThemes[themeVariant];
  const styled = (
    text: string,
    style: TerminalTextStyle,
  ): string => styleText(text, style, capabilities);
  return {
    capabilities,
    color: capabilities.colorDepth !== "none",
    environment,
    size,
    theme,
    themeVariant,
    role: (text: string, role: TerminalTextRole): string =>
      styled(text, theme.typography[role]),
    tone: (
      text: string,
      tone: TerminalSemanticTone,
      role: TerminalTextRole = "body",
    ): string =>
      styled(text, {
        ...theme.typography[role],
        color: terminalToneColor(theme, tone),
      }),
    token: (
      text: string,
      token: TerminalColorTokenName,
      role: TerminalTextRole = "body",
    ): string =>
      styled(text, {
        ...theme.typography[role],
        color: terminalThemeColor(theme, token),
      }),
  };
}

/** Resolve one immutable context from explicit, injectable process inputs. */
export function resolveTerminalContext(
  input: TerminalProcessInput,
): TerminalContext {
  const environment = environmentSnapshot(input.env);
  if (input.noColor) environment.NO_COLOR = "1";
  const size = resolveSize(
    input.consoleSize,
    environment,
    input.fallbackColumns ?? DEFAULT_TERMINAL_COLUMNS,
    input.fallbackRows ?? DEFAULT_TERMINAL_ROWS,
  );
  const capabilities = detectTerminalCapabilities({
    env: environment,
    isTty: input.isTerminal(),
    columns: size.columns,
  });
  return contextFromFacts(
    capabilities,
    size,
    environment,
    input.theme ?? "dark",
  );
}

/** Resolve only colour from injected process facts without observing a console. */
export function resolveTerminalColor(
  noColor: boolean,
  env: EnvReader,
  isTerminal: () => boolean,
): boolean {
  return resolveTerminalContext({
    noColor,
    env,
    isTerminal,
    consoleSize: () => ({
      columns: DEFAULT_TERMINAL_COLUMNS,
      rows: DEFAULT_TERMINAL_ROWS,
    }),
  }).color;
}

/** Construct the production context, with every process effect still injectable. */
export function productionTerminalContext(
  options: ProductionTerminalOptions = {},
): TerminalContext {
  return resolveTerminalContext({
    noColor: options.noColor ?? false,
    env: options.env ?? Deno.env,
    isTerminal: options.isTerminal ?? (() => Deno.stdout.isTerminal()),
    consoleSize: options.consoleSize ?? (() => Deno.consoleSize()),
    ...(options.fallbackColumns === undefined
      ? {}
      : { fallbackColumns: options.fallbackColumns }),
    ...(options.fallbackRows === undefined
      ? {}
      : { fallbackRows: options.fallbackRows }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
  });
}

let activeTerminalContext: TerminalContext | undefined;

/** Set or clear the single process context resolved by the CLI entry point. */
export function setTerminalContext(
  context: TerminalContext | undefined,
): void {
  activeTerminalContext = context;
}

/** Return the process context, constructing a stable fallback for direct calls. */
export function terminalContext(): TerminalContext {
  return activeTerminalContext ?? productionTerminalContext();
}

/**
 * Resolve presentation-only compatibility facts without manufacturing a real
 * terminal in a pure renderer. The CLI's active context wins; isolated render
 * tests receive deterministic 80-column Unicode facts.
 */
export function terminalPresentationContext(
  color: boolean,
): TerminalContext {
  const base = activeTerminalContext ?? contextFromFacts(
    { colorDepth: "none", columns: DEFAULT_TERMINAL_COLUMNS, unicode: true },
    { columns: DEFAULT_TERMINAL_COLUMNS, rows: DEFAULT_TERMINAL_ROWS },
    {},
    "dark",
  );
  return terminalContextWithColor(base, color);
}

/**
 * Apply an already-resolved compatibility colour decision without probing the
 * process again. Enabling a context that had no depth uses the package's stable
 * ANSI-16 fallback; production calls normally preserve their detected depth.
 */
export function terminalContextWithColor(
  context: TerminalContext,
  color: boolean,
): TerminalContext {
  const colorDepth = color
    ? context.capabilities.colorDepth === "none"
      ? "ansi16"
      : context.capabilities.colorDepth
    : "none";
  return contextFromFacts(
    { ...context.capabilities, colorDepth },
    context.size,
    context.environment,
    context.themeVariant,
  );
}

/** Extract package-emitted prefixes for the temporary legacy palette facade. */
export function terminalStyleFragments(
  context: TerminalContext,
): TerminalStyleFragments {
  const marker = "terminal-style-affix-probe";
  const affixes = (render: (text: string) => string): {
    readonly prefix: string;
    readonly suffix: string;
  } => {
    const rendered = render(marker);
    const at = rendered.indexOf(marker);
    if (at < 0) {
      throw new TypeError("terminal style renderer did not preserve its text");
    }
    return {
      prefix: rendered.slice(0, at),
      suffix: rendered.slice(at + marker.length),
    };
  };
  const strong = affixes((text) => context.role(text, "strong"));
  const muted = affixes((text) => context.role(text, "muted"));
  const danger = affixes((text) => context.tone(text, "danger"));
  const success = affixes((text) => context.tone(text, "success"));
  const warning = affixes((text) => context.tone(text, "warning"));
  const accent = affixes((text) => context.tone(text, "accent"));
  const suffixes = [
    strong.suffix,
    muted.suffix,
    danger.suffix,
    success.suffix,
    warning.suffix,
    accent.suffix,
  ].filter((suffix) => suffix !== "");
  const reset = suffixes[0] ?? "";
  if (suffixes.some((suffix) => suffix !== reset)) {
    throw new TypeError(
      "package terminal styles use incompatible reset affixes",
    );
  }
  return {
    reset,
    strong: strong.prefix,
    muted: muted.prefix,
    danger: danger.prefix,
    success: success.prefix,
    warning: warning.prefix,
    accent: accent.prefix,
  };
}

/** Resolve both dimensions through the shared process adapter. */
export function terminalSize(
  options: TerminalSizeOptions = {},
): TerminalSize {
  const environment = environmentSnapshot(
    options.env ?? Deno.env,
    DIMENSION_ENVIRONMENT_KEYS,
  );
  return resolveSize(
    options.consoleSize ?? (() => Deno.consoleSize()),
    environment,
    options.fallbackColumns ?? DEFAULT_TERMINAL_COLUMNS,
    options.fallbackRows ?? DEFAULT_TERMINAL_ROWS,
  );
}

/** Resolve the current width through the shared process adapter. */
export function terminalWidth(
  options: TerminalWidthOptions = {},
): number {
  const size = terminalSize({
    ...(options.env === undefined ? {} : { env: options.env }),
    fallbackColumns: options.fallback ?? DEFAULT_TERMINAL_COLUMNS,
    fallbackRows: DEFAULT_TERMINAL_ROWS,
    ...(options.consoleSize === undefined ? {} : {
      consoleSize: (): TerminalSize => ({
        columns: options.consoleSize?.().columns ?? DEFAULT_TERMINAL_COLUMNS,
        rows: DEFAULT_TERMINAL_ROWS,
      }),
    }),
  });
  return size.columns;
}

/** Turn one control code point into a visible, inert representation. */
function visibleControl(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x1f) return String.fromCodePoint(0x2400 + codePoint);
  if (codePoint === 0x7f) return "␡";
  return `<U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}>`;
}

/** Escape controls while optionally retaining normalized line boundaries. */
function inertProductText(value: string, multiline: boolean): string {
  let result = "";
  const characters = [...value];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] ?? "";
    if (multiline && character === "\r" && characters[index + 1] === "\n") {
      result += "\n";
      index += 1;
    } else if (multiline && character === "\n") {
      result += "\n";
    } else if (/[\p{Cc}\p{Cf}]/u.test(character)) {
      result += visibleControl(character);
    } else {
      result += character;
    }
  }
  return result;
}

/** Make untrusted product data safe for a single-line Component prop. */
export function terminalLine(value: string): TerminalLine {
  return inertProductText(value, false) as TerminalLine;
}

/** Make untrusted product data safe while explicitly preserving line feeds. */
export function terminalMultiline(value: string): TerminalMultiline {
  return inertProductText(value, true) as TerminalMultiline;
}
