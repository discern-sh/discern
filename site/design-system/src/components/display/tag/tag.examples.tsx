import { Tag } from "./tag.tsx";
export default function TagExamples() {
  return (
    <div className="ds-example-row">
      <Tag>Lorem</Tag>
      <Tag onRemove={() => undefined} removeLabel="Remove ipsum">Ipsum</Tag>
      <Tag>Dolor sit amet</Tag>
    </div>
  );
}
