import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./npm-command.mjs";

export const TARGET = "2.0.0-rc.2";
export const RELEASE_COMMIT = "3c17d6654e4874e07fa3109f35c53c5bd3b600d0";
const packageName = "@cassiomc1/forgeloop";
const registry = "https://registry.npmjs.org";
const escaped = encodeURIComponent(packageName);
const digest = "f7e372d637d974682ae31e0a904ec58c717da50e701ad89876415053fd0d7560bfac814421578a93e0eda8cc3cd9f715ff74e18b3e0fbb2aae0150b5ef915527";

export function assertPromotion(metadata, tags) {
  const expected = `sha512-${Buffer.from(digest, "hex").toString("base64")}`;
  if (metadata.name !== packageName || metadata.version !== TARGET || metadata.gitHead !== RELEASE_COMMIT
    || metadata.publishConfig?.access !== "public" || metadata.dist?.integrity !== expected
    || metadata.dist?.tarball !== `${registry}/${packageName}/-/forgeloop-${TARGET}.tgz`) throw new Error("Published RC2 identity does not match the authorized release");
  if (!["1.14.0", TARGET].includes(tags.latest) || tags.next !== TARGET) throw new Error("Unexpected latest/next values; refuse to overwrite another release");
}

export function assertTarball(bytes, integrity) {
  if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== integrity) throw new Error("Published tarball integrity mismatch");
}

export function oidcRequestUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com") || url.username || url.password) throw new Error("Untrusted GitHub OIDC endpoint");
  url.searchParams.set("audience", "npm:registry.npmjs.org");
  return url;
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: "error", signal: globalThis.AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Registry/authentication request failed: HTTP ${response.status}`);
  return response;
}

async function readTags() {
  return (await request(`${registry}/-/package/${escaped}/dist-tags`)).json();
}

async function promote(checkOnly) {
  const metadata = await (await request(`${registry}/${escaped}/${TARGET}`)).json();
  const tags = await readTags();
  assertPromotion(metadata, tags);
  assertTarball(Buffer.from(await (await request(metadata.dist.tarball)).arrayBuffer()), metadata.dist.integrity);
  if (checkOnly || tags.latest === TARGET) {
    console.log(JSON.stringify({ status: checkOnly ? "PROMOTION_CHECK_VALID" : "LATEST_ALREADY_VERIFIED", target: TARGET, latest: tags.latest }));
    return;
  }
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.PROMOTION_CONFIRM !== "POINT LATEST TO RC2"
    || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error("Explicit GitHub promotion authorization is required");
  const oidc = await (await request(oidcRequestUrl(process.env.ACTIONS_ID_TOKEN_REQUEST_URL), {
    headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  })).json();
  if (typeof oidc.value !== "string") throw new Error("GitHub did not supply an OIDC token");
  const exchanged = await (await request(`${registry}/-/npm/v1/oidc/token/exchange/package/${escaped}`, {
    method: "POST", headers: { Authorization: `Bearer ${oidc.value}` },
  })).json();
  if (typeof exchanged.token !== "string") throw new Error("npm did not supply a package-scoped exchange token");
  try {
    runNpm(["dist-tag", "add", `${packageName}@${TARGET}`, "latest"], {
      timeout: 15000, stdio: "pipe", env: { ...process.env, NODE_AUTH_TOKEN: exchanged.token },
    });
  } catch (error) {
    const denied = /E403|403 Forbidden/u.test(String(error.stderr ?? ""));
    throw new Error(denied ? "npm refused dist-tag management; enable manageDistTags on this trusted publisher" : "npm dist-tag operation failed; no credentials are logged");
  }
  const current = await readTags();
  assertPromotion(metadata, current);
  if (current.latest !== TARGET) throw new Error("npm did not confirm the latest update");
  console.log(JSON.stringify({ status: "LATEST_PROMOTION_VERIFIED", target: TARGET, latest: current.latest, next: current.next }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--check")) throw new Error("Unknown promotion argument");
    await promote(args.includes("--check"));
  } catch (error) { console.error(`LATEST_PROMOTION_REFUSED: ${error.message}`); process.exitCode = 1; }
}
