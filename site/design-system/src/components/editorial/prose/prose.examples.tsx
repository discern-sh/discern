import { Prose } from "./prose.tsx";

export default function ProseExamples() {
  return (
    <Prose lead dropCap>
      <p>
        Good long-form design gives the first paragraph enough presence to open
        the argument without turning every sentence into display type.
      </p>
      <h2 id="prose-example">A durable reading rhythm</h2>
      <p>
        Body copy,{" "}
        <a href="#prose-example">useful links</a>, and inline commands such as
        {" "}
        <code>tool check</code> share one calm measure.
      </p>
      <ul>
        <li>Lead with the reader's question.</li>
        <li>Make evidence easy to locate.</li>
      </ul>
    </Prose>
  );
}
