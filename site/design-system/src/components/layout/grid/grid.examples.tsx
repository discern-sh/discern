import { Card } from "../../display/card/card.tsx";
import { Grid } from "./grid.tsx";
export default function GridExamples() {
  return (
    <Grid minimum="10rem" gap={4}>
      {["Lorem", "Ipsum", "Dolor"].map((item) => (
        <Card padding="sm" key={item}>{item}</Card>
      ))}
    </Grid>
  );
}
