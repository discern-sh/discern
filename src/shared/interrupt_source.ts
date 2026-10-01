/**
 * Who may interrupt the work running in this async scope.
 *
 * A command that owns its process — the CLI, an MCP call — answers the
 * process's own interrupt signals: SIGINT, SIGTERM and SIGHUP stop its
 * children and end it. Work that runs inside a long-lived session beside
 * other work has a different owner: the session decides when it stops, and
 * hands it an `AbortSignal` for that. A Ctrl+C typed into a foreground child
 * of the same session reaches the whole terminal process group, so a
 * process-signal listener installed for such work would stop it although
 * nobody asked. Under the `operation` source, every interrupt boundary
 * installs no process-signal listener and the operation's signal is the
 * only interrupt; child processes are spawned leading their own process
 * group so a terminal-generated signal never reaches them directly.
 */

import { AsyncLocalStorage } from "./module_loading.ts";

/** The interrupt authorities a scope can answer to. */
export const INTERRUPT_SOURCES = ["process", "operation"] as const;

/** One interrupt authority ({@link INTERRUPT_SOURCES}). */
export type InterruptSource = (typeof INTERRUPT_SOURCES)[number];

const scope = new AsyncLocalStorage<InterruptSource>();

/** The interrupt source of the current scope; the process by default. */
export function currentInterruptSource(): InterruptSource {
  return scope.getStore() ?? "process";
}

/** Run `work` answering only to `source`, including every effect it awaits. */
export async function runWithInterruptSource<T>(
  source: InterruptSource,
  work: () => Promise<T>,
): Promise<T> {
  return await scope.run(source, work);
}

/**
 * Whether a child spawned now must lead its own process group: always when
 * the caller asks, and whenever the operation is the only interrupt, so a
 * signal the terminal sends its foreground group cannot reach the child.
 */
export function childLeadsOwnGroup(requested: boolean): boolean {
  return Deno.build.os !== "windows" &&
    (requested || currentInterruptSource() === "operation");
}

/**
 * Refuse a child that inherits the terminal while the current work answers
 * only to its operation: such work runs beside a screen another owner draws,
 * so it may hand the terminal to nobody.
 */
export function assertTerminalOwnerAllowed(what: string): void {
  if (currentInterruptSource() === "operation") {
    throw new TypeError(
      `${what} needs the terminal, but this work runs beside a live screen that owns it. Run it as a foreground command of the session instead.`,
    );
  }
}
