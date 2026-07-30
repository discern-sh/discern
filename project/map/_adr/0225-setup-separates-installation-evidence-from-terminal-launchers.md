# ADR 0225: Setup separates installation evidence from terminal launchers

**Status**: accepted; amends [ADR 0069](0069-agent-auto-detect-at-setup.md), preserves the identity boundary in [ADR 0166](0166-agent-identity-is-advisory-logbook-evidence.md), and extends the typed provider registry in [ADR 0031](0031-typed-provider-integration.md)

## Context

ADR 0069 made a provider's terminal-agent binaries do two jobs: tell fresh setup whether the provider was installed and tell the desk whether it had a process it could launch. Those facts coincide for terminal-first agents. They do not coincide for an IDE that ships its terminal agent separately.

Cursor exposes the split. A user can install and run the Cursor IDE without installing `cursor-agent`. The editor may have a `cursor` shell command, but that command opens the editor; it is not the terminal-agent launcher the desk can run as an interactive child. On macOS and Windows, the IDE can also be present at its application location without either command on the invoking shell's `PATH`. Setup therefore omitted Cursor while running inside Cursor itself.

Invocation identity cannot fill the gap. `CURSOR_AGENT`, process ancestry, and MCP client metadata answer what may be driving one invocation, not what the machine has installed. ADR 0166 permanently limits that mutable evidence to the advisory logbook.

## Decision

The provider registry owns two separate declarations:

- `binaries` remains the non-empty match-any list of terminal-agent launchers. The desk uses it for live launch availability. Fresh setup also accepts one of these binaries as installation evidence.
- Required `setupPresence` adds setup-only editor commands and operating-system-specific filesystem markers. These signals prove an IDE installation but never make the desk treat that editor command as a terminal-agent launcher.

Fresh setup's `detectInstalledAgents` iterates every native provider and matches any terminal launcher, additional editor command, or filesystem marker. It runs once when the user did not name agents, persists the result to `[project].agents`, and falls back to `DEFAULT_AGENTS` only when no provider is found. The existing `detectAgentBinariesOnPath` remains the desk's narrower launcher scan.

Filesystem markers can be absolute or relative to a named environment location such as `HOME` or `LOCALAPPDATA`. The registry supplies the operating system and path segments; the detector contains no provider-name switch. Cursor declares its `cursor` editor command plus conventional macOS, Windows, and Linux application locations. A nonstandard or portable installation remains explicitly configurable through `[project].agents`.

No process marker, MCP metadata, parent-process inspection, or inferred current editor participates. Installation detection answers machine availability only; invocation identity remains advisory logbook evidence only.

## Consequences

- A fresh setup can wire Cursor when only the editor is installed, including the common case where setup runs from its integrated terminal.
- The desk never mistakes `cursor` for `cursor-agent`; it offers only a terminal process it knows how to launch.
- A future IDE-first provider must account for setup presence explicitly. Registry-driven tests enroll every filesystem marker and prove an unrelated future provider can add one without detector wiring.
- Filesystem probes are deliberately conventional, not exhaustive. Portable apps and custom install roots can be invisible, so explicit configuration remains the truthful fallback.
- ADR 0069's detect-once-and-persist rule stays intact. Only the evidence set broadens.

## Alternatives considered

- **Add `cursor` to `binaries`.** Rejected: the desk would treat an editor-opening command as a terminal-agent launcher and attach terminal-agent arguments to the wrong program.
- **Detect the current editor from environment or MCP metadata.** Rejected: inherited or spoofed invocation evidence is not installation evidence, and using it would violate ADR 0166's permanent product-steering boundary.
- **Special-case Cursor in setup.** Rejected: the next IDE-first provider would recreate the defect. Provider-declared evidence makes the class complete and future additions fail toward the right seam.
- **Probe running processes.** Rejected: setup must also work before the IDE is running, process inspection is less portable, and one running process says nothing reliable about the project's intended agent set.
