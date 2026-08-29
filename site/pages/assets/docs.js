/* discern.sh document routes — modal navigation/search, contents scroll spy, and prose
   enhancements. Plain local modules, no third-party dependencies, no network
   beyond the active corpus's one-way search-index fetch. */
import { activeTocIndex } from "./docs-toc.js";
import { searchPages } from "./search.js";
import { SYSTEM_SCHEDULER, withTimeout } from "./scheduler.js";

(() => {
  "use strict";

  const doc = document;
  const root = doc.documentElement;
  root.classList.add("docs-js");
  const $ = (selector, scope = doc) => scope.querySelector(selector);
  const $$ = (selector, scope = doc) =>
    Array.from(scope.querySelectorAll(selector));
  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  const canFocus = (value) =>
    value && typeof value.focus === "function" && value.isConnected;
  const focusablesIn = (container) =>
    $$(focusableSelector, container).filter((element) =>
      !element.closest("[hidden]") && !element.inert
    );
  const setInert = (elements, inert) => {
    for (const element of elements.filter(Boolean)) element.inert = inert;
  };
  const restoreFocus = (element) => {
    if (canFocus(element)) element.focus();
  };
  const trapFocus = (event, elements) => {
    if (event.key !== "Tab" || elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // ── Drawer ───────────────────────────────────────────────────────────────

  const nav = $("#docs-nav");
  const navScroll = nav ? $(".docs-nav-scroll", nav) : null;
  const drawerVeil = $("[data-drawer-close]");
  const burger = $("[data-drawer-toggle]");
  const drawerMedia = matchMedia("(max-width: 64em)");
  const drawerBackground = [
    $(".docs-skip"),
    $(".docs-brand"),
    $(".docs-brand-docs"),
    $(".discern-docs-header__middle"),
    $(".discern-docs-header__actions"),
    $(".docs-main"),
    $(".docs-rail"),
  ];
  let drawerOpen = false;
  let drawerReturnFocus = null;

  const documentCorpus = doc.body.dataset.documentCorpus ?? "manual";
  const navigationLabel = documentCorpus === "map"
    ? "Live Map navigation"
    : "Manual navigation";
  const navScrollKey = `discern:${documentCorpus}-nav-scroll`;
  const persistNavScroll = () => {
    if (!navScroll) return;
    try {
      sessionStorage.setItem(navScrollKey, String(navScroll.scrollTop));
    } catch {
      // discern-best-effort: site-docs-scroll-write-fallback
      // Storage can be disabled without making documentation navigation fail.
    }
  };
  const revealCurrentNavItem = () => {
    if (!navScroll) return;
    const current = $('[aria-current="page"]', navScroll);
    if (!current) return;
    const viewport = navScroll.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.top < viewport.top) {
      navScroll.scrollTop -= viewport.top - item.top;
    } else if (item.bottom > viewport.bottom) {
      navScroll.scrollTop += item.bottom - viewport.bottom;
    }
  };
  if (navScroll) {
    try {
      const saved = Number(sessionStorage.getItem(navScrollKey));
      if (Number.isFinite(saved) && saved >= 0) navScroll.scrollTop = saved;
    } catch {
      // discern-best-effort: site-docs-scroll-read-fallback
      // Storage can be disabled without making documentation navigation fail.
    }
    queueMicrotask(revealCurrentNavItem);
    navScroll.addEventListener("scroll", persistNavScroll, { passive: true });
    navScroll.addEventListener("click", persistNavScroll);
    addEventListener("pagehide", persistNavScroll);
  }

  const focusFirstInDrawer = () => {
    const first = nav ? focusablesIn(nav)[0] : null;
    if (first) first.focus();
  };

  const syncDrawerAvailability = () => {
    if (nav) nav.inert = drawerMedia.matches && !drawerOpen;
  };

  const setDrawer = (open, shouldRestore = true) => {
    if (!nav || !burger || !drawerMedia.matches && open) return;
    drawerOpen = open;
    syncDrawerAvailability();
    nav.classList.toggle("is-open", open);
    if (drawerVeil) drawerVeil.hidden = !open;
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    setInert(drawerBackground, open);
    doc.body.classList.toggle("docs-no-scroll", open);

    if (open) {
      drawerReturnFocus = burger;
      nav.setAttribute("role", "dialog");
      nav.setAttribute("aria-modal", "true");
      nav.setAttribute("aria-label", navigationLabel);
      queueMicrotask(focusFirstInDrawer);
    } else {
      nav.removeAttribute("role");
      nav.removeAttribute("aria-modal");
      nav.removeAttribute("aria-label");
      if (shouldRestore) restoreFocus(drawerReturnFocus ?? burger);
      drawerReturnFocus = null;
    }
  };

  burger?.addEventListener("click", () => setDrawer(!drawerOpen));
  drawerVeil?.addEventListener("click", () => setDrawer(false));
  drawerMedia.addEventListener("change", (event) => {
    if (!event.matches && drawerOpen) setDrawer(false, false);
    else syncDrawerAvailability();
  });
  syncDrawerAvailability();

  // ── Prose enhancements ───────────────────────────────────────────────────

  const article = $(".doc-body");

  if (article) {
    for (const heading of $$(":is(h2, h3, h4)[id]", article)) {
      const label = (heading.textContent ?? "").trim();
      const group = doc.createElement("div");
      group.className = "discern-anchor-heading docs-heading-row";
      const anchor = doc.createElement("a");
      anchor.className = "discern-anchor-heading__anchor docs-anchor";
      anchor.href = `#${heading.id}`;
      anchor.textContent = "§";
      anchor.setAttribute("aria-label", `Link to “${label}”`);
      heading.before(group);
      group.append(heading, anchor);
    }

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

    for (const table of $$(".doc-body > table")) {
      const wrap = doc.createElement("div");
      wrap.className = "discern-table docs-table";
      table.replaceWith(wrap);
      wrap.append(table);
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

  const palette = $("[data-search]");
  const input = $("[data-search-input]");
  const list = $("[data-search-results]");
  const empty = $("[data-search-empty]");
  const status = $("[data-search-status]");
  const showAll = $("[data-search-all]");
  const searchBackdrop = $("[data-search-backdrop]");

  if (palette && input && list && empty && status && showAll) {
    let pages = null;
    let loadState = "idle";
    let allResults = [];
    let results = [];
    let selected = 0;
    let expanded = false;
    let fallbackDialog = false;
    let searchReturnFocus = null;
    const searchEndpoint = palette.dataset.searchEndpoint;
    const searchBackground = [
      $(".docs-skip"),
      $(".docs-top"),
      $(".docs-shell"),
    ];

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

    const finishSearchClose = () => {
      doc.body.classList.remove("docs-no-scroll");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      if (fallbackDialog) {
        setInert(searchBackground, false);
        if (searchBackdrop) searchBackdrop.hidden = true;
        palette.removeAttribute("data-dialog-fallback");
        restoreFocus(searchReturnFocus);
      }
      fallbackDialog = false;
      searchReturnFocus = null;
    };

    // Native modal dialogs own focus containment, Escape dismissal, and the
    // top-layer backdrop. The explicit fallback keeps the same contract in
    // readers that implement <dialog> without showModal().
    const openSearch = () => {
      if (palette.open) return;
      if (drawerOpen) setDrawer(false, false);
      searchReturnFocus = doc.activeElement;
      if (typeof palette.showModal === "function") {
        palette.showModal();
      } else {
        fallbackDialog = true;
        palette.setAttribute("data-dialog-fallback", "");
        palette.setAttribute("open", "");
        setInert(searchBackground, true);
        if (searchBackdrop) searchBackdrop.hidden = false;
      }
      doc.body.classList.add("docs-no-scroll");
      input.setAttribute("aria-expanded", "true");
      input.value = "";
      expanded = false;
      update();
      input.focus();
      load();
    };

    const closeSearch = () => {
      if (!palette.open) return;
      if (!fallbackDialog && typeof palette.close === "function") {
        palette.close();
      } else {
        palette.removeAttribute("open");
        finishSearchClose();
      }
    };

    palette.addEventListener("close", finishSearchClose);
    searchBackdrop?.addEventListener("click", closeSearch);

    palette.addEventListener("mousedown", (event) => {
      if (event.target === palette) closeSearch();
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

    for (const trigger of $$("[data-search-open]")) {
      trigger.addEventListener("click", () => openSearch());
    }
    for (const closer of $$("[data-search-close]")) {
      closer.addEventListener("click", () => closeSearch());
    }

    doc.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (palette.open) closeSearch();
        else openSearch();
        return;
      }
      if (palette.open) {
        if (fallbackDialog) {
          if (event.key === "Escape") {
            event.preventDefault();
            closeSearch();
          } else {
            trapFocus(event, focusablesIn(palette));
          }
        }
        return;
      }
      if (drawerOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDrawer(false);
        } else {
          trapFocus(event, [burger, ...focusablesIn(nav)].filter(Boolean));
        }
        return;
      }
      if (
        event.key === "/" &&
        !/^(input|textarea|select)$/i.test(doc.activeElement?.tagName ?? "")
      ) {
        event.preventDefault();
        openSearch();
      }
    });
  }
})();
