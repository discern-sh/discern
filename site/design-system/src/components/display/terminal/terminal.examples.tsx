import { Terminal } from "./terminal.tsx";

export default function TerminalExamples() {
  return (
    <Terminal title="~/discern — verify">
      <span className="discern-terminal__prompt">$</span> deno task verify{"\n"}
      <span className="discern-terminal__muted">
        Check formatting, types, catalogue, and tests
      </span>
      {"\n"}
      <span className="discern-terminal__success">✓</span> 18 tests passed{"\n"}
      <span className="discern-terminal__prompt">$</span>
      {" "}
    </Terminal>
  );
}
