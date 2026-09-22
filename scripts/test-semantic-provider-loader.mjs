import { installTestSemanticProvider } from "../src/core/decision/test-provider.js";

installTestSemanticProvider();

const loaderFlag = `--import=${new URL(import.meta.url).pathname}`;
const existing = process.env.NODE_OPTIONS?.split(/\s+/u).filter(Boolean) ?? [];
if (!existing.some((value) => value === loaderFlag)) {
  process.env.NODE_OPTIONS = [...existing, loaderFlag].join(" ");
}
