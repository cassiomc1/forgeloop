import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TARGET, RELEASE_COMMIT, assertPromotion, assertTarball, oidcRequestUrl } from "../scripts/promote-rc-latest.mjs";
const hex = "f7e372d637d974682ae31e0a904ec58c717da50e701ad89876415053fd0d7560bfac814421578a93e0eda8cc3cd9f715ff74e18b3e0fbb2aae0150b5ef915527";
const metadata = { name: "@cassiomc1/forgeloop", version: TARGET, gitHead: RELEASE_COMMIT, publishConfig: { access: "public" },
  dist: { integrity: `sha512-${Buffer.from(hex, "hex").toString("base64")}`, tarball: `https://registry.npmjs.org/@cassiomc1/forgeloop/-/forgeloop-${TARGET}.tgz` } };

test("latest promotion rejects incorrect published identity and artifact location", () => {
  assert.doesNotThrow(() => assertPromotion(metadata, { latest: "1.14.0", next: TARGET }));
  for (const [field, value] of [["version", "2.0.0"], ["gitHead", "0".repeat(40)], ["name", "another-package"]]) {
    assert.throws(() => assertPromotion({ ...metadata, [field]: value }, { latest: "1.14.0", next: TARGET }));
  }
  for (const dist of [{ ...metadata.dist, integrity: "changed" }, { ...metadata.dist, tarball: "https://untrusted.invalid/file.tgz" }]) {
    assert.throws(() => assertPromotion({ ...metadata, dist }, { latest: "1.14.0", next: TARGET }));
  }
});

test("promotion refuses concurrent release changes and permits idempotent latest", () => {
  assert.doesNotThrow(() => assertPromotion(metadata, { latest: TARGET, next: TARGET }));
  assert.throws(() => assertPromotion(metadata, { latest: "2.1.0", next: TARGET }));
  assert.throws(() => assertPromotion(metadata, { latest: "1.14.0", next: "2.0.0-rc.3" }));
});

test("tarball validation rejects changed or partial published bytes", () => {
  const bytes = Buffer.from("complete archive");
  const hash = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  assert.doesNotThrow(() => assertTarball(bytes, hash));
  assert.throws(() => assertTarball(bytes.subarray(1), hash));
});

test("OIDC audience is fixed and credentials are refused for untrusted endpoints", () => {
  assert.equal(oidcRequestUrl("https://token.actions.githubusercontent.com/token?key=value").searchParams.get("audience"), "npm:registry.npmjs.org");
  for (const value of ["http://token.actions.githubusercontent.com/token", "https://actions.githubusercontent.com.untrusted.invalid/token", "https://user:secret@token.actions.githubusercontent.com/token"]) assert.throws(() => oidcRequestUrl(value));
});
