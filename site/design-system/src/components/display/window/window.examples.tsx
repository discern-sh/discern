import { fixtureCopy } from "../../../fixtures/content.ts";
import { Kicker } from "../kicker/kicker.tsx";
import { Window } from "./window.tsx";
export default function WindowExamples() {
  return (
    <Window title="lorem — ipsum">
      <div className="discern-example-window-body">
        <Kicker>Example content</Kicker>
        <h4>{fixtureCopy.heading}</h4>
        <p>{fixtureCopy.paragraph}</p>
      </div>
    </Window>
  );
}
