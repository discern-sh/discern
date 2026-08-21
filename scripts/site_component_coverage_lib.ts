/** Measure selected design-system components against the live HTML they style. */

import { packageManifest } from "discern-design-system";
import {
  DESIGN_SYSTEM_BUNDLES,
  type DesignSystemBundleName,
} from "../site/design_system.ts";
import { loadDocsSite } from "../site/docs.ts";
import { handler, liveHtmlRoutes } from "../site/serve.ts";

export interface ManifestComponent {
  readonly id: string;
  readonly group: string;
  readonly dependencies: readonly string[];
  readonly ownedClasses: readonly string[];
}

export interface ComponentSelection {
  readonly components: readonly string[];
  readonly groups: readonly string[];
}

export interface RenderedRoute {
  readonly route: string;
  readonly html: string;
}

export interface BundleComponentCoverage {
  readonly bundle: string;
  readonly routes: readonly string[];
  readonly selected: readonly string[];
  readonly witnessed: readonly string[];
  readonly gaps: readonly string[];
  readonly routeGaps: readonly string[];
}

const BROWSER_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 design-system coverage",
};

/** Extract the class tokens present in trusted, server-rendered HTML. */
export function htmlClassTokens(html: string): Set<string> {
  const classes = new Set<string>();
  for (const attribute of html.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/g)) {
    for (const token of (attribute[2] ?? "").split(/\s+/)) {
      if (token !== "") classes.add(token);
    }
  }
  return classes;
}

/** Expand explicit roots, selected groups, and dependencies in manifest order. */
export function resolveSelectedComponents(
  selection: ComponentSelection,
  components: readonly ManifestComponent[],
): ManifestComponent[] {
  const byId = new Map(
    components.map((component) => [component.id, component]),
  );
  const seeds = new Set(selection.components);
  const groups = new Set(selection.groups);
  for (const component of components) {
    if (groups.has(component.group)) seeds.add(component.id);
  }

  const resolved = new Set<string>();
  const visit = (id: string): void => {
    if (resolved.has(id)) return;
    const component = byId.get(id);
    if (component === undefined) {
      throw new Error(`design-system selection names unknown component ${id}`);
    }
    for (const dependency of component.dependencies) visit(dependency);
    resolved.add(id);
  };
  for (const component of components) {
    if (seeds.has(component.id)) visit(component.id);
  }
  for (const seed of seeds) {
    if (!byId.has(seed)) visit(seed);
  }
  return components.filter((component) => resolved.has(component.id));
}

/** Whether one canonical route belongs to a declared bundle route or subtree. */
export function routeUsesBundle(
  route: string,
  roots: readonly string[],
): boolean {
  return roots.some((root) =>
    root === "/"
      ? route === "/"
      : route === root || route.startsWith(`${root}/`)
  );
}

/** Compare one resolved bundle selection with its assigned rendered routes. */
export function measureBundleComponentCoverage(
  bundle: string,
  selection: ComponentSelection,
  components: readonly ManifestComponent[],
  renderedRoutes: readonly RenderedRoute[],
): BundleComponentCoverage {
  if (renderedRoutes.length === 0) {
    throw new Error(`design-system bundle ${bundle} has no live routes`);
  }
  const selected = resolveSelectedComponents(selection, components);
  const allClasses = new Set(
    renderedRoutes.flatMap((rendered) => [...htmlClassTokens(rendered.html)]),
  );
  const witnessed = selected.filter((component) =>
    component.ownedClasses.some((ownedClass) => allClasses.has(ownedClass))
  );
  const witnessedIds = new Set(witnessed.map((component) => component.id));
  const ownedClasses = new Set(
    selected.flatMap((component) => [...component.ownedClasses]),
  );
  return {
    bundle,
    routes: renderedRoutes.map((rendered) => rendered.route),
    selected: selected.map((component) => component.id),
    witnessed: witnessed.map((component) => component.id),
    gaps: selected.filter((component) => !witnessedIds.has(component.id)).map(
      (component) => component.id,
    ),
    routeGaps: renderedRoutes.filter((rendered) =>
      ![...htmlClassTokens(rendered.html)].some((token) =>
        ownedClasses.has(token)
      )
    ).map((rendered) => rendered.route),
  };
}

/** Render every public HTML route and measure it against its one assigned bundle. */
export async function measureSiteComponentCoverage(): Promise<
  BundleComponentCoverage[]
> {
  const routes = liveHtmlRoutes(await loadDocsSite());
  const bundleNames = Object.keys(
    DESIGN_SYSTEM_BUNDLES,
  ) as DesignSystemBundleName[];
  const rendered = new Map<string, string>();
  for (const route of routes) {
    const owners = bundleNames.filter((name) =>
      routeUsesBundle(route, DESIGN_SYSTEM_BUNDLES[name].routes)
    );
    if (owners.length !== 1) {
      throw new Error(
        `live HTML route ${route} belongs to ${owners.length} design-system bundles`,
      );
    }
    const response = await handler(
      new Request(`https://discern.sh${route}`, { headers: BROWSER_HEADERS }),
    );
    if (!response.ok) {
      throw new Error(`live HTML route ${route} returned ${response.status}`);
    }
    rendered.set(route, await response.text());
  }

  return bundleNames.map((name) => {
    const selection = DESIGN_SYSTEM_BUNDLES[name];
    return measureBundleComponentCoverage(
      name,
      selection,
      packageManifest.components,
      routes.filter((route) => routeUsesBundle(route, selection.routes)).map((
        route,
      ) => ({ route, html: rendered.get(route) ?? "" })),
    );
  });
}
