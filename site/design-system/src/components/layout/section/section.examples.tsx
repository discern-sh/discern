import { Container } from "../container/container.tsx";
import { Section } from "./section.tsx";
export default function SectionExamples() {
  return (
    <div className="discern-section-demo">
      <Section surface="sunken" spacing="sm">
        <Container size="sm">
          <strong>Lorem ipsum section</strong>
        </Container>
      </Section>
      <Section surface="surface" spacing="sm">
        <Container size="sm">
          <strong>Consectetur section</strong>
        </Container>
      </Section>
    </div>
  );
}
