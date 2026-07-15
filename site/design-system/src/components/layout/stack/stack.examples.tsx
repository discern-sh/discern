import { Stack } from "./stack.tsx";
export default function StackExamples() {
  return (
    <Stack gap={3}>
      {["Lorem", "Ipsum", "Dolor"].map((item) => (
        <div className="discern-layout-sample" key={item}>{item}</div>
      ))}
    </Stack>
  );
}
