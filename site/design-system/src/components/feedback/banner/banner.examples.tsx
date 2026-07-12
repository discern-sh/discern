import { ExampleIcon } from "../../../fixtures/example-icon.tsx";
import { Banner } from "./banner.tsx";
export default function BannerExamples() {
  return (
    <div className="ds-example-stack">
      <Banner icon={<ExampleIcon name="info" />}>
        Lorem ipsum dolor sit amet.
      </Banner>
      <Banner tone="accent">Consectetur adipiscing elit.</Banner>
      <Banner tone="success" icon={<ExampleIcon name="check" />}>
        Integer posuere erat a ante.
      </Banner>
      <Banner tone="warning">Vestibulum id ligula porta felis.</Banner>
      <Banner tone="danger">Donec ullamcorper nulla non metus.</Banner>
    </div>
  );
}
