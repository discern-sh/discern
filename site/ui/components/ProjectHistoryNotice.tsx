/** Frames a decision record as project history rather than product documentation. */
import type { ReactElement } from "react";
import { Kicker } from "discern-design-system/react";

/** A superseded record says so before the reader invests in it. */
export function ProjectHistoryNotice(
  { superseded }: { readonly superseded: boolean },
): ReactElement {
  return (
    <aside className="docs-history-label">
      <Kicker>Project history</Kicker>
      <p>
        {superseded && (
          <>
            <strong className="docs-history-status">Superseded record.</strong>
            {" "}
          </>
        )}
        These records explain why discern was built this way. They are project
        history, not current product documentation; use the{" "}
        <a href="/docs">manual</a> for current instructions.
      </p>
    </aside>
  );
}
