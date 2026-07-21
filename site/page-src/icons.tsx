/** The small stroke-icon set shared by the generated static pages. */

export type PageIconName =
  | "agent"
  | "arrow"
  | "branch"
  | "check"
  | "code"
  | "github"
  | "human"
  | "map"
  | "spark";

/** One decorative stroke icon, sized by the surrounding text. */
export function PageIcon({ name }: { readonly name: PageIconName }) {
  const path = {
    agent: (
      <>
        <rect x="4" y="6" width="16" height="13" rx="3" />
        <path d="M9 3h6M12 3v3M8 12h.01M16 12h.01M9 16h6" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="8" r="2" />
        <circle cx="6" cy="19" r="2" />
        <path d="M6 7v10M8 8h4a6 6 0 0 1 6 6v-4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    code: <path d="m9 7-5 5 5 5m6-10 5 5-5 5" />,
    github: (
      <>
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.7-1.6 6.7-7A5.4 5.4 0 0 0 19.2 3.7 5 5 0 0 0 19.1.2 7.5 7.5 0 0 0 15 1.5a14 14 0 0 0-6 0A7.5 7.5 0 0 0 4.9.2a5 5 0 0 0-.1 3.5 5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.4 6.6 6.7 7A4.8 4.8 0 0 0 9 18v4" />
        <path d="M9 18c-4.5 2-5-2-7-2" />
      </>
    ),
    human: (
      <>
        <circle cx="12" cy="7" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>
    ),
    map: (
      <>
        <path d="m4 6 5-2 6 2 5-2v14l-5 2-6-2-5 2V6Z" />
        <path d="M9 4v14m6-12v14" />
      </>
    ),
    spark: (
      <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" />
    ),
  }[name];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}
