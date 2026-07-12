/* Docs shell behaviour: theme, drawer, scrollspy, copy buttons, search.
   Plain script, no dependencies, no network beyond /docs/index.json. */
(() => {
  "use strict";

  // ── Theme ────────────────────────────────────────────────────────────
  const themeBtn = document.querySelector("[data-theme-toggle]");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const dark = document.documentElement.classList.toggle("dark");
      try {
        localStorage.setItem("discern-theme", dark ? "dark" : "light");
      } catch {
        /* ignore */
      }
    });
  }

  // ── Mobile drawer ────────────────────────────────────────────────────
  const burger = document.querySelector("[data-drawer]");
  const sidenav = document.getElementById("sidenav");
  if (burger && sidenav) {
    burger.addEventListener("click", () => sidenav.classList.toggle("open"));
    sidenav.addEventListener("click", (e) => {
      if (e.target.closest("a")) sidenav.classList.remove("open");
    });
  }

  // ── Copy buttons on code blocks ──────────────────────────────────────
  for (const pre of document.querySelectorAll(".doc-body pre")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const btn = document.createElement("button");
    btn.className = "code-copy";
    btn.type = "button";
    btn.textContent = "copy";
    btn.addEventListener("click", () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(code.innerText).then(() => {
        btn.textContent = "copied ✓";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "copy";
          btn.classList.remove("copied");
        }, 1400);
      });
    });
    pre.appendChild(btn);
  }

  // ── Scrollspy for the contents rail ──────────────────────────────────
  const tocLinks = [...document.querySelectorAll(".toc a[href^='#']")];
  if (tocLinks.length > 0 && "IntersectionObserver" in window) {
    const byId = new Map(tocLinks.map((
      a,
    ) => [decodeURIComponent(a.getAttribute("href").slice(1)), a]));
    let current = null;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const link = byId.get(entry.target.id);
        if (!link || link === current) continue;
        if (current) current.classList.remove("active");
        link.classList.add("active");
        current = link;
      }
    }, { rootMargin: "-15% 0px -70% 0px" });
    for (const id of byId.keys()) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
  }

  // ── Search palette ───────────────────────────────────────────────────
  const veil = document.querySelector("[data-search-veil]");
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
  if (!veil || !input || !results) return;

  let index = null;
  let selected = 0;
  let shown = [];

  const match = (query) => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    const scored = [];
    for (const page of index) {
      const hay = page.title.toLowerCase();
      let score = null;
      let heading = "";
      if (q === "") {
        score = 100;
      } else if (hay.includes(q)) {
        score = hay.indexOf(q);
      } else if (page.description.toLowerCase().includes(q)) {
        score = 40;
      } else {
        const hit = page.headings.find((h) => h.text.toLowerCase().includes(q));
        if (hit) {
          score = 20;
          heading = hit.text;
        }
      }
      if (score !== null) scored.push({ page, score, heading });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 12);
  };

  const render = (items) => {
    shown = items;
    selected = 0;
    if (items.length === 0) {
      const note = index === null ? "loading…" : "no matches";
      results.innerHTML = `<li class="search-empty">${note}</li>`;
      return;
    }
    results.innerHTML = items.map((item, i) => {
      const meta = item.page.section +
        (item.heading ? ` › ${item.heading}` : "");
      return `<li${i === 0 ? ' class="selected"' : ""}>` +
        `<a href="${item.page.route}">` +
        `<span class="r-title">${item.page.title}</span>` +
        `<span class="r-meta">${meta}</span>` +
        `<span class="r-desc">${item.page.description}</span>` +
        `</a></li>`;
    }).join("");
  };

  const open = () => {
    veil.hidden = false;
    input.value = "";
    render([]);
    input.focus();
    if (index === null) {
      fetch("/docs/index.json")
        .then((r) => r.json())
        .then((data) => {
          index = data.pages;
          render(match(""));
        });
    } else {
      render(match(""));
    }
  };

  const close = () => {
    veil.hidden = true;
  };

  const move = (delta) => {
    const items = results.querySelectorAll("li");
    if (items.length === 0 || shown.length === 0) return;
    items[selected].classList.remove("selected");
    selected = (selected + delta + items.length) % items.length;
    items[selected].classList.add("selected");
    items[selected].scrollIntoView({ block: "nearest" });
  };

  for (const btn of document.querySelectorAll("[data-search-open]")) {
    btn.addEventListener("click", open);
  }
  veil.addEventListener("click", (e) => {
    if (e.target === veil) close();
  });
  input.addEventListener("input", () => render(match(input.value)));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" && shown[selected]) {
      globalThis.location.href = shown[selected].page.route;
    }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (veil.hidden) open();
      else close();
    } else if (e.key === "/" && veil.hidden && !e.target.closest("input")) {
      e.preventDefault();
      open();
    } else if (e.key === "Escape" && !veil.hidden) {
      close();
    }
  });
})();
