/** The ordinary gate runs on Linux and macOS, and release Mac binaries are notarized. */

import { assert, assertStringIncludes } from "@std/assert";

const GATE = new URL("../.github/workflows/gate.yml", import.meta.url);
const RELEASE = new URL("../.github/workflows/release.yml", import.meta.url);
const ENTITLEMENTS = new URL(
  "../scripts/macos_release_entitlements.plist",
  import.meta.url,
);
const gateSource = await Deno.readTextFile(GATE);
const releaseSource = await Deno.readTextFile(RELEASE);
const entitlementsSource = await Deno.readTextFile(ENTITLEMENTS);

function job(source: string, name: string, next: string): string {
  const start = source.indexOf(`  ${name}:`);
  const end = source.indexOf(`  ${next}:`, start + 1);
  assert(start >= 0, `${name} job exists`);
  assert(end > start, `${next} job follows ${name}`);
  return source.slice(start, end);
}

Deno.test("the ordinary gate runs in full on native macOS", () => {
  const macos = job(gateSource, "macos", "standards");
  assertStringIncludes(macos, "runs-on: macos-15");
  assertStringIncludes(macos, "vale_${VALE_VERSION}_macOS_arm64.tar.gz");
  assertStringIncludes(macos, "run: deno task dev done");
  assertStringIncludes(macos, "run: git diff --exit-code");
});

Deno.test("macOS release binaries are signed before smoke and notarized before checksum", () => {
  const build = job(releaseSource, "build", "release");
  const compile = build.indexOf("- name: Compile");
  const install = build.indexOf("- name: Install Apple release credentials");
  const sign = build.indexOf("- name: Sign ${{ matrix.output }}");
  const smoke = build.indexOf("- name: Smoke compiled binary");
  const notarize = build.indexOf("- name: Notarize ${{ matrix.output }}");
  const checksum = build.indexOf("- name: Checksum");
  const upload = build.indexOf("- name: Upload build artifacts");
  const cleanup = build.indexOf("- name: Remove Apple release credentials");

  assert(compile >= 0, "the target is compiled");
  assert(install > compile, "credentials are installed after compilation");
  assert(sign > install, "Developer ID signing follows credential installation");
  assert(smoke > sign, "the signed binary is smoked");
  assert(notarize > smoke, "the working signed binary is notarized");
  assert(checksum > notarize, "the published bytes are checksummed after notarization");
  assert(upload > checksum, "the checked artifact is uploaded");
  assert(cleanup > upload, "credentials are removed after artifact handling");

  assertStringIncludes(build, "if: ${{ runner.os == 'macOS' }}");
  assertStringIncludes(build, "codesign --force --timestamp --options runtime");
  assertStringIncludes(build, "--identifier sh.discern.cli");
  assertStringIncludes(build, "--entitlements scripts/macos_release_entitlements.plist");
  assertStringIncludes(build, "xcrun notarytool submit");
  assertStringIncludes(build, "--keychain-profile discern-release");
  assertStringIncludes(build, "--wait");
  assertStringIncludes(build, '-R="notarized" --check-notarization');
  for (
    const secret of [
      "APPLE_DEVELOPER_ID_P12_BASE64",
      "APPLE_DEVELOPER_ID_P12_PASSWORD",
      "APPLE_NOTARY_APPLE_ID",
      "APPLE_NOTARY_PASSWORD",
      "APPLE_TEAM_ID",
    ]
  ) {
    assertStringIncludes(build, `secrets.${secret}`);
  }
  assertStringIncludes(
    build,
    "if: ${{ always() && runner.os == 'macOS' }}",
  );
});

Deno.test("the hardened runtime grants only Deno's required JIT entitlement", () => {
  assertStringIncludes(
    entitlementsSource,
    "<key>com.apple.security.cs.allow-jit</key>",
  );
  const enabled = [...entitlementsSource.matchAll(/<true\/>/g)];
  assert(
    enabled.length === 1,
    `expected one enabled entitlement, found ${enabled.length}`,
  );
});
