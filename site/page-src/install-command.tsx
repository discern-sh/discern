/**
 * The one-line install moment, shared by every landing surface. The command
 * matches the served /install endpoint, and landing.js upgrades any
 * [data-copy-command] host with a copy control.
 */

export const INSTALL_COMMAND = "curl -fsSL https://discern.sh/install | sh";
export const SETUP_SENTENCE = "Set this project up with discern.";

/** The install command with a progressive-enhancement copy slot. */
export function InstallCommand() {
  return (
    <p className="landing-install" data-copy-command={INSTALL_COMMAND}>
      <code className="landing-install__command">{INSTALL_COMMAND}</code>
    </p>
  );
}
