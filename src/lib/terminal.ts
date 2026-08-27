/**
 * Discern's process-to-terminal boundary.
 *
 * The design-system CLI graph is pure: callers supply capabilities, theme, and
 * text. This module is the single place that turns process facts into those
 * inputs. Feature renderers consume a {@link TerminalContext}; they do not read
 * environment variables, terminal attachment, or console dimensions directly.
 */

import {
  type CliPresenter,
  createCliPresenter,
  detectTerminalCapabilities,
  DISCERN_TERMINAL_MOTIF,
  styleText,
  type TerminalCapabilities,
  type TerminalColor,
  type TerminalColorTokenName,
  type TerminalMotif,
  type TerminalSemanticTone,
  type TerminalTextRole,
  type TerminalTextStyle,
  type TerminalTheme,
  terminalThemeColor,
  terminalThemes,
  type TerminalThemeVariant,
  terminalToneColor,
} from "discern-design-system/cli";
import {
  DenoTerminalIO,
  senseTerminalBackground,
  type TerminalBackgroundOptions,
  type TerminalBackgroundReading,
} from "discern-design-system/cli/interactive";
import type { EnvReader } from "../shared/env.ts";

const DEFAULT_TERMINAL_COLUMNS = 80;
const DEFAULT_TERMINAL_ROWS = 24;
/** Maximum startup delay when an interactive terminal does not answer OSC 11. */
export const TERMINAL_BACKGROUND_TIMEOUT_MS = 100;
/** Root-level terminal theme modes, ordered with the default first. */
export const TERMINAL_THEME_MODES = ["auto", "light", "dark"] as const;
export type TerminalThemeMode = typeof TERMINAL_THEME_MODES[number];
export const DEFAULT_TERMINAL_THEME_MODE: TerminalThemeMode = "auto";
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
  "COLORFGBG",
  "NO_COLOR",
  "CI",
] as const;

declare const terminalLineBrand: unique symbol;
declare const terminalMultilineBrand: unique symbol;

/** Product text with no raw control, format, line-, or paragraph-separator. */
export type TerminalLine = string & { readonly [terminalLineBrand]: true };

/** Product text whose only raw boundaries are deliberately admitted line feeds. */
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

/** Optional overrides accepted by a synchronous process snapshot. */
export interface TerminalProcessOptions {
  readonly noColor?: boolean;
  readonly env?: EnvReader;
  readonly isTerminal?: () => boolean;
  readonly consoleSize?: () => TerminalSize;
  readonly fallbackColumns?: number;
  readonly fallbackRows?: number;
  readonly theme?: TerminalThemeVariant;
}

/** Optional overrides accepted by the adaptive production constructor. */
export interface ProductionTerminalOptions {
  readonly noColor?: boolean;
  readonly env?: EnvReader;
  readonly isTerminal?: () => boolean;
  readonly inputIsTerminal?: () => boolean;
  readonly consoleSize?: () => TerminalSize;
  readonly fallbackColumns?: number;
  readonly fallbackRows?: number;
  /** `auto` senses the terminal ground; explicit variants skip sensing. */
  readonly theme?: TerminalThemeMode;
  /** False for result projections and other modes that render no theme. */
  readonly backgroundSensing?: boolean;
  /** Injectable terminal effects boundary for deterministic sensor tests. */
  readonly backgroundIo?: TerminalBackgroundOptions["io"];
}

/** Injectable package background sensor used by a process-cached resolver. */
export type TerminalBackgroundSensor = (
  options: TerminalBackgroundOptions,
) => Promise<TerminalBackgroundReading>;
type TerminalIo = TerminalBackgroundOptions["io"];

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
  /** Package renderer bound to this process snapshot's capabilities and theme. */
  readonly presenter: CliPresenter;
  readonly color: boolean;
  /** Whether stdout was attached when this process snapshot was resolved. */
  readonly stdoutIsTerminal: boolean;
  /** Whether the conventional CI marker requests static human output. */
  readonly ciRequestsStaticOutput: boolean;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly size: TerminalSize;
  readonly theme: TerminalTheme;
  readonly themeVariant: TerminalThemeVariant;
  /** Product motif passed unchanged to effectful package interactions. */
  readonly motif: TerminalMotif;
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

/** Lazily-bound terminal IO retained privately for each presentation context. */
const interactionIoByContext = new WeakMap<
  TerminalContext,
  () => TerminalIo
>();

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
        // discern-best-effort: terminal-viewport-sample-fallback
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
      // discern-best-effort: terminal-environment-read-fallback
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
    // discern-best-effort: terminal-size-read-fallback
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
  interactionIo?: () => TerminalIo,
): TerminalContext {
  const theme = terminalThemes[themeVariant];
  const presenter = createCliPresenter(capabilities, {
    motif: DISCERN_TERMINAL_MOTIF,
    theme: themeVariant,
    width: size.columns,
  });
  const styled = (
    text: string,
    style: TerminalTextStyle,
  ): string => styleText(text, style, capabilities);
  const context: TerminalContext = {
    capabilities,
    presenter,
    color: capabilities.colorDepth !== "none",
    stdoutIsTerminal,
    ciRequestsStaticOutput: enabledEnvironmentMarker(environment.CI),
    environment,
    size,
    theme,
    themeVariant,
    motif: DISCERN_TERMINAL_MOTIF,
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
  if (interactionIo !== undefined) {
    interactionIoByContext.set(context, interactionIo);
  }
  return context;
}

interface ResolvedTerminalFacts {
  readonly capabilities: TerminalCapabilities;
  readonly consoleSize: () => TerminalSize;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly size: TerminalSize;
  readonly stdoutIsTerminal: boolean;
}

/** Resolve process facts once so asynchronous theme selection never re-reads them. */
function resolveTerminalFacts(
  input: Omit<TerminalProcessInput, "theme">,
): ResolvedTerminalFacts {
  const environment = environmentSnapshot(input.env);
  if (input.noColor) environment.NO_COLOR = "1";
  const stdoutIsTerminal = input.isTerminal();
  const size = resolveSize(
    input.consoleSize,
    environment,
    input.fallbackColumns ?? DEFAULT_TERMINAL_COLUMNS,
    input.fallbackRows ?? DEFAULT_TERMINAL_ROWS,
  );
  return {
    capabilities: detectTerminalCapabilities({
      env: environment,
      isTty: stdoutIsTerminal,
      columns: size.columns,
    }),
    consoleSize: input.consoleSize,
    environment,
    size,
    stdoutIsTerminal,
  };
}

/** Bind one theme variant to an already-resolved process snapshot. */
function contextFromResolvedFacts(
  facts: ResolvedTerminalFacts,
  theme: TerminalThemeVariant,
  interactionIo?: () => TerminalIo,
): TerminalContext {
  return contextFromFacts(
    facts.capabilities,
    facts.size,
    facts.environment,
    theme,
    facts.stdoutIsTerminal,
    () => viewportObservation(facts.size, facts.consoleSize),
    interactionIo,
  );
}

/** Whether an untrusted flag value names one supported terminal theme mode. */
export function isTerminalThemeMode(
  value: unknown,
): value is TerminalThemeMode {
  return typeof value === "string" &&
    (TERMINAL_THEME_MODES as readonly string[]).includes(value);
}

/** Resolve one immutable context from explicit, injectable process inputs. */
export function resolveTerminalContext(
  input: TerminalProcessInput,
): TerminalContext {
  return contextFromResolvedFacts(
    resolveTerminalFacts(input),
    input.theme ?? "dark",
  );
}

/** Snapshot the process without background sensing for synchronous fallbacks. */
export function terminalProcessContext(
  options: TerminalProcessOptions = {},
  env: EnvReader = options.env ?? Deno.env,
): TerminalContext {
  return resolveTerminalContext({
    noColor: options.noColor ?? false,
    env,
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

/** Call the package-owned sensor at Discern's sole process boundary. */
async function packageBackgroundSensor(
  options: TerminalBackgroundOptions,
): Promise<TerminalBackgroundReading> {
  return await senseTerminalBackground(options);
}

/** Convert a sensed ground into Discern's fallback-stable theme policy. */
function themeFromBackground(
  reading: TerminalBackgroundReading,
): TerminalThemeVariant {
  return reading.ground === "light" ? "light" : "dark";
}

/** Construct package terminal IO only at Discern's process-effects boundary. */
function createPackageTerminalIo(
  environment: Readonly<Record<string, string | undefined>>,
): TerminalIo {
  return new DenoTerminalIO({ environment });
}

/**
 * Build an adaptive constructor whose first eligible sensing verdict is reused
 * for the process. Explicit variants and non-rendering/non-TTY modes never fill
 * the cache, so they also never invoke the sensor.
 */
export function createProductionTerminalContextResolver(
  sensor: TerminalBackgroundSensor,
): (options?: ProductionTerminalOptions) => Promise<TerminalContext> {
  let sensedTheme: Promise<TerminalThemeVariant> | undefined;
  let processIo: TerminalIo | undefined;
  return async (
    options: ProductionTerminalOptions = {},
    env: EnvReader = options.env ?? Deno.env,
  ): Promise<TerminalContext> => {
    const facts = resolveTerminalFacts({
      noColor: options.noColor ?? false,
      env,
      isTerminal: options.isTerminal ?? (() => Deno.stdout.isTerminal()),
      consoleSize: options.consoleSize ?? (() => Deno.consoleSize()),
      ...(options.fallbackColumns === undefined
        ? {}
        : { fallbackColumns: options.fallbackColumns }),
      ...(options.fallbackRows === undefined
        ? {}
        : { fallbackRows: options.fallbackRows }),
    });
    const mode = options.theme ?? DEFAULT_TERMINAL_THEME_MODE;
    const interactionIo = (): TerminalIo => {
      processIo ??= options.backgroundIo ??
        createPackageTerminalIo(facts.environment);
      return processIo;
    };
    if (mode !== "auto") {
      return contextFromResolvedFacts(facts, mode, interactionIo);
    }

    const maySense = options.backgroundSensing !== false &&
      facts.stdoutIsTerminal &&
      facts.capabilities.colorDepth !== "none" &&
      !enabledEnvironmentMarker(facts.environment.CI) &&
      (options.inputIsTerminal ?? (() => Deno.stdin.isTerminal()))();
    if (!maySense) {
      return contextFromResolvedFacts(facts, "dark", interactionIo);
    }

    sensedTheme ??= sensor({
      io: interactionIo(),
      environment: facts.environment,
      timeoutMs: TERMINAL_BACKGROUND_TIMEOUT_MS,
    }).then(themeFromBackground, () => {
      // discern-best-effort: terminal-background-sense-fallback
      return "dark";
    });
    return contextFromResolvedFacts(facts, await sensedTheme, interactionIo);
  };
}

const resolveProductionTerminalContext =
  createProductionTerminalContextResolver(packageBackgroundSensor);

/** Construct the cached adaptive context used by the CLI process. */
export async function productionTerminalContext(
  options: ProductionTerminalOptions = {},
): Promise<TerminalContext> {
  return await resolveProductionTerminalContext(options);
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
  return activeTerminalContext ?? terminalProcessContext();
}

/** Return the IO identity shared by background sensing and package requests. */
export function terminalInteractionIo(
  context: TerminalContext = terminalContext(),
): TerminalIo {
  let resolveIo = interactionIoByContext.get(context);
  if (resolveIo === undefined) {
    let io: TerminalIo | undefined;
    resolveIo = (): TerminalIo => {
      io ??= createPackageTerminalIo(context.environment);
      return io;
    };
    interactionIoByContext.set(context, resolveIo);
  }
  return resolveIo();
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

/**
 * Rebind an explicit live viewport to an existing presentation context.
 * Capability, theme, motif, and interaction identity are preserved; no process
 * fact is read. Complete-frame views use this after their orchestration layer
 * samples the terminal dimensions.
 */
export function terminalContextAtSize(
  context: TerminalContext,
  size: TerminalSize,
): TerminalContext {
  const columns = Number.isFinite(size.columns)
    ? Math.max(1, Math.floor(size.columns))
    : 1;
  const rows = Number.isFinite(size.rows)
    ? Math.max(1, Math.floor(size.rows))
    : 1;
  return contextFromFacts(
    { ...context.capabilities, columns },
    { columns, rows },
    context.environment,
    context.themeVariant,
    context.stdoutIsTerminal,
    context.observeViewport,
    interactionIoByContext.get(context),
  );
}

/** Rebind only the live viewport column for package painters that resize after
 * the process presenter was constructed. Component renderers use the bound
 * presenter and explicit width props instead. */
export function terminalCapabilitiesAtWidth(
  capabilities: TerminalCapabilities,
  width: number,
): TerminalCapabilities {
  const finite = Number.isFinite(width) ? Math.floor(width) : 1;
  return { ...capabilities, columns: Math.max(1, finite) };
}

/** Resolve both dimensions through the shared process adapter. */
export function terminalSize(
  options: TerminalSizeOptions = {},
  env: EnvReader = options.env ?? Deno.env,
): TerminalSize {
  const environment = environmentSnapshot(
    env,
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

/**
 * Every raw code point that can control, format, or transport terminal line
 * structure. Cc covers C0/C1 (including CR, LF, VT, FF, and NEL); Cf covers
 * invisible format and bidi controls; Zl and Zp are Unicode's line and
 * paragraph separators.
 */
const INERT_TERMINAL_CODE_POINT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Turn one inert code point into a visible representation. */
function visibleInertCodePoint(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x1f) return String.fromCodePoint(0x2400 + codePoint);
  if (codePoint === 0x7f) return "␡";
  return `<U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}>`;
}

/**
 * Make product text inert before it reaches a terminal Component. Single-line
 * mode makes every Cc, Cf, Zl, and Zp code point visible. Multiline mode first
 * admits CRLF as one LF and retains lone LF; lone CR and every other member of
 * the inert class remain visible. Every other Unicode scalar is preserved.
 */
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
    } else if (INERT_TERMINAL_CODE_POINT.test(character)) {
      result += visibleInertCodePoint(character);
    } else {
      result += character;
    }
  }
  return result;
}

/** Make product data safe for one line by admitting no raw line boundary. */
export function terminalLine(value: string): TerminalLine {
  return inertProductText(value, false) as TerminalLine;
}

/** Make product data safe while admitting only LF and CRLF-normalized-to-LF. */
export function terminalMultiline(value: string): TerminalMultiline {
  return inertProductText(value, true) as TerminalMultiline;
}
