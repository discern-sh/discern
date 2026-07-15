import { Container } from "./container.tsx";
export default function ContainerExamples() {
  return (
    <div className="discern-example-stack">
      <Container size="measure">
        <div className="discern-layout-sample">Measure container</div>
      </Container>
      <Container size="md">
        <div className="discern-layout-sample">Medium container</div>
      </Container>
    </div>
  );
}
