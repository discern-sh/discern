/** Structural guards for the survey figure's fitted-inscription composition. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  SURVEY_GEOMETRY,
  SURVEY_RUN_EDGES,
  SURVEY_TRIANGLE,
  type SurveyPoint,
} from "../art/browser/survey.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const ARTWORK_CSS = new URL("../art/browser/survey.css", import.meta.url);

/** The plate every figure shares. */
const PLATE = { width: 760, height: 540 } as const;

/** Distance from a point to a straight segment, computed independently. */
function distanceToSegment(
  point: SurveyPoint,
  from: SurveyPoint,
  to: SurveyPoint,
): number {
  const runX = to.x - from.x;
  const runY = to.y - from.y;
  const t = ((point.x - from.x) * runX + (point.y - from.y) * runY) /
    (runX * runX + runY * runY);
  const clamped = Math.min(1, Math.max(0, t));
  return Math.hypot(
    point.x - (from.x + runX * clamped),
    point.y - (from.y + runY * clamped),
  );
}

/** Signed shoelace area of a closed polygon. */
function area(points: readonly SurveyPoint[]): number {
  let sum = 0;
  for (const [index, from] of points.entries()) {
    const to = points[(index + 1) % points.length];
    assert(to !== undefined);
    sum += from.x * to.y - to.x * from.y;
  }
  return Math.abs(sum) / 2;
}

Deno.test("the survey's triangle rests exactly on the found figure's edges", () => {
  const { polygon, contacts } = SURVEY_GEOMETRY;
  assertEquals(polygon.length, 5, "the found figure has five sides");

  for (const [index, vertex] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length];
    const after = polygon[(index + 2) % polygon.length];
    assert(next !== undefined && after !== undefined);
    const cross = (next.x - vertex.x) * (after.y - next.y) -
      (next.y - vertex.y) * (after.x - next.x);
    assert(cross > 0, "the found figure stays convex and winds one way");
    assert(
      vertex.x >= 72 && vertex.x <= PLATE.width - 72 &&
        vertex.y >= 72 && vertex.y <= PLATE.height - 72,
      "the found figure keeps generous margins",
    );
  }

  assertEquals(contacts.length, 3, "one contact per triangle vertex");
  assertEquals(
    new Set(contacts.map((contact) => contact.edge)).size,
    contacts.length,
    "each contact rests on its own polygon edge",
  );
  for (const contact of contacts) {
    assert(
      contact.t > 0.05 && contact.t < 0.95,
      "contacts rest within their edges, never on a corner",
    );
  }

  assertEquals(SURVEY_TRIANGLE.length, contacts.length);
  for (const [index, vertex] of SURVEY_TRIANGLE.entries()) {
    const contact = contacts[index];
    assert(contact !== undefined);
    const from = polygon[contact.edge];
    const to = polygon[(contact.edge + 1) % polygon.length];
    assert(from !== undefined && to !== undefined);
    assert(
      distanceToSegment(vertex, from, to) < 0.005,
      `triangle vertex ${index} must rest on polygon edge ${contact.edge}`,
    );
  }

  const ratio = area(SURVEY_TRIANGLE) / area(polygon);
  assert(
    ratio > 0.25 && ratio < 0.6,
    `the inscribed triangle must fill the figure comfortably, got ${ratio}`,
  );

  assertEquals(
    SURVEY_RUN_EDGES.length,
    polygon.length - contacts.length,
    "every unmeasured edge carries a dimension run",
  );
  for (const edge of SURVEY_RUN_EDGES) {
    assert(
      contacts.every((contact) => contact.edge !== edge),
      "dimension runs stay off the contact edges",
    );
  }

  assert(
    SURVEY_GEOMETRY.contacts[SURVEY_GEOMETRY.register.contact] !== undefined,
    "the accent registration pair rests at a real contact",
  );
  assertEquals(
    SURVEY_GEOMETRY.extension.pathLength,
    SURVEY_GEOMETRY.extension.reach - SURVEY_GEOMETRY.extension.gap,
    "the extension dash metric matches its drawn length",
  );
});

Deno.test("the gallery renders the survey plate twice with its apparatus", () => {
  const dom = new JSDOM(renderArtGallery());
  const figures = [...dom.window.document.querySelectorAll(".fig-survey")];
  assertEquals(figures.length, 2);
  for (const figure of figures) {
    const svg = figure.querySelector('svg.fig-survey__art[role="img"]');
    assert(svg !== null);

    assertEquals(svg.querySelectorAll("[data-survey-found]").length, 1);
    const triangle = svg.querySelector("[data-survey-triangle]");
    assert(triangle !== null);
    assertEquals(
      triangle.getAttribute("pathLength"),
      String(SURVEY_GEOMETRY.trianglePathLength),
    );
    assert((triangle.getAttribute("d") ?? "").endsWith("Z"));

    const extensions = [...svg.querySelectorAll(".fig-survey__extension")];
    assertEquals(extensions.length, SURVEY_GEOMETRY.contacts.length * 2);
    for (const extension of extensions) {
      assert(
        /fig-survey__extension--[abc]/.test(
          extension.getAttribute("class") ?? "",
        ),
      );
    }
    assertEquals(
      svg.querySelectorAll(".fig-survey__run").length,
      SURVEY_RUN_EDGES.length,
    );
    assertEquals(
      svg.querySelectorAll(".fig-survey__run-tick").length,
      SURVEY_RUN_EDGES.length * SURVEY_GEOMETRY.run.tickFractions.length,
    );
    assertEquals(
      svg.querySelectorAll(".fig-survey__arc").length,
      SURVEY_GEOMETRY.arcs.length,
    );
    assertEquals(svg.querySelectorAll(".fig-survey__register").length, 2);

    assertEquals(svg.querySelectorAll("text").length, 0);
    const smil = "animate, animateTransform, animateMotion, set";
    assertEquals(svg.querySelectorAll(smil).length, 0);
    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/).filter(Boolean);
    assertEquals(labelledBy.length, 2);
    for (const id of labelledBy) {
      assert(svg.querySelector(`#${id}`) !== null, `${id} must stay local`);
    }
  }
  dom.window.close();
});

Deno.test("the survey holds its subject still and spends its accent once", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);

  assertEquals(
    css.split("var(--fig-accent)").length,
    2,
    "exactly one accent voice",
  );

  const found = css.match(/\.fig-survey__found\s*\{([^}]*)\}/);
  assert(found !== null, "the found figure declares its paint");
  assert(
    !/animation|transform/.test(found[1] ?? ""),
    "the found figure never moves",
  );
  assert(
    !css.includes("fig-survey-found"),
    "no keyframes may target the found figure",
  );

  for (
    const dash of [
      SURVEY_GEOMETRY.trianglePathLength,
      SURVEY_GEOMETRY.extension.pathLength,
      SURVEY_GEOMETRY.run.pathLength,
      SURVEY_GEOMETRY.arcPathLength,
      SURVEY_GEOMETRY.register.pathLength,
    ]
  ) {
    assertStringIncludes(
      css,
      `stroke-dasharray: ${dash}`,
      "every dash metric derives from the geometry authority",
    );
  }
});
