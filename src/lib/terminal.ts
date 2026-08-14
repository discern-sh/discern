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
  type TerminalColor,
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
  "CI",
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

/** A bounded live viewport observation owned by one command invocation. */
export interface TerminalViewportObservation {
  /** Sample the current terminal dimensions, or the last supported reading. */
  sample(): TerminalSize;
  /** Permanently detach this observation from its process reader. */
  close(): void;
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
  /** Whether stdout was attached when this process snapshot was resolved. */
  readonly stdoutIsTerminal: boolean;
  /** Whether the conventional CI marker requests static human output. */
  readonly ciRequestsStaticOutput: boolean;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly size: TerminalSize;
  readonly theme: TerminalTheme;
  readonly themeVariant: TerminalThemeVariant;
  /** Open one command-owned live viewport observation. Pure views never call it. */
  observeViewport(): TerminalViewportObservation;
  /** Apply one explicit package text style under these resolved capabilities. */
  style(text: string, style: TerminalTextStyle): string;
  /** Resolve one package Token colour for a Component prop. */
  themeColor(token: TerminalColorTokenName): TerminalColor;
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

/** Normalize one observed dimension without consulting mutable environment state. */
function observedDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

/**
 * Bind a live reader to one initial snapshot. Sampling owns no timer or signal;
 * the command controller decides when to sample and always closes the handle.
 */
function viewportObservation(
  initial: TerminalSize,
  consoleSize: () => TerminalSize,
): TerminalViewportObservation {
  let current = initial;
  let closed = false;
  return {
    sample: (): TerminalSize => {
      if (closed) return current;
      try {
        const observed = consoleSize();
        current = {
          columns: observedDimension(observed.columns, current.columns),
          rows: observedDimension(observed.rows, current.rows),
        };
      } catch {
        // A platform without live size support retains its stable snapshot.
      }
      return current;
    },
    close: (): void => {
      closed = true;
    },
  };
}

/** Interpret the conventional process marker once at the shared boundary. */
function enabledEnvironmentMarker(value: string | undefined): boolean {
  const marker = value?.trim().toLowerCase();
  return marker !== undefined && marker !== "" && marker !== "false";
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
    let value: string | undefined;
    try {
      value = env.get(name);
    } catch {
      // Sandboxed commands may grant only a subset of terminal variables. An
      // unavailable fact degrades exactly like an unset one at this boundary.
      value = undefined;
    }
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
  stdoutIsTerminal: boolean,
  observeViewport: () => TerminalViewportObservation,
): TerminalContext {
  const theme = terminalThemes[themeVariant];
  const styled = (
    text: string,
    style: TerminalTextStyle,
  ): string => styleText(text, style, capabilities);
  return {
    capabilities,
    color: capabilities.colorDepth !== "none",
    stdoutIsTerminal,
    ciRequestsStaticOutput: enabledEnvironmentMarker(environment.CI),
    environment,
    size,
    theme,
    themeVariant,
    observeViewport,
    style: styled,
    themeColor: (token: TerminalColorTokenName): TerminalColor =>
      terminalThemeColor(theme, token),
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
  const stdoutIsTerminal = input.isTerminal();
  const size = resolveSize(
    input.consoleSize,
    environment,
    input.fallbackColumns ?? DEFAULT_TERMINAL_COLUMNS,
    input.fallbackRows ?? DEFAULT_TERMINAL_ROWS,
  );
  const capabilities = detectTerminalCapabilities({
    env: environment,
    isTty: stdoutIsTerminal,
    columns: size.columns,
  });
  return contextFromFacts(
    capabilities,
    size,
    environment,
    input.theme ?? "dark",
    stdoutIsTerminal,
    () => viewportObservation(size, input.consoleSize),
  );
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
    {
      ansiControl: false,
      colorDepth: "none",
      columns: DEFAULT_TERMINAL_COLUMNS,
      unicode: true,
    },
    { columns: DEFAULT_TERMINAL_COLUMNS, rows: DEFAULT_TERMINAL_ROWS },
    {},
    "dark",
    false,
    () =>
      viewportObservation(
        { columns: DEFAULT_TERMINAL_COLUMNS, rows: DEFAULT_TERMINAL_ROWS },
        () => ({
          columns: DEFAULT_TERMINAL_COLUMNS,
          rows: DEFAULT_TERMINAL_ROWS,
        }),
      ),
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
    context.stdoutIsTerminal,
    context.observeViewport,
  );
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
