/** The row of coding agents discern works with, under the pool's facts. */
import type { CSSProperties, ReactElement } from "react";
import type { WallAgent } from "./host.ts";

/** The words that label the row. */
export const WORKS_WITH_LABEL = "Works with your coding agent";

/** The id of those words, which name the list of marks. */
const WORKS_WITH_LABEL_ID = "wall-agents-label";

/**
 * The inline style that hands one agent's mark to the stylesheet as
 * `--wall-agent-mark`. The stylesheet draws the mark through a mask in the
 * room's own ink, so the vendor's file is never recolored.
 */
function agentMarkStyle(
  agent: WallAgent,
): CSSProperties & Record<"--wall-agent-mark", string> {
  return { "--wall-agent-mark": `url("${agent.mark}")` };
}

/**
 * One mark per agent, in the order the server gave. A mark is a picture with
 * no words beside it, so each carries its agent's name for assistive
 * technology and as its tooltip.
 */
export function WorksWith(
  { agents }: { readonly agents: readonly WallAgent[] },
): ReactElement {
  return (
    <div className="wall-agents">
      <p id={WORKS_WITH_LABEL_ID}>{WORKS_WITH_LABEL}</p>
      <ul
        className="wall-agents-list"
        role="list"
        aria-labelledby={WORKS_WITH_LABEL_ID}
      >
        {agents.map((agent) => (
          <li key={agent.mark}>
            <span
              className="wall-agent"
              role="img"
              aria-label={agent.label}
              title={agent.label}
              style={agentMarkStyle(agent)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
