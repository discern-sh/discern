/**
 * Discern's one effect adapter for the package-owned inline-frame painter.
 * Callers provide already-resolved terminal facts and a write port; cursor
 * replacement remains entirely inside the design-system implementation.
 */

import type { TerminalCapabilities } from "discern-design-system/cli";
import {
  InlineFramePainter,
  type TerminalIO,
} from "discern-design-system/cli/interactive";
import type { TerminalSize } from "./terminal.ts";

/** The effect and terminal facts needed by an inline frame. */
export interface TerminalPainterPort {
  readonly write: (value: string) => void;
  readonly size: () => TerminalSize;
  readonly capabilities: () => TerminalCapabilities;
}

/** Adapt Discern's explicit port to the package interaction contract. */
class PainterTerminalIO implements TerminalIO {
  constructor(private readonly port: TerminalPainterPort) {}

  isInteractive(): boolean {
    return true;
  }

  capabilities(): TerminalCapabilities {
    return this.port.capabilities();
  }

  size(): TerminalSize {
    return this.port.size();
  }

  read(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }

  setRawMode(_enabled: boolean): void {}

  write(value: string): void {
    this.port.write(value);
  }
}

/** Construct the package painter behind Discern's single terminal IO adapter. */
export function createInlineFramePainter(
  port: TerminalPainterPort,
): InlineFramePainter {
  return new InlineFramePainter(new PainterTerminalIO(port));
}

export type { InlineFramePainter };
