import { TableOfContents } from "./table-of-contents.tsx";

export default function TableOfContentsExamples() {
  return (
    <TableOfContents
      items={[
        { label: "The starting condition", href: "#starting", current: true },
        { label: "A useful constraint", href: "#constraint" },
        { label: "What changed", href: "#changed" },
        { label: "Notes and sources", href: "#notes" },
      ]}
      progress="12 minute read · 1 of 4"
    />
  );
}
