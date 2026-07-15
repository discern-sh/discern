import { Badge } from "./badge.tsx";
export default function BadgeExamples() {
  return (
    <div className="discern-example-row">
      <Badge dot>Accent</Badge>
      <Badge tone="neutral">Neutral</Badge>
      <Badge tone="success">Success</Badge>
      <Badge tone="warning">Warning</Badge>
      <Badge tone="danger">Danger</Badge>
    </div>
  );
}
