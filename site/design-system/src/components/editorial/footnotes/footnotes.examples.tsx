import { Footnotes } from "./footnotes.tsx";

export default function FootnotesExamples() {
  return (
    <Footnotes
      items={[
        {
          id: "example-note-1",
          content: (
            <p>The example uses illustrative rather than measured results.</p>
          ),
        },
        {
          id: "example-note-2",
          content: <p>Dates and contributor names are neutral fixtures.</p>,
        },
      ]}
    />
  );
}
