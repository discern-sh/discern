/* discern.sh/docs — the manual's behaviors: theme, drawer, search palette,
   contents-rail scroll spy, and prose enhancements. Plain script, no
   dependencies, no network beyond /docs/index.json. */
(() => {
  "use strict";

  const doc = document;
  const root = doc.documentElement;
  const $ = (sel, scope = doc) => scope.querySelector(sel);
  const $$ = (sel, scope = doc) => Array.from(scope.querySelectorAll(sel));

  // ── Theme ────────────────────────────────────────────────────────────────

  $("[data-theme-toggle]")?.addEventListener("click", () => {
    const next = root.getAttribute("data-ds-theme") === "dark"
      ? "light"
      : "dark";
    root.setAttribute("data-ds-theme", next);
    try {
      localStorage.setItem("discern-theme", next);
    } catch {
      /* private mode */
    }
  });

  // ── Drawer ───────────────────────────────────────────────────────────────

  const nav = $("#docs-nav");
  const drawerVeil = $("[data-drawer-close]");
  const burger = $("[data-drawer-toggle]");

  const setDrawer = (open) => {
    nav?.classList.toggle("is-open", open);
    if (drawerVeil) drawerVeil.hidden = !open;
    burger?.setAttribute("aria-expanded", String(open));
  };

  burger?.addEventListener("click", () => {
    setDrawer(!nav?.classList.contains("is-open"));
  });
  drawerVeil?.addEventListener("click", () => setDrawer(false));

  // ── Prose enhancements ───────────────────────────────────────────────────

  const article = $(".doc-body");

  if (article) {
    for (const heading of $$(":is(h2, h3, h4)[id]", article)) {
      const anchor = doc.createElement("a");
      anchor.className = "docs-anchor";
      anchor.href = `#${heading.id}`;
      anchor.textContent = "§";
      anchor.setAttribute(
        "aria-label",
        `Link to “${(heading.textContent ?? "").trim()}”`,
      );
      heading.append(anchor);
    }

    for (const pre of $$("pre", article)) {
      const code = pre.querySelector("code");
      const lang = /language-([\w-]+)/.exec(code?.className ?? "")?.[1];
      if (lang) pre.dataset.lang = lang;

      const copy = doc.createElement("button");
      copy.type = "button";
      copy.className = "docs-copy";
      copy.textContent = "copy";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            (code ?? pre).innerText.trimEnd(),
          );
          copy.textContent = "copied ✓";
          copy.classList.add("is-copied");
          setTimeout(() => {
            copy.textContent = "copy";
            copy.classList.remove("is-copied");
          }, 1600);
        } catch {
          /* clipboard unavailable */
        }
      });
      pre.append(copy);
    }

    for (const table of $$(".doc-body > table")) {
      const wrap = doc.createElement("div");
      wrap.className = "docs-table";
      table.replaceWith(wrap);
      wrap.append(table);
    }
  }

  // ── Contents-rail scroll spy ─────────────────────────────────────────────

  const tocLinks = $$(".docs-toc a");
  if (article && tocLinks.length > 0 && "IntersectionObserver" in globalThis) {
    const byId = new Map(
      tocLinks.map((a) => [decodeURIComponent(a.hash.slice(1)), a]),
    );
    const headings = $$(":is(h2, h3)[id]", article)
      .filter((h) => byId.has(h.id));
    let active = null;

    const mark = (id) => {
      const link = byId.get(id);
      if (!link || link === active) return;
      active?.classList.remove("is-active");
      link.classList.add("is-active");
      active = link;
    };

    const visible = new Set();
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      const top = headings.find((h) => visible.has(h));
      if (top) mark(top.id);
    }, { rootMargin: "-56px 0px -60% 0px" });

    for (const heading of headings) spy.observe(heading);
  }

  // ── Search palette ───────────────────────────────────────────────────────

  const palette = $("[data-search]");
  const input = $("[data-search-input]");
  const list = $("[data-search-results]");

  if (palette && input && list) {
    let pages = null;
    let results = [];
    let selected = 0;

    const load = async () => {
      if (pages) return;
      try {
        const res = await fetch("/docs/index.json");
        pages = (await res.json()).pages;
      } catch {
        pages = [];
      }
      update();
    };

    const open = () => {
      palette.hidden = false;
      doc.body.classList.add("docs-no-scroll");
      input.value = "";
      update();
      input.focus();
      load();
    };

    const close = () => {
      palette.hidden = true;
      doc.body.classList.remove("docs-no-scroll");
    };

    const search = (query) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0 || !pages) return [];
      const scored = [];
      for (const page of pages) {
        const title = page.title.toLowerCase();
        const body = `${page.section} ${page.description}`.toLowerCase();
        let score = 0;
        let heading = null;
        for (const term of terms) {
          let hit = 0;
          if (title.includes(term)) hit = 30;
          const inHeading = page.headings.find((h) =>
            h.text.toLowerCase().includes(term)
          );
          if (inHeading) {
            hit = Math.max(hit, 12);
            heading ??= inHeading;
          }
          if (body.includes(term)) hit = Math.max(hit, 6);
          if (hit === 0) {
            score = 0;
            break;
          }
          score += hit;
        }
        if (score > 0) scored.push({ page, heading, score });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, 12);
    };

    const render = () => {
      list.textContent = "";
      if (results.length === 0) {
        if (input.value.trim() !== "") {
          const empty = doc.createElement("li");
          empty.className = "docs-search-empty";
          empty.textContent = pages
            ? "Nothing in the manual matches."
            : "Loading the index…";
          list.append(empty);
        }
        return;
      }
      results.forEach(({ page, heading }, i) => {
        const item = doc.createElement("li");
        if (i === selected) item.className = "is-selected";
        const link = doc.createElement("a");
        link.href = heading && !page.title.toLowerCase().includes(
            input.value.trim().toLowerCase(),
          )
          ? `${page.route}#${heading.id}`
          : page.route;
        const title = doc.createElement("span");
        title.className = "docs-search-title";
        title.textContent = heading && heading.text !== page.title
          ? `${page.title} › ${heading.text}`
          : page.title;
        const path = doc.createElement("span");
        path.className = "docs-search-path";
        path.textContent = `${page.section.toLowerCase()} ${page.route}`;
        link.append(title, path);
        item.append(link);
        item.addEventListener("mousemove", () => {
          if (selected !== i) {
            selected = i;
            render();
          }
        });
        list.append(item);
      });
    };

    const update = () => {
      results = search(input.value);
      selected = 0;
      render();
    };

    input.addEventListener("input", update);
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (results.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        selected = (selected + step + results.length) % results.length;
        render();
        list.querySelector("li.is-selected")?.scrollIntoView({
          block: "nearest",
        });
      } else if (event.key === "Enter") {
        const target = list.querySelector("li.is-selected a");
        if (target) location.href = target.href;
      }
    });

    for (const trigger of $$("[data-search-open]")) {
      trigger.addEventListener("click", open);
    }
    $("[data-search-close]")?.addEventListener("click", close);

    doc.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (palette.hidden) open();
        else close();
      } else if (event.key === "Escape" && !palette.hidden) {
        close();
      } else if (
        event.key === "/" && palette.hidden &&
        !/^(input|textarea|select)$/i.test(doc.activeElement?.tagName ?? "")
      ) {
        event.preventDefault();
        open();
      }
    });
  }
})();
