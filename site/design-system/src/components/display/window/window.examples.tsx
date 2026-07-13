import { fixtureCopy } from "../../../fixtures/content.ts";
import { Window } from "./window.tsx";
export default function WindowExamples() {
  return (
    <Window title="lorem — ipsum">
      <div className="ds-example-window-body">
        <span className="ds-kicker">Example content</span>
        <h4>{fixtureCopy.heading}</h4>
        <p>{fixtureCopy.paragraph}</p>
      </div>
    </Window>
  );
}
