import { Button } from "../../core/button/button.tsx";
import { CaseStudy } from "./case-study.tsx";

export default function CaseStudyExamples() {
  return (
    <CaseStudy
      eyebrow="Customer story · Northstar"
      title="From recurring surprises to a reviewable release habit."
      summary={
        <p>
          A growing product team replaced a patchwork of project-specific checks
          with one understandable path to done.
        </p>
      }
      body={
        <p>
          The team kept its existing tools and added a thin shared layer that
          made expectations and evidence travel together.
        </p>
      }
      stats={[
        { value: "42%", label: "less review rework" },
        { value: "11", label: "teams enrolled" },
        { value: "2 wk", label: "to broad adoption" },
      ]}
      media={
        <div
          style={{
            display: "grid",
            minHeight: "21rem",
            placeItems: "center",
            padding: "2rem",
            background:
              "radial-gradient(circle, var(--discern-color-accent-200), transparent 60%)",
          }}
        >
          <strong>Customer evidence or product photography</strong>
        </div>
      }
      action={
        <Button href="#story" variant="secondary">Read the full story</Button>
      }
    />
  );
}
