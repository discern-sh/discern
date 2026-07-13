import { Testimonial } from "./testimonial.tsx";

export default function TestimonialExamples() {
  return (
    <Testimonial
      eyebrow="From the field"
      quote="For the first time, the review tells the same clear story as the work itself."
      author="Morgan Ellis"
      authorRole="Engineering lead · Northstar"
      avatar="ME"
      metric="3.4×"
      metricLabel="faster from first review to a confident decision"
    />
  );
}
