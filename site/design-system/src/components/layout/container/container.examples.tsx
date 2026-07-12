import { Container } from "./container.tsx";
export default function ContainerExamples() {
  return (
    <div className="ds-example-stack">
      <Container size="measure">
        <div className="ds-layout-sample">Measure container</div>
      </Container>
      <Container size="md">
        <div className="ds-layout-sample">Medium container</div>
      </Container>
    </div>
  );
}
