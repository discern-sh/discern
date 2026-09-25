/**
 * Where a sentence ends in authored prose: a terminator, plus any closing
 * quotes, brackets, or Markdown emphasis that follow it, as in `land it."` or
 * `**Declared met.**`. The reading-grade counter and the glossary's summary
 * extraction share this, so a quoted request can't merge two sentences.
 */
export const SENTENCE_TERMINATOR = String.raw`[.!?]+["'”’)\]*_]*`;
