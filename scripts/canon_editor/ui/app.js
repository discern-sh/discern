/* Canon Editor's browser behavior: span selection, the entry
   inspector rail, IDE jumps, guard runs, the live change feed, and the
   workbench — the fixed strip that carries all editing chrome so the
   document itself never shifts while a field editor is open. */

const boot = JSON.parse(
  document.getElementById("canon-editor-boot").textContent,
);
const rail = document.getElementById("canon-editor-rail");
const doc = document.getElementById("canon-editor-doc");
const railEmptyHtml = rail.innerHTML;

const bench = {
  root: document.getElementById("canon-editor-bench"),
  path: document.getElementById("canon-editor-bench-path"),
  status: document.getElementById("canon-editor-bench-status"),
  details: document.getElementById("canon-editor-bench-details"),
  detailsToggle: document.getElementById("canon-editor-bench-details-toggle"),
  cancel: document.getElementById("canon-editor-bench-cancel"),
  save: document.getElementById("canon-editor-bench-save"),
};

let selected = null;
let currentEntry = null;
let editing = null;
const runningGuards = new Set();

/** The pending plain-twin reviews that editing has queued. */
function twinList() {
  try {
    return JSON.parse(localStorage.getItem("canon-editor-twins") ?? "[]");
  } catch {
    // discern-best-effort: canon-editor-twin-storage-fallback
    return [];
  }
}

/** Persist the twin list, bounded so it cannot grow forever. */
function saveTwinList(list) {
  localStorage.setItem("canon-editor-twins", JSON.stringify(list.slice(-20)));
}

/** Queue a twin review after a technical-register save. */
function pushTwin(ref, field) {
  const list = twinList().filter(
    (item) => !(item.slug === ref.slug && item.field === field),
  );
  list.push({ registry: ref.registry, slug: ref.slug, field });
  saveTwinList(list);
}

/** Clear a twin review once its plain field is opened. */
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

/** Send one same-origin JSON POST with this process's write authority. */
function postJson(path, body) {
  return fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [boot.requestTokenHeader]: boot.requestToken,
    },
    body: JSON.stringify(body),
  });
}

/** Ask the server to jump PhpStorm to an entry or one of its fields. */
async function openInIde(ref) {
  const response = await postJson("/api/open", ref);
  return response.ok ? await response.json() : { opened: false };
}

/** A rail link that navigates to a cited entry's page and focuses it there. */
function citeLink(target) {
  const pageByRegistry = {
    feature: "feature-canon",
    benefit: "feature-canon-human-benefits",
    "agent-benefit": "feature-canon-agent-benefits",
    demand: "demand-canon",
    practice: "practice-canon",
    glossary: "glossary",
    claims: "claims-and-evidence",
  };
  return el("a", {
    class: "canon-editor-cite",
    href: `/page/${pageByRegistry[target.registry] ?? "feature-canon"}`,
    "data-focus": `${target.registry}:${target.slug}`,
  }, [
    document.createTextNode(target.label + " "),
    el("small", { text: target.registry }),
  ]);
}

/** The verdict chip summarizing a registry's guard state. */
function guardChip(registry, report) {
  if (runningGuards.has(registry)) {
    return el("span", { class: "canon-editor-chip", text: "⟳ running…" });
  }
  if (!report) {
    return el("span", { class: "canon-editor-chip", text: "not run yet" });
  }
  return el("span", {
    class: report.ok
      ? "canon-editor-chip canon-editor-chip-ok"
      : "canon-editor-chip canon-editor-chip-fail",
    text: report.ok ? "✓ guards green" : "✗ guards red",
  });
}

let lastReports = new Map();

/** The IDE-jump button with visible feedback for a jump that cannot land. */
function ideButton(entry, activeField) {
  const hint = el("div", { class: "canon-editor-open-hint" });
  hint.hidden = true;
  const button = el("button", {
    class: "canon-editor-btn",
    text: "Open in PhpStorm",
  });
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Opening…";
    hint.hidden = true;
    const result = await openInIde({
      registry: entry.registry,
      slug: entry.slug,
      field: activeField,
    });
    if (result.opened) {
      button.textContent = "✓ sent to PhpStorm";
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Open in PhpStorm";
      }, 2200);
      return;
    }
    button.disabled = false;
    button.textContent = "Open in PhpStorm";
    hint.textContent = result.hint ?? "The jump could not be delivered.";
    hint.hidden = false;
  });
  const wrap = el("div", {});
  wrap.append(button, hint);
  return wrap;
}

/** Fill the inspector rail: source, fields, citation web, and guard panel. */
function renderRail(entry, activeField) {
  currentEntry = entry;
  rail.textContent = "";
  rail.append(
    el("p", { class: "canon-editor-rail-title", text: entry.title }),
    el("div", {
      class: "canon-editor-kind",
      text: `${entry.registry} ${entry.kind} · ${entry.id}`,
    }),
  );

  const active = entry.fields.find((field) => field.path === activeField);
  if (active?.editor === "prose" && selected) {
    const span = selected;
    rail.append(
      el("button", {
        class: "canon-editor-btn canon-editor-primary",
        text: `Edit ${active.path}`,
        onclick: () =>
          openEditor(
            span,
            { registry: entry.registry, slug: entry.slug, field: active.path },
            active.value ?? "",
            entry.kind,
          ),
      }),
    );
  }

  rail.append(
    el("h3", { text: "Source" }),
    el("div", {
      class: "canon-editor-guardline",
      text: entry.file ? `${entry.file}:${entry.line}` : "position unknown",
    }),
    ideButton(entry, activeField),
  );
  const pendingTwins = twinList().filter((item) => item.slug === entry.slug);
  for (const twin of pendingTwins) {
    rail.append(
      el("div", {
        class: "canon-editor-chip canon-editor-chip-dirty canon-editor-twin",
        text: "● technical edited — review the plain twin",
      }),
      el("button", {
        class: "canon-editor-btn",
        text: `Open ${twin.field} on the plain page`,
        onclick: () => {
          sessionStorage.setItem("canon-editor-focus", `feature:${twin.slug}`);
          location.href = "/page/feature-canon-plain";
        },
      }),
    );
  }

  if (entry.fields.length > 0) {
    rail.append(el("h3", { text: "Fields" }));
    for (const field of entry.fields) {
      const row = el("div", {
        class: "canon-editor-fieldrow",
        "data-active": String(
          field.path === activeField ||
            (editing?.mode === "list" && editing.ref.field === field.path),
        ),
      });
      row.append(el("span", { text: field.path }));
      if (field.editor === "list") {
        row.append(el("button", {
          class: "canon-editor-field-action",
          type: "button",
          text: `Pick · ${field.value?.length ?? 0}`,
          title: `choose ${field.picker.source} values`,
          onclick: () => openListEditor(entry, field, row),
        }));
      } else {
        row.append(el("span", {
          text: field.editor === "prose" ? "✎" : "🔒 " + field.kind,
          title: field.editor === "prose"
            ? "editable prose"
            : "derived or structured — edit at the source",
        }));
      }
      rail.append(row);
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
  rail.append(el("div", { class: "canon-editor-guards" }, [
    guardChip(entry.registry, lastReports.get(entry.registry)),
    ...(registryGuards?.guards ?? []).map((file) =>
      el("div", { class: "canon-editor-guardline", text: file })
    ),
  ]));
  const report = lastReports.get(entry.registry);
  if (report && !report.ok) {
    for (const result of report.results.filter((r) => !r.ok)) {
      rail.append(
        el("pre", { class: "canon-editor-failure", text: result.summary }),
      );
    }
  }
  const runButton = el("button", {
    class: "canon-editor-btn",
    text: runningGuards.has(entry.registry)
      ? "⟳ Running guards…"
      : "Run this registry's guards",
    onclick: () => {
      if (editing) return;
      runningGuards.add(entry.registry);
      renderRail(currentEntry, activeField);
      postJson("/api/guards/run", { registry: entry.registry });
    },
  });
  runButton.disabled = runningGuards.has(entry.registry);
  rail.append(runButton);
}

/** Clear the selection and return the rail to its resting state. */
function deselect() {
  if (selected) selected.classList.remove("canon-editor-selected");
  selected = null;
  currentEntry = null;
  rail.innerHTML = railEmptyHtml;
}

/** Ordered equality for typed-list drafts. */
function sameValues(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

/** Whether the open editor currently carries a change worth saving. */
function draftChanged() {
  if (!editing || editing.mode === "prose") return true;
  return !sameValues(editing.expected, editing.values);
}

/** Put the workbench into one of its states: lint, saving, or red. */
function benchState(state) {
  bench.root.dataset.state = state;
  const busy = state === "saving";
  bench.save.disabled = busy || !draftChanged();
  bench.cancel.disabled = busy;
  if (state !== "red") {
    bench.details.hidden = true;
    bench.detailsToggle.hidden = true;
    bench.detailsToggle.setAttribute("aria-expanded", "false");
  }
}

/** Reset the workbench status area, keeping a disk-change notice if queued. */
function benchStatusReset() {
  bench.status.textContent = "";
  if (editing?.diskNote) {
    bench.status.append(el("span", {
      class: "canon-editor-chip canon-editor-chip-dirty",
      text: "⚠ canon changed on disk — Save re-proves against it",
    }));
  }
  if (editing?.mode === "list") {
    bench.status.append(
      el("span", {
        class: "canon-editor-chip",
        text: `${editing.values.length} selected`,
      }),
      el("span", {
        class: "canon-editor-bench-stage",
        text: "existing order is preserved; additions append",
      }),
    );
  }
}

/** Open the workbench for a field about to be edited. */
function benchOpen(ref) {
  bench.path.textContent = `${ref.registry} · ${ref.slug} · ${ref.field}`;
  benchState("lint");
  benchStatusReset();
  bench.root.hidden = false;
  document.body.classList.add("canon-editor-benched");
}

/** Hide the workbench when field editing ends. */
function benchClose() {
  bench.root.hidden = true;
  document.body.classList.remove("canon-editor-benched");
}

/** Close either editor, restoring the prose span or removing the picker. */
function closeEditor() {
  if (!editing) return;
  const closed = editing;
  if (closed.mode === "prose") {
    closed.span.innerHTML = closed.original;
    closed.span.classList.remove("canon-editor-editing", "canon-editor-saving");
  } else {
    closed.panel.remove();
    closed.row.dataset.active = "false";
  }
  editing = null;
  benchClose();
  if (closed.mode === "prose") {
    if (selected) selected.classList.remove("canon-editor-selected");
    selected = closed.span;
    closed.span.classList.add("canon-editor-selected");
  }
}

/** Human wording for the save pipeline's stage names. */
function stageLabel(stage) {
  const labels = {
    patch: "patching the registry",
    format: "formatting",
    render: "re-rendering the canon",
    prose: "checking the prose",
    guards: "running the guards",
  };
  return labels[stage] ?? stage;
}

/** Submit the inline editor through the save-and-prove loop. */
async function submitEditor() {
  if (!editing || bench.root.dataset.state === "saving") return;
  const activeEditor = editing;
  const value = activeEditor.mode === "prose"
    ? activeEditor.box.textContent
    : [...activeEditor.values];
  const { ref, expected } = activeEditor;
  benchState("saving");
  benchStatusReset();
  const stage = el("span", {
    class: "canon-editor-bench-stage",
    text: "⟳ saving…",
  });
  bench.status.append(stage);
  activeEditor.stageEl = stage;
  if (activeEditor.mode === "prose") {
    activeEditor.span.classList.add("canon-editor-saving");
  } else {
    activeEditor.panel.classList.add("canon-editor-saving");
  }
  const response = await postJson("/api/save", { ...ref, expected, value });
  const report = await response.json();
  if (editing !== activeEditor) return;
  if (activeEditor.mode === "prose") {
    activeEditor.span.classList.remove("canon-editor-saving");
  } else {
    activeEditor.panel.classList.remove("canon-editor-saving");
  }
  activeEditor.stageEl = null;
  if (report.ok) {
    if (activeEditor.mode === "prose") {
      if (report.twin) pushTwin(ref, report.twin);
      if (ref.field.startsWith("plain.")) clearTwin(ref);
    }
    sessionStorage.setItem("canon-editor-focus", `${ref.registry}:${ref.slug}`);
    sessionStorage.setItem(
      "canon-editor-saved",
      JSON.stringify({
        field: ref.field,
        pages: report.pages?.length ?? 0,
        grade: report.grade ?? null,
      }),
    );
    editing = null;
    location.reload();
    return;
  }
  benchState("red");
  benchStatusReset();
  const wrote = report.restored === true;
  bench.status.append(el("span", {
    class: "canon-editor-bench-verdict",
    text: wrote
      ? `✗ rolled back while ${stageLabel(report.stage)} — every byte restored`
      : `✗ refused while ${stageLabel(report.stage)} — nothing was written`,
  }));
  const issues = [report.issue];
  for (const result of report.guards?.results?.filter((r) => !r.ok) ?? []) {
    issues.push(result.summary);
  }
  bench.details.textContent = issues.join("\n\n");
  bench.detailsToggle.hidden = false;
  bench.detailsToggle.textContent = "Show details";
  bench.details.hidden = true;
}

/** Ask the server to judge the draft; on a pause, Vale joins the panel. */
async function lintDraft(vale) {
  if (!editing || editing.mode !== "prose") return;
  const { ref, box, kind } = editing;
  const response = await postJson("/api/lint", {
    registry: ref.registry,
    kind,
    field: ref.field,
    value: box.textContent,
    vale,
  });
  if (!response.ok || !editing || editing.box !== box) return;
  if (bench.root.dataset.state !== "lint") return;
  const report = await response.json();
  benchStatusReset();
  if (report.grade !== null && report.grade !== undefined) {
    bench.status.append(el("span", {
      class: "canon-editor-chip",
      text: `field grade ${report.grade.toFixed(1)}`,
      title:
        "Flesch–Kincaid over this field alone — the standard judges the whole corpus",
    }));
  }
  for (const finding of report.findings) {
    bench.status.append(el("span", {
      class: finding.severity === "error"
        ? "canon-editor-chip canon-editor-chip-fail"
        : finding.severity === "warning"
        ? "canon-editor-chip canon-editor-chip-dirty"
        : "canon-editor-chip",
      text: `${
        finding.severity === "suggestion" ? "· " : "⚠ "
      }${finding.message}`,
    }));
  }
  if (report.findings.length === 0 && vale) {
    bench.status.append(
      el("span", {
        class: "canon-editor-chip canon-editor-chip-ok",
        text: "✓ register clean",
      }),
    );
  }
}

/** Open a searchable checkbox picker for one supported ordered-list field. */
function openListEditor(entry, field, row) {
  if (editing) closeEditor();
  const expected = Array.isArray(field.value) ? [...field.value] : [];
  const live = new Set(field.picker.options.map((option) => option.value));
  const options = [
    ...field.picker.options.map((option) => ({ ...option, live: true })),
    ...expected.filter((value) => !live.has(value)).map((value) => ({
      value,
      label: "no longer live",
      group: "stale",
      live: false,
    })),
  ];
  const panel = el("section", { class: "canon-editor-picker" });
  const search = el("input", {
    class: "canon-editor-picker-search",
    type: "search",
    placeholder: `Filter ${field.picker.source} values…`,
    "aria-label": `Filter ${field.path} choices`,
  });
  const choices = el("div", { class: "canon-editor-picker-choices" });
  panel.append(search, choices);
  row.after(panel);
  row.dataset.active = "true";
  const ref = {
    registry: entry.registry,
    slug: entry.slug,
    field: field.path,
  };
  editing = {
    mode: "list",
    ref,
    expected,
    values: [...expected],
    panel,
    row,
    diskNote: false,
    stageEl: null,
  };

  const renderChoices = () => {
    if (editing?.mode !== "list" || editing.panel !== panel) return;
    const query = search.value.trim().toLowerCase();
    choices.textContent = "";
    let shown = 0;
    for (const option of options) {
      const haystack = `${option.value} ${option.label} ${option.group ?? ""}`
        .toLowerCase();
      if (query !== "" && !haystack.includes(query)) continue;
      shown += 1;
      const checked = editing.values.includes(option.value);
      const checkbox = el("input", { type: "checkbox" });
      checkbox.checked = checked;
      const label = option.label === option.value
        ? option.value
        : `${option.value} — ${option.label}`;
      const choice = el("label", {
        class: option.live
          ? "canon-editor-picker-choice"
          : "canon-editor-picker-choice canon-editor-stale",
      }, [
        checkbox,
        el("span", { text: label }),
        ...(option.group === undefined
          ? []
          : [el("small", { text: option.group })]),
      ]);
      checkbox.addEventListener("change", () => {
        if (editing?.mode !== "list" || editing.panel !== panel) return;
        const at = editing.values.indexOf(option.value);
        if (checkbox.checked && at === -1) {
          if (editing.expected.includes(option.value)) {
            const selected = new Set([...editing.values, option.value]);
            const additions = editing.values.filter((value) =>
              !editing.expected.includes(value)
            );
            editing.values.splice(
              0,
              editing.values.length,
              ...editing.expected.filter((value) => selected.has(value)),
              ...additions,
            );
          } else {
            editing.values.push(option.value);
          }
        }
        if (!checkbox.checked && at !== -1) editing.values.splice(at, 1);
        if (!option.live && !checkbox.checked) {
          checkbox.disabled = true;
          choice.dataset.removed = "true";
        }
        benchState("lint");
        benchStatusReset();
      });
      choices.append(choice);
    }
    if (shown === 0) {
      choices.append(el("p", {
        class: "canon-editor-picker-empty",
        text: "No live values match that filter.",
      }));
    }
  };
  search.addEventListener("input", renderChoices);
  renderChoices();
  benchOpen(ref);
  search.focus();
}

/** Open the in-place editor over a span, seeded with the field's source. */
function openEditor(span, ref, value, kind) {
  if (editing) closeEditor();
  if (selected) selected.classList.remove("canon-editor-selected");
  selected = span;
  const original = span.innerHTML;
  span.classList.add("canon-editor-editing");
  span.classList.remove("canon-editor-selected");
  span.innerHTML = "";
  const box = el("span", {
    class: "canon-editor-editor",
    contenteditable: "plaintext-only",
    spellcheck: "true",
  });
  box.textContent = value;
  span.append(box);
  editing = {
    mode: "prose",
    span,
    ref,
    box,
    kind,
    original,
    expected: value,
    diskNote: false,
    stageEl: null,
  };
  benchOpen(ref);
  let fastTimer = null;
  let valeTimer = null;
  box.addEventListener("input", () => {
    if (bench.root.dataset.state === "red") {
      benchState("lint");
      benchStatusReset();
    }
    if (fastTimer) clearTimeout(fastTimer);
    if (valeTimer) clearTimeout(valeTimer);
    fastTimer = setTimeout(() => lintDraft(false), 160);
    valeTimer = setTimeout(() => lintDraft(true), 900);
  });
  lintDraft(true);
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
      if (bench.root.dataset.state !== "saving") closeEditor();
    }
  });
  // Nudge the page only when the bench would sit over the field being edited.
  const boxRect = box.getBoundingClientRect();
  const benchTop = bench.root.getBoundingClientRect().top;
  if (boxRect.bottom > benchTop) {
    globalThis.scrollBy({
      top: boxRect.bottom - benchTop + 32,
      behavior: "smooth",
    });
  }
}

/** Fetch an entry and open the editor for one of its editable fields. */
async function editField(span, ref) {
  const response = await fetch(`/api/entry/${ref.registry}/${ref.slug}`);
  if (!response.ok) return;
  const entry = await response.json();
  const field = entry.fields.find((candidate) => candidate.path === ref.field);
  if (!field || field.editor !== "prose") return;
  renderRail(entry, ref.field);
  openEditor(span, ref, field.value ?? "", entry.kind);
}

/** Select a provenance span and load its entry into the rail. */
async function selectSpan(span) {
  if (selected) selected.classList.remove("canon-editor-selected");
  selected = span;
  span.classList.add("canon-editor-selected");
  const ref = parseRef(span.dataset.ref);
  const response = await fetch(`/api/entry/${ref.registry}/${ref.slug}`);
  if (!response.ok) return;
  renderRail(await response.json(), ref.field);
}

doc.addEventListener("click", (event) => {
  if (editing?.mode === "list") return;
  if (editing?.mode === "prose" && editing.span.contains(event.target)) return;
  const outside = event.target.closest("a[data-outside]");
  if (outside) {
    event.preventDefault();
    outside.title = `points outside the editor: ${outside.dataset.outside}`;
    return;
  }
  const span = event.target.closest(".canon-editor-field");
  if (!span) return;
  const ref = parseRef(span.dataset.ref);
  if (event.metaKey || event.ctrlKey) {
    openInIde(ref);
    return;
  }
  selectSpan(span);
});

doc.addEventListener("dblclick", (event) => {
  if (editing?.mode === "list") return;
  const span = event.target.closest(".canon-editor-field");
  if (!span || span.classList.contains("canon-editor-locked")) return;
  if (editing?.mode === "prose" && editing.span === span) return;
  event.preventDefault();
  editField(span, parseRef(span.dataset.ref));
});

doc.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const span = event.target.closest?.(".canon-editor-field");
  if (span) selectSpan(span);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (editing) {
      if (bench.root.dataset.state !== "saving") closeEditor();
    } else if (selected) deselect();
  }
});

/* Clicking outside a span, the rail, the bench, or the header clears the
   selection. An open field keeps its draft until an explicit action ends it. */
document.addEventListener("click", (event) => {
  if (editing || !selected) return;
  const target = event.target;
  // A target no longer in the document was re-rendered by its own click
  // (the rail's guard button does this); its ancestry cannot be judged,
  // and a click that changed the editor was never an "outside" click.
  if (target.isConnected === false) return;
  if (
    target.closest?.(".canon-editor-field") ||
    target.closest?.("#canon-editor-rail") ||
    target.closest?.("#canon-editor-bench") ||
    target.closest?.(".canon-editor-header")
  ) {
    return;
  }
  deselect();
});

bench.save.addEventListener("click", submitEditor);
bench.cancel.addEventListener("click", closeEditor);
bench.detailsToggle.addEventListener("click", () => {
  const open = bench.details.hidden;
  bench.details.hidden = !open;
  bench.detailsToggle.textContent = open ? "Hide details" : "Show details";
  bench.detailsToggle.setAttribute("aria-expanded", String(open));
});

/** Pull server state: dirty files, the reading grade, and guard reports. */
async function refreshState() {
  const response = await fetch("/api/state");
  if (!response.ok) return;
  const state = await response.json();
  lastReports = new Map(
    state.reports.map((report) => [report.registry, report]),
  );
  const dirty = document.getElementById("canon-editor-dirty");
  if (dirty) {
    dirty.hidden = state.dirty.length === 0;
    dirty.textContent = `● ${state.dirty.length} to commit`;
    dirty.title = `Uncommitted Canon Editor files:\n${state.dirty.join("\n")}`;
  }
  const grade = document.getElementById("canon-editor-grade");
  const reading = state.standards.find((s) => s.name === "plain_reading_grade");
  if (grade && reading && reading.value !== undefined) {
    grade.textContent = `grade ${reading.value}${
      reading.limit ? ` / ${reading.limit}` : ""
    }`;
  }
  if (currentEntry && !editing) {
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
  sessionStorage.setItem("canon-editor-focus", cite.dataset.focus);
});

/** After a cite-link navigation, scroll to and select the stored target. */
function focusStored() {
  const stored = sessionStorage.getItem("canon-editor-focus");
  if (!stored) return;
  sessionStorage.removeItem("canon-editor-focus");
  const span = doc.querySelector(
    `.canon-editor-field[data-ref^="${CSS.escape(stored)}:"]`,
  );
  if (span) {
    span.scrollIntoView({ block: "center" });
    selectSpan(span);
  }
}

/** After a green save's reload, confirm it plainly in the header for a bit. */
function showSavedNote() {
  const raw = sessionStorage.getItem("canon-editor-saved");
  if (!raw) return;
  sessionStorage.removeItem("canon-editor-saved");
  let note;
  try {
    note = JSON.parse(raw);
  } catch {
    // discern-best-effort: canon-editor-saved-note-fallback
    return;
  }
  const chip = el("span", {
    class: "canon-editor-chip canon-editor-chip-ok",
    text: `✓ saved ${note.field} — proven`,
    title: `${note.pages} page(s) rewritten${
      note.grade === null ? "" : `, corpus grade ${note.grade}`
    }`,
  });
  const host = document.querySelector(".canon-editor-header-right");
  host?.prepend(chip);
  setTimeout(() => chip.remove(), 6000);
}

const events = new EventSource("/events");
events.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  if (payload.type === "snapshot") {
    if (editing) {
      // Our own save broadcasts a snapshot on adoption; only a change that
      // arrives while a draft is open comes from outside this save.
      if (bench.root.dataset.state !== "saving" && !editing.diskNote) {
        editing.diskNote = true;
        benchStatusReset();
      }
      return;
    }
    location.reload();
    return;
  }
  if (payload.type === "save" && editing?.stageEl) {
    editing.stageEl.textContent = `⟳ ${stageLabel(payload.stage)}…`;
    return;
  }
  if (payload.type === "guards") {
    if (payload.status === "running") {
      runningGuards.add(payload.registry);
      if (currentEntry && !editing) {
        renderRail(
          currentEntry,
          selected ? parseRef(selected.dataset.ref).field : undefined,
        );
      }
      return;
    }
    runningGuards.delete(payload.registry);
    refreshState();
  }
});

refreshState();
focusStored();
showSavedNote();
