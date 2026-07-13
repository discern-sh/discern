import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { allTokens } from "../src/tokens/tokens.ts";
import type { ComponentGroup } from "../src/types/component-meta.ts";
import { registry } from "./generated/registry.ts";

const GROUP_ORDER: readonly ComponentGroup[] = [
  "Core",
  "Layout",
  "Display",
  "Forms",
  "Feedback",
  "Navigation",
];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function TokenPreview(
  { name, category }: { readonly name: string; readonly category: string },
) {
  if (category === "Color") {
    return (
      <span
        className="sg-token__swatch"
        style={{ background: `var(${name})` }}
      />
    );
  }
  if (category === "Typography") {
    return (
      <span
        className="sg-token__type"
        style={name.includes("font-") && !name.includes("font-size") &&
            !name.includes("font-weight")
          ? { fontFamily: `var(${name})` }
          : undefined}
      >
        Aa
      </span>
    );
  }
  if (category === "Spacing" || category === "Layout") {
    return (
      <span
        className="sg-token__space"
        style={{ width: `min(var(${name}), 100%)` }}
      />
    );
  }
  if (category === "Shape") {
    return (
      <span
        className="sg-token__shape"
        style={name.includes("radius")
          ? { borderRadius: `var(${name})` }
          : { boxShadow: `var(${name})` }}
      />
    );
  }
  return <span className="sg-token__motion" />;
}

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("ds-styleguide-theme") === "dark" ? "dark" : "light"
  );
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const components = useMemo(() =>
    registry
      .slice()
      .sort((a, b) =>
        GROUP_ORDER.indexOf(a.meta.group) - GROUP_ORDER.indexOf(b.meta.group) ||
        a.meta.order - b.meta.order
      )
      .filter(({ meta }) =>
        !normalizedQuery ||
        `${meta.name} ${meta.group} ${meta.description}`.toLowerCase().includes(
          normalizedQuery,
        )
      ), [normalizedQuery]);

  const tokens = useMemo(
    () =>
      allTokens.filter((token) =>
        !normalizedQuery ||
        `${token.name} ${token.category} ${token.description}`.toLowerCase()
          .includes(normalizedQuery)
      ),
    [normalizedQuery],
  );

  const groupedComponents = GROUP_ORDER.map((group) => ({
    group,
    entries: components.filter(({ meta }) => meta.group === group),
  })).filter(({ entries }) => entries.length);
  const tokenCategories = [...new Set(tokens.map((token) => token.category))];

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("ds-styleguide-theme", next);
  };

  return (
    <div className="sg-shell" data-ds-root data-ds-theme={theme}>
      <aside className="sg-sidebar">
        <a className="sg-brand" href="#top">
          <span className="sg-brand__mark">D</span>
          <span>
            <strong>Discern</strong>
            <small>Design system</small>
          </span>
        </a>
        <nav className="sg-nav" aria-label="Styleguide">
          <a href="#foundations">Foundations</a>
          {tokenCategories.map((category) => (
            <a
              key={category}
              className="sg-nav__child"
              href={`#tokens-${slugify(category)}`}
            >
              {category}
            </a>
          ))}
          <span className="sg-nav__heading">Components</span>
          {groupedComponents.map(({ group, entries }) => (
            <div key={group}>
              <a href={`#group-${slugify(group)}`}>
                {group}
                <small>{entries.length}</small>
              </a>
              {entries.map(({ meta }) => (
                <a
                  key={meta.slug}
                  className="sg-nav__child"
                  href={`#component-${meta.slug}`}
                >
                  {meta.name}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <header className="sg-toolbar">
        <label className="sg-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search tokens and components"
          />
        </label>
        <button className="sg-theme" type="button" onClick={toggleTheme}>
          {theme === "light" ? "Dark" : "Light"} mode
        </button>
      </header>

      <main className="sg-main" id="top">
        <section className="sg-hero">
          <span className="ds-kicker">
            <span className="sg-live-dot" />Generated reference
          </span>
          <h1>
            Discern, built as a <em>system</em>.
          </h1>
          <p>
            Typed tokens, framework-neutral CSS, accessible React adapters, and
            automatically enrolled component examples.
          </p>
          <div className="sg-stats">
            <span>{allTokens.length} tokens</span>
            <span>{registry.length} components</span>
            <span>0 remote runtime assets</span>
          </div>
        </section>

        <section className="sg-section" id="foundations">
          <header className="sg-section__header">
            <div>
              <span className="ds-kicker">01 — Foundations</span>
              <h2>One value, every surface.</h2>
            </div>
            <p>
              Change authored values in{" "}
              <code>src/tokens/tokens.ts</code>. CSS and this inventory are
              generated.
            </p>
          </header>
          {tokenCategories.map((category) => {
            const categoryTokens = tokens.filter((token) =>
              token.category === category
            );
            return (
              <section
                className="sg-subsection"
                id={`tokens-${slugify(category)}`}
                key={category}
              >
                <div className="sg-subsection__heading">
                  <h3>{category}</h3>
                  <span>{categoryTokens.length}</span>
                </div>
                <div className="sg-token-grid">
                  {categoryTokens.map((token) => (
                    <article className="sg-token" key={token.name}>
                      <TokenPreview
                        name={token.name}
                        category={token.category}
                      />
                      <div>
                        <code>{token.name}</code>
                        <p>{token.description}</p>
                        <small>
                          {"light" in token
                            ? `${token.light} / ${token.dark}`
                            : token.value}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </section>

        <section className="sg-section" id="components">
          <header className="sg-section__header">
            <div>
              <span className="ds-kicker">02 — Components</span>
              <h2>Typed, composable, inspectable.</h2>
            </div>
            <p>
              Each component owns implementation, CSS, metadata, and neutral
              fixtures. New metadata files enter this page automatically.
            </p>
          </header>
          {groupedComponents.map(({ group, entries }) => (
            <section
              className="sg-component-group"
              id={`group-${slugify(group)}`}
              key={group}
            >
              <div className="sg-subsection__heading">
                <h3>{group}</h3>
                <span>{entries.length}</span>
              </div>
              {entries.map(({ meta, Examples }) => (
                <article
                  className="sg-component"
                  id={`component-${meta.slug}`}
                  key={meta.slug}
                >
                  <header>
                    <div>
                      <h4>{meta.name}</h4>
                      <p>{meta.description}</p>
                    </div>
                    <a
                      href={`../src/components/${meta.group.toLowerCase()}/${meta.slug}/${meta.slug}.tsx`}
                      target="_blank"
                    >
                      Source ↗
                    </a>
                  </header>
                  <div className="sg-component__canvas">
                    <Examples />
                  </div>
                  {meta.accessibility?.length
                    ? (
                      <footer>
                        <strong>Accessibility</strong>
                        <ul>
                          {meta.accessibility.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </footer>
                    )
                    : null}
                </article>
              ))}
            </section>
          ))}
        </section>

        {!components.length && !tokens.length
          ? (
            <div className="sg-empty">
              <h2>No matches.</h2>
              <p>Try a component group, token role, or visual property.</p>
            </div>
          )
          : null}
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Styleguide root is missing");
createRoot(root).render(<App />);
