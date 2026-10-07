/**
 * Module-resolution hooks for the Phase 2B default-path loading check.
 *
 * `module.registerHooks()` runs the hooks synchronously on the main thread, so
 * records are visible to the test that installed them. The older
 * `module.register()` runs hooks on a separate loader thread, which cannot share
 * state with the test; that approach was rejected for exactly this reason.
 *
 * Resolution is intercepted, not loading, so both static and dynamic imports are
 * observed. Node's CommonJS paths are not intercepted by this hook; the doc notes
 * that limit explicitly.
 */
import { registerHooks } from "node:module";

const STORAGE_MARKER = "/src/storage/";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    const url = String(resolved?.url ?? "");
    if (url.startsWith("node:sqlite") || url.includes(STORAGE_MARKER)) {
      const records = (globalThis.__FORGELOOP_MODULE_RESOLUTIONS__ ??= []);
      records.push({ url, specifier, parent: context?.parentURL ?? null });
    }
    return resolved;
  },
});
