import { PullQuote } from "./pull-quote.tsx";

export default function PullQuoteExamples() {
  return (
    <PullQuote
      quote={
        <p>
          The useful system is the one that makes its reasoning easy to inspect.
        </p>
      }
      attribution="Example contributor"
      citation="Field notes, issue 08"
    />
  );
}
