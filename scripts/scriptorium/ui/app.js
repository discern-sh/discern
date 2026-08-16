/* The Scriptorium's reading-room behavior: span selection, the entry
   inspector rail, IDE jumps, guard runs, and the live change feed. */

const boot = JSON.parse(document.getElementById("scr-boot").textContent);
const rail = document.getElementById("scr-rail");
const doc = document.getElementById("scr-doc");

let selected = null;
let currentEntry = null;
let editing = null;

/** The pending plain-twin reviews the pen has queued. */
function twinList() {
  try {
    return JSON.parse(localStorage.getItem("scr-twins") ?? "[]");
  } catch {
    return [];
  }
}

/** Persist the twin list, bounded so it cannot grow forever. */
function saveTwinList(list) {
  localStorage.setItem("scr-twins", JSON.stringify(list.slice(-20)));
}

/** Queue a twin review after a technical-register save. */
function pushTwin(ref, field) {
  const list = twinList().filter(
    (item) => !(item.slug === ref.slug && item.field === field),
  );
  list.push({ registry: ref.registry, slug: ref.slug, field });
  saveTwinList(list);
}

/** Clear a twin review once its plain field is visited by the pen. */
function clearTwin(ref) {
  saveTwinList(
    twinList().filter(
      (item) => !(item.slug === ref.slug && item.field === ref.field),
    ),
  );
}

/** Build one element with classes, attributes, and children. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else if (key === "onclick") node.addEventListener("click", value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** Split a span ref token into registry, entry slug, and field path. */
function parseRef(token) {
  const parts = token.split(":");
  return {
    registry: parts[0],
    slug: parts[1],
    field: parts.slice(2).join(":"),
  };
}

/** Ask the server to jump PhpStorm to an entry or one of its fields. */
async function openInIde(ref) {
  await fetch("/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ref),
  });
}

/** A rail link that navigates to a cited entry's page and focuses it there. */
function citeLink(target) {
  const pageByRegistry = {
    feature: "feature-canon",
    benefit: "feature-canon-benefits",
    practice: "practice-canon",
    glossary: "glossary",
    claims: "claims-and-evidence",
  };
  return el("a", {
    class: "scr-cite",
    href: `/page/${pageByRegistry[target.registry] ?? "feature-canon"}`,
    "data-focus": `${target.registry}:${target.slug}`,
  }, [
    document.createTextNode(target.label + " "),
    el("small", { text: target.registry }),
  ]);
}

/** The verdict chip summarizing a registry's last guard run. */
function guardChip(report) {
  if (!report) return el("span", { class: "scr-chip", text: "not run yet" });
  return el("span", {
    class: report.ok ? "scr-chip scr-chip-ok" : "scr-chip scr-chip-fail",
    text: report.ok ? "✓ guards green" : "✗ guards red",
  });
}

let lastReports = new Map();

/** Fill the inspector rail: source, fields, citation web, and guard panel. */
function renderRail(entry, activeField) {
  currentEntry = entry;
  rail.textContent = "";
  rail.append(
    el("p", { class: "scr-rail-title", text: entry.title }),
    el("div", {
      class: "scr-kind",
      text: `${entry.registry} ${entry.kind} · ${entry.id}`,
    }),
    el("h3", { text: "Source" }),
    el("div", {
      class: "scr-guardline",
      text: entry.file ? `${entry.file}:${entry.line}` : "position unknown",
    }),
    el("button", {
      class: "scr-btn scr-primary",
      text: "Open in PhpStorm",
      onclick: () =>
        openInIde({
          registry: entry.registry,
          slug: entry.slug,
          field: activeField,
        }),
    }),
  );

  const active = entry.fields.find((field) => field.path === activeField);
  if (active?.editable && selected) {
    const span = selected;
    rail.append(
      el("button", {
        class: "scr-btn",
        text: `Edit ${active.path} here`,
        onclick: () =>
          openEditor(
            span,
            { registry: entry.registry, slug: entry.slug, field: active.path },
            active.value ?? "",
          ),
      }),
    );
  }
  const pendingTwins = twinList().filter((item) => item.slug === entry.slug);
  for (const twin of pendingTwins) {
    rail.append(
      el("div", {
        class: "scr-chip scr-chip-dirty scr-twin",
        text: "● technical edited — review the plain twin",
      }),
      el("button", {
        class: "scr-btn",
        text: `Open ${twin.field} on the plain page`,
        onclick: () => {
          sessionStorage.setItem("scr-focus", `feature:${twin.slug}`);
          location.href = "/page/feature-canon-plain";
        },
      }),
    );
  }

  if (entry.fields.length > 0) {
    rail.append(el("h3", { text: "Fields" }));
    for (const field of entry.fields) {
      rail.append(
        el("div", {
          class: "scr-fieldrow",
          "data-active": String(field.path === activeField),
        }, [
          el("span", { text: field.path }),
          el("span", {
            text: field.editable ? "✎" : "🔒 " + field.kind,
            title: field.editable
              ? "editable prose"
              : "derived or structured — edit at the source",
          }),
        ]),
      );
    }
  }

  const outward = entry.outward.filter((c) => c.refs.some((r) => r.registry));
  if (outward.length > 0) {
    rail.append(el("h3", { text: "Cites" }));
    for (const citation of outward) {
      for (const ref of citation.refs) {
        if (ref.registry) rail.append(citeLink(ref));
      }
    }
  }
  if (entry.inward.length > 0) {
    rail.append(el("h3", { text: "Cited by" }));
    for (const citation of entry.inward) rail.append(citeLink(citation));
  }
  if (entry.claimsCarried.length > 0) {
    rail.append(el("h3", { text: "Claims carried (via benefits)" }));
    for (const slug of entry.claimsCarried) {
      rail.append(citeLink({ registry: "claims", slug, label: slug }));
    }
  }

  rail.append(el("h3", { text: "Guards" }));
  const registryGuards = boot.guards.find((g) => g.registry === entry.registry);
  rail.append(el("div", { class: "scr-guards" }, [
    guardChip(lastReports.get(entry.registry)),
    ...(registryGuards?.guards ?? []).map((file) =>
      el("div", { class: "scr-guardline", text: file })
    ),
  ]));
  const report = lastReports.get(entry.registry);
  if (report && !report.ok) {
    for (const result of report.results.filter((r) => !r.ok)) {
      rail.append(el("pre", { class: "scr-failure", text: result.summary }));
    }
  }
  rail.append(
    el("button", {
      class: "scr-btn",
      text: "Run this registry's guards",
      onclick: () =>
        fetch("/api/guards/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ registry: entry.registry }),
        }),
    }),
  );
}

/** Close the inline editor, restoring the span's rendered content. */
function closeEditor() {
  if (!editing) return;
  editing.span.innerHTML = editing.original;
  editing.span.classList.remove("scr-editing");
  editing.failure?.remove();
  editing = null;
}

/** Submit the inline editor through the save-and-prove loop. */
async function submitEditor() {
  if (!editing) return;
  const value = editing.box.textContent;
  const { span, ref, stageline } = editing;
  stageline.textContent = "saving…";
  span.classList.add("scr-saving");
  const response = await fetch("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...ref, value }),
  });
  const report = await response.json();
  span.classList.remove("scr-saving");
  if (report.ok) {
    if (report.twin) pushTwin(ref, report.twin);
    if (ref.field.startsWith("plain.")) clearTwin(ref);
    sessionStorage.setItem("scr-focus", `${ref.registry}:${ref.slug}`);
    editing = null;
    location.reload();
    return;
  }
  stageline.textContent = `${report.stage} refused`;
  editing.failure?.remove();
  const failure = el("div", { class: "scr-failure" }, []);
  const issues = [report.issue];
  for (const result of report.guards?.results?.filter((r) => !r.ok) ?? []) {
    issues.push(result.summary);
  }
  failure.textContent = issues.join("\n\n");
  span.after(failure);
  editing.failure = failure;
}

/** Open the in-place editor over a span, seeded with the field's source. */
function openEditor(span, ref, value) {
  if (editing) closeEditor();
  const original = span.innerHTML;
  span.classList.add("scr-editing");
  span.innerHTML = "";
  const box = el("span", {
    class: "scr-editor",
    contenteditable: "plaintext-only",
    spellcheck: "true",
  });
  box.textContent = value;
  const stageline = el("span", { class: "scr-stage", text: "" });
  const bar = el("span", { class: "scr-editbar" }, [
    el("button", {
      class: "scr-btn scr-primary scr-btn-inline",
      text: "Save",
      onclick: submitEditor,
    }),
    el("button", {
      class: "scr-btn scr-btn-inline",
      text: "Cancel",
      onclick: closeEditor,
    }),
    stageline,
  ]);
  span.append(box, bar);
  editing = { span, ref, box, bar, stageline, original, failure: null };
  box.focus();
  const range = document.createRange();
  range.selectNodeContents(box);
  range.collapse(false);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitEditor();
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      closeEditor();
    }
  });
}

/** Fetch an entry and open the editor for one of its editable fields. */
async function editField(span, ref) {
  const response = await fetch(`/api/entry/${ref.registry}/${ref.slug}`);
  if (!response.ok) return;
  const entry = await response.json();
  const field = entry.fields.find((candidate) => candidate.path === ref.field);
  if (!field || !field.editable) return;
  renderRail(entry, ref.field);
  openEditor(span, ref, field.value ?? "");
}

/** Select a provenance span and load its entry into the rail. */
async function selectSpan(span) {
  if (selected) selected.classList.remove("scr-selected");
  selected = span;
  span.classList.add("scr-selected");
  const ref = parseRef(span.dataset.ref);
  const response = await fetch(`/api/entry/${ref.registry}/${ref.slug}`);
  if (!response.ok) return;
  renderRail(await response.json(), ref.field);
}

doc.addEventListener("click", (event) => {
  if (editing && editing.span.contains(event.target)) return;
  const outside = event.target.closest("a[data-outside]");
  if (outside) {
    event.preventDefault();
    outside.title = `points outside the studio: ${outside.dataset.outside}`;
    return;
  }
  const span = event.target.closest(".scr-field");
  if (!span) return;
  const ref = parseRef(span.dataset.ref);
  if (event.metaKey || event.ctrlKey) {
    openInIde(ref);
    return;
  }
  selectSpan(span);
});

doc.addEventListener("dblclick", (event) => {
  const span = event.target.closest(".scr-field");
  if (!span || span.classList.contains("scr-locked")) return;
  if (editing && editing.span === span) return;
  event.preventDefault();
  editField(span, parseRef(span.dataset.ref));
});

doc.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const span = event.target.closest?.(".scr-field");
  if (span) selectSpan(span);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && selected) {
    selected.classList.remove("scr-selected");
    selected = null;
  }
});

/** Pull server state: dirty files, the reading grade, and guard reports. */
async function refreshState() {
  const response = await fetch("/api/state");
  if (!response.ok) return;
  const state = await response.json();
  lastReports = new Map(
    state.reports.map((report) => [report.registry, report]),
  );
  const dirty = document.getElementById("scr-dirty");
  if (dirty) {
    dirty.hidden = state.dirty.length === 0;
    dirty.title = state.dirty.join("\n");
  }
  const grade = document.getElementById("scr-grade");
  const reading = state.standards.find((s) => s.name === "plain_reading_grade");
  if (grade && reading && reading.value !== undefined) {
    grade.textContent = `grade ${reading.value}${
      reading.limit ? ` / ${reading.limit}` : ""
    }`;
  }
  if (currentEntry) {
    renderRail(
      currentEntry,
      selected ? parseRef(selected.dataset.ref).field : undefined,
    );
  }
}

/* Deep-focus support: /page/x#entry:… or a cite link with data-focus. */
document.addEventListener("click", (event) => {
  const cite = event.target.closest("a[data-focus]");
  if (!cite) return;
  sessionStorage.setItem("scr-focus", cite.dataset.focus);
});

/** After a cite-link navigation, scroll to and select the stored target. */
function focusStored() {
  const stored = sessionStorage.getItem("scr-focus");
  if (!stored) return;
  sessionStorage.removeItem("scr-focus");
  const span = doc.querySelector(
    `.scr-field[data-ref^="${CSS.escape(stored)}:"]`,
  );
  if (span) {
    span.scrollIntoView({ block: "center" });
    selectSpan(span);
  }
}

const events = new EventSource("/events");
events.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  if (payload.type === "snapshot") {
    if (editing) {
      editing.stageline.textContent =
        "canon changed on disk — save re-proves against it";
      return;
    }
    location.reload();
    return;
  }
  if (payload.type === "save" && editing) {
    editing.stageline.textContent = `${payload.stage}…`;
    return;
  }
  if (payload.type === "guards") refreshState();
});

refreshState();
focusStored();
