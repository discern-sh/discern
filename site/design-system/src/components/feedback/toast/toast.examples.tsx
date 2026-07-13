import { ExampleIcon } from "../../../fixtures/example-icon.tsx";
import { Toast } from "./toast.tsx";
export default function ToastExamples() {
  return (
    <div className="ds-example-stack ds-example-stack--start">
      <Toast>Lorem ipsum dolor sit amet.</Toast>
      <Toast
        tone="success"
        icon={<ExampleIcon name="check" />}
        onDismiss={() => undefined}
      >
        Consectetur adipiscing elit.
      </Toast>
      <Toast tone="danger">Integer posuere erat a ante.</Toast>
    </div>
  );
}
