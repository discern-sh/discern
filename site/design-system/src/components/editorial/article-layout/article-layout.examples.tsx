import { ArticleLayout } from "./article-layout.tsx";

export default function ArticleLayoutExamples() {
  return (
    <ArticleLayout
      navigation={
        <small>
          On this page<br />01 · Context<br />02 · Method
        </small>
      }
      rail={
        <small>
          Filed under<br />
          <strong>Practice</strong>
        </small>
      }
    >
      <h2>A reading shell with room to think.</h2>
      <p>
        The central column carries the narrative while optional rails hold
        orientation and supporting detail without interrupting the argument.
      </p>
    </ArticleLayout>
  );
}
