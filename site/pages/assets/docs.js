/* discern.sh document routes — search results, navigation position, contents
   scroll spy, and prose enhancements. The package runtime owns the navigation
   drawer and the search dialog. Plain local modules, no third-party
   dependencies, no network beyond the active corpus's one-way search-index
   fetch. */
import { activeTocIndex } from "./docs-toc.js";
import { searchPages } from "./search.js";
import { SYSTEM_SCHEDULER, withTimeout } from "./scheduler.js";

(() => {
  "use strict";

  const doc = document;
  const $ = (selector, scope = doc) => scope.querySelector(selector);
  const $$ = (selector, scope = doc) =>
    Array.from(scope.querySelectorAll(selector));

  // ── Navigation position ──────────────────────────────────────────────────

  // The package layout's navigation column is the scroll container, in flow
  // at a wide allocation and as the drawer at a narrow one.
  const nav = $("#docs-nav");

  const navScrollKey = "discern:manual-nav-scroll";
  const persistNavScroll = () => {
    if (!nav) return;
    try {
      sessionStorage.setItem(navScrollKey, String(nav.scrollTop));
    } catch {
      // discern-best-effort: site-docs-scroll-write-fallback
      // Storage can be disabled without making documentation navigation fail.
    }
  };
  const revealCurrentNavItem = () => {
    if (!nav) return;
    const current = $('[aria-current="page"]', nav);
    if (!current) return;
    const viewport = nav.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.top < viewport.top) {
      nav.scrollTop -= viewport.top - item.top;
    } else if (item.bottom > viewport.bottom) {
      nav.scrollTop += item.bottom - viewport.bottom;
    }
  };
  if (nav) {
    try {
      const saved = Number(sessionStorage.getItem(navScrollKey));
      if (Number.isFinite(saved) && saved >= 0) nav.scrollTop = saved;
    } catch {
      // discern-best-effort: site-docs-scroll-read-fallback
      // Storage can be disabled without making documentation navigation fail.
    }
    queueMicrotask(revealCurrentNavItem);
    nav.addEventListener("scroll", persistNavScroll, { passive: true });
    nav.addEventListener("click", persistNavScroll);
    addEventListener("pagehide", persistNavScroll);
  }

  // ── Prose enhancements ───────────────────────────────────────────────────

  const article = $(".doc-body");

  if (article) {
    for (const pre of $$(`pre`, article)) {
      const code = pre.querySelector("code");
      const lang = /language-([\w-]+)/.exec(code?.className ?? "")?.[1];
      if (lang) pre.dataset.lang = lang;
      const commandExecution = pre.parentElement?.classList.contains(
          "discern-command__execution",
        )
        ? pre.parentElement
        : null;

      const copy = doc.createElement("button");
      copy.type = "button";
      copy.className = commandExecution
        ? "discern-copy-button discern-command__copy docs-command-copy"
        : "discern-copy-button docs-copy";
      const copyStatus = doc.createElement("span");
      copyStatus.setAttribute("aria-live", "polite");
      copy.append(copyStatus);
      let resetTimer = null;

      const setCopyState = (text, label, className = "") => {
        copyStatus.textContent = text;
        copy.setAttribute("aria-label", label);
        if (className === "is-copied") {
          copy.setAttribute("data-discern-copied", "");
        } else {
          copy.removeAttribute("data-discern-copied");
        }
        copy.classList.toggle(
          "is-copy-failed",
          className === "is-copy-failed",
        );
      };
      const resetCopy = () =>
        setCopyState(
          commandExecution ? "Copy command" : "copy",
          commandExecution ? "Copy command" : "Copy code",
        );
      resetCopy();

      copy.addEventListener("click", async () => {
        if (resetTimer !== null) SYSTEM_SCHEDULER.cancelTimeout(resetTimer);
        setCopyState(
          commandExecution ? "Copying command…" : "copying…",
          commandExecution ? "Copying command" : "Copying code",
        );
        try {
          if (!navigator.clipboard) throw new Error("clipboard unavailable");
          await withTimeout(
            navigator.clipboard.writeText((code ?? pre).innerText.trimEnd()),
            1000,
            "clipboard timed out",
          );
          setCopyState(
            commandExecution ? "Command copied" : "copied ✓",
            commandExecution ? "Command copied" : "Code copied",
            "is-copied",
          );
        } catch {
          setCopyState(
            commandExecution ? "Command copy failed" : "copy failed",
            commandExecution ? "Command copy failed" : "Copy failed",
            "is-copy-failed",
          );
        }
        resetTimer = SYSTEM_SCHEDULER.scheduleTimeout(resetCopy, 2000);
      });
      (commandExecution ?? pre).append(copy);
    }
  }

  // ── Contents-rail scroll spy ─────────────────────────────────────────────

  const tocLinks = $$(".docs-toc a");
  if (article && tocLinks.length > 0) {
    const byId = new Map(
      tocLinks.map((
        anchor,
      ) => [decodeURIComponent(anchor.hash.slice(1)), anchor]),
    );
    const headings = $$(":is(h2, h3)[id]", article)
      .filter((heading) => byId.has(heading.id));
    const headingIndexById = new Map(
      headings.map((heading, index) => [heading.id, index]),
    );
    let active = null;
    let pinnedIndex = -1;
    let releasePinTimer;

    const currentClass = "discern-table-of-contents__item--current";
    const mark = (id) => {
      const link = byId.get(id);
      if (!link || link === active) return;
      active?.closest("li")?.classList.remove(currentClass);
      active?.removeAttribute("aria-current");
      link.closest("li")?.classList.add(currentClass);
      link.setAttribute("aria-current", "location");
      active = link;
    };

    const releasePinSoon = () => {
      if (releasePinTimer !== undefined) {
        SYSTEM_SCHEDULER.cancelTimeout(releasePinTimer);
      }
      releasePinTimer = SYSTEM_SCHEDULER.scheduleTimeout(() => {
        pinnedIndex = -1;
        releasePinTimer = undefined;
      }, 180);
    };

    const pin = (id) => {
      const index = headingIndexById.get(id);
      if (index === undefined) return;
      pinnedIndex = index;
      mark(id);
      releasePinSoon();
    };

    for (const link of tocLinks) {
      link.addEventListener("click", () => {
        pin(decodeURIComponent(link.hash.slice(1)));
      });
    }
    globalThis.addEventListener("hashchange", () => {
      pin(decodeURIComponent(globalThis.location.hash.slice(1)));
    });

    let queued = false;
    const update = () => {
      queued = false;
      const scrollY = globalThis.scrollY;
      const index = activeTocIndex({
        headingTops: headings.map((heading) =>
          heading.getBoundingClientRect().top + scrollY
        ),
        scrollY,
        viewportHeight: globalThis.innerHeight,
        documentHeight: doc.documentElement.scrollHeight,
        headerOffset: 72,
        pinnedIndex,
      });
      const heading = headings[index];
      if (heading) mark(heading.id);
    };
    const queue = () => {
      if (pinnedIndex >= 0) releasePinSoon();
      if (queued) return;
      queued = true;
      globalThis.requestAnimationFrame(update);
    };

    globalThis.addEventListener("scroll", queue, { passive: true });
    globalThis.addEventListener("resize", queue);
    globalThis.addEventListener("load", queue, { once: true });
    if (globalThis.location.hash) {
      pin(decodeURIComponent(globalThis.location.hash.slice(1)));
    }
    update();
  }

  // ── Search palette ───────────────────────────────────────────────────────

  // The package behaviour opens and dismisses the palette and owns its
  // focus; this script answers its open and close events with the query,
  // the one-way index request, and the results region's page-owned hooks.
  const palette = $("[data-discern-search-palette]");
  const input = $("[data-discern-search-palette-input]");
  const list = $("[data-search-results]");
  const empty = $("[data-search-empty]");
  const status = $("[data-search-status]");
  const showAll = $("[data-search-all]");

  if (palette && input && list && empty && status && showAll) {
    let pages = null;
    let loadState = "idle";
    let allResults = [];
    let results = [];
    let selected = 0;
    let expanded = false;
    const searchEndpoint = palette.dataset.searchEndpoint;

    const syncSelection = () => {
      const options = $$("[role=option]", list);
      for (const [index, option] of options.entries()) {
        option.setAttribute("aria-selected", String(index === selected));
      }
      const active = options[selected];
      if (active) input.setAttribute("aria-activedescendant", active.id);
      else input.removeAttribute("aria-activedescendant");
    };

    const resultHref = ({ page, heading }) =>
      heading ? `${page.route}#${heading.id}` : page.route;

    const render = () => {
      list.textContent = "";
      empty.hidden = true;
      showAll.hidden = true;
      input.removeAttribute("aria-activedescendant");
      const query = input.value.trim();
      if (query === "") {
        status.textContent = "";
        return;
      }
      if (loadState === "idle" || loadState === "loading") {
        empty.textContent = "Loading the search index…";
        empty.hidden = false;
        status.textContent = "Loading search results";
        return;
      }
      if (loadState === "error") {
        empty.textContent =
          "Search is unavailable. Use this page's navigation instead.";
        empty.hidden = false;
        status.textContent = "Search is unavailable";
        return;
      }
      if (results.length === 0) {
        empty.textContent =
          "No results. Try a command, config key, or exact error message.";
        empty.hidden = false;
        status.textContent = `No results for ${query}`;
        return;
      }

      results.forEach(({ page, heading, snippet }, index) => {
        const item = doc.createElement("li");
        item.id = `docs-search-option-${index}`;
        item.className = "discern-search-palette__result docs-search-option";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(index === selected));
        const title = doc.createElement("span");
        title.className = "discern-search-palette__result-title";
        title.textContent = heading && heading.text !== page.title
          ? `${page.title} › ${heading.text}`
          : page.title;
        const context = doc.createElement("span");
        context.className = "discern-search-palette__result-context";
        context.textContent = snippet;
        const path = doc.createElement("span");
        path.className =
          "discern-search-palette__result-context docs-search-path";
        path.textContent = `${
          page.kind ?? page.section.toLowerCase()
        } · ${page.route}`;
        item.append(title, context, path);
        item.addEventListener("mouseenter", () => {
          selected = index;
          syncSelection();
        });
        item.addEventListener("click", () => {
          location.href = resultHref({ page, heading });
        });
        list.append(item);
      });
      if (!expanded && allResults.length > results.length) {
        showAll.textContent = `Show all ${allResults.length} results`;
        showAll.hidden = false;
      }
      syncSelection();
      status.textContent = expanded || allResults.length === results.length
        ? `${results.length} search result${results.length === 1 ? "" : "s"}`
        : `${allResults.length} search results; showing ${results.length}`;
    };

    const update = () => {
      allResults = pages
        ? searchPages(pages, input.value, Number.POSITIVE_INFINITY)
        : [];
      results = expanded ? allResults : allResults.slice(0, 12);
      selected = 0;
      render();
    };

    const load = async () => {
      if (loadState !== "idle") return;
      loadState = "loading";
      list.setAttribute("aria-busy", "true");
      update();
      try {
        if (!searchEndpoint) throw new Error("search endpoint unavailable");
        const response = await fetch(searchEndpoint);
        if (!response.ok) throw new Error("search index unavailable");
        pages = (await response.json()).pages;
        loadState = "ready";
      } catch {
        // discern-best-effort: site-docs-search-load-fallback
        pages = [];
        loadState = "error";
      }
      list.removeAttribute("aria-busy");
      update();
    };

    palette.addEventListener("discern:search-palette:open", () => {
      input.value = "";
      expanded = false;
      update();
      load();
    });
    palette.addEventListener("discern:search-palette:close", () => {
      input.removeAttribute("aria-activedescendant");
    });

    input.addEventListener("input", () => {
      expanded = false;
      update();
    });
    showAll.addEventListener("click", () => {
      expanded = true;
      update();
      input.focus();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (results.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        selected = (selected + step + results.length) % results.length;
        syncSelection();
        list.querySelector('[aria-selected="true"]')?.scrollIntoView({
          block: "nearest",
        });
      } else if (event.key === "Enter") {
        const result = results[selected];
        if (result) location.href = resultHref(result);
      }
    });
  }
})();
