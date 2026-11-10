/** The tuning panel: a development aid for adjusting the wall in place. */
import { type ReactElement, useState } from "react";
import { WALL_KNOBS, type WallKnobName, type WallKnobValues } from "./knobs.ts";

export interface PanelProps {
  /** The current value of every knob. */
  readonly values: WallKnobValues;
  /** Called with one knob's new value as its control moves. */
  readonly onChange: (name: WallKnobName, value: number) => void;
  /** Called when the visitor asks for every default back. */
  readonly onReset: () => void;
}

/**
 * Whether a URL's query string asks for the panel: a `tune` parameter, with or
 * without a value. The wall asks this only after it has mounted in the browser,
 * so the panel never appears in server markup.
 */
export function tuningRequested(search: string): boolean {
  return new URLSearchParams(search).has("tune");
}

/** What the last "Copy settings" came to, shown on the button itself. */
const COPY_LABELS = {
  idle: "Copy settings",
  copied: "Copied",
  failed: "Copy failed",
} as const;

/**
 * One range control per knob, plus "Copy settings" (the values as JSON) and
 * "Reset". The panel holds no knob state of its own: it shows `values` and
 * reports every edit through `onChange` and `onReset`.
 */
export function Panel(
  { values, onChange, onReset }: PanelProps,
): ReactElement {
  const [copy, setCopy] = useState<keyof typeof COPY_LABELS>("idle");
  // The handler returns its promise, settled either way, to the event system.
  const copySettings = (): Promise<void> =>
    navigator.clipboard.writeText(JSON.stringify(values, null, 2)).then(
      () => setCopy("copied"),
      () => setCopy("failed"),
    );
  return (
    <details className="wall-tune" open>
      <summary className="wall-tune-summary">Tuning</summary>
      <div className="wall-tune-rows">
        {WALL_KNOBS.map((knob) => (
          <label className="wall-tune-row" key={knob.name}>
            <span>{knob.label}</span>
            <input
              type="range"
              min={knob.min}
              max={knob.max}
              step={knob.step}
              value={values[knob.name]}
              onChange={(event) =>
                onChange(knob.name, event.currentTarget.valueAsNumber)}
            />
            <output>{`${values[knob.name]}${knob.unit}`}</output>
          </label>
        ))}
        <div className="wall-tune-actions">
          <button type="button" onClick={copySettings}>
            {COPY_LABELS[copy]}
          </button>
          <button
            type="button"
            onClick={() => {
              setCopy("idle");
              onReset();
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </details>
  );
}
