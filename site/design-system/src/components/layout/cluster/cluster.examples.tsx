import { Button } from "../../core/button/button.tsx";
import { Cluster } from "./cluster.tsx";
export default function ClusterExamples() {
  return (
    <Cluster gap={3}>
      <Button>Continue</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Cancel</Button>
    </Cluster>
  );
}
