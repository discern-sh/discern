/** Test-module discovery shared by repository scheduling and the canary. */

/** Repo-relative paths of every test module directly under `dir`. */
export async function listTestModules(
  dir: string = "tests",
): Promise<string[]> {
  const modules: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith("_test.ts")) {
      modules.push(`${dir}/${entry.name}`);
    }
  }
  return modules;
}
