#!/usr/bin/env node
// Builds the docs.page site tree from the canonical Markdown under docs/.
// The output (docs.json + docs/**/*.mdx) is published to the docs-site branch;
// docs/**/*.md stays the only source of truth.
import { statSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GITHUB_BLOB_BASE = "https://github.com/cassiomc1/forgeloop/blob/main/";
export const GITHUB_TREE_BASE = "https://github.com/cassiomc1/forgeloop/tree/main/";
const SITE_SOURCE_DIR = "docs-site";
const DESCRIPTION_LIMIT = 200;
// docs.page serves its own endpoints at these paths (matched case-insensitively),
// so the pages are published under another name.
export const RESERVED_PAGE_PATHS = new Map([["MCP", "FORGELOOP_MCP"]]);

/** Site path (without leading slash) for a docs-relative page path without extension. */
export function sitePagePath(pagePath) {
  return RESERVED_PAGE_PATHS.get(pagePath) ?? pagePath;
}

/**
 * Rewrites one Markdown link target for the site.
 * @param {string} target link destination as written in the source
 * @param {string} sourcePath repository-relative POSIX path of the source file
 * @param {(repoPath: string) => "file" | "dir" | null} kindOf repository path lookup
 */
export function rewriteLinkTarget(target, sourcePath, kindOf) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("/")) {
    return target;
  }
  const hashIndex = target.indexOf("#");
  const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : target.slice(hashIndex);
  if (rawPath === "") return target;
  const repoPath = path.posix
    .normalize(path.posix.join(path.posix.dirname(sourcePath), decodeURI(rawPath)))
    .replace(/\/$/, "");
  if (repoPath.startsWith("../")) return target;
  const kind = kindOf(repoPath);
  if (kind === "file" && repoPath.startsWith("docs/") && repoPath.endsWith(".md")) {
    return `/${sitePagePath(repoPath.slice("docs/".length, -".md".length))}${hash}`;
  }
  const base = kind === "dir" ? GITHUB_TREE_BASE : GITHUB_BLOB_BASE;
  return `${base}${encodeURI(repoPath === "." ? "" : repoPath)}${hash}`;
}

function escapeProse(text) {
  return text
    .replace(/<(https?:\/\/[^>\s]+)>/g, "[$1]($1)")
    .replace(/<(?!\/?a[\s>])/g, "&lt;")
    .replace(/[{}]/g, (brace) => `\\${brace}`);
}

function rewriteLinks(text, sourcePath, kindOf) {
  return text
    .replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_match, target, title) =>
      `](${rewriteLinkTarget(target, sourcePath, kindOf)}${title})`)
    .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)/, (_match, prefix, target) =>
      `${prefix}${rewriteLinkTarget(target, sourcePath, kindOf)}`);
}

// Splits a line into prose and inline-code segments (backtick runs of equal length).
function splitInlineCode(line) {
  const segments = [];
  let index = 0;
  let prose = "";
  while (index < line.length) {
    if (line[index] !== "`") {
      prose += line[index];
      index += 1;
      continue;
    }
    let runEnd = index;
    while (line[runEnd] === "`") runEnd += 1;
    const fence = line.slice(index, runEnd);
    const close = line.indexOf(fence, runEnd);
    if (close === -1 || line[close + fence.length] === "`") {
      prose += fence;
      index = runEnd;
      continue;
    }
    segments.push({ code: false, text: prose });
    prose = "";
    segments.push({ code: true, text: line.slice(index, close + fence.length) });
    index = close + fence.length;
  }
  segments.push({ code: false, text: prose });
  return segments;
}

function plainText(markdown) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// docs.page rejects non-Latin-1 metadata (it breaks social image generation).
export function toLatin1(text) {
  return text
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2192/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function frontmatter(title, description) {
  const lines = ["---", `title: ${JSON.stringify(toLatin1(title))}`];
  if (description) lines.push(`description: ${JSON.stringify(toLatin1(description))}`);
  lines.push("---", "");
  return lines.join("\n");
}

// Removes complete HTML comments until none remain, so overlapping input such as
// "<!<!---->--" cannot leave a new "<!--" behind after a single pass.
export function stripHtmlComments(text) {
  let current = text;
  let previous;
  do {
    previous = current;
    current = current.replace(/<!--[\s\S]*?-->/g, "");
  } while (current !== previous);
  return current;
}

/**
 * Converts one canonical Markdown document into docs.page-compatible MDX.
 * @param {string} source Markdown source
 * @param {{ sourcePath: string, kindOf: (repoPath: string) => "file" | "dir" | null }} options
 */
export function convertMarkdownToMdx(source, { sourcePath, kindOf }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let fence = null;
  let inComment = false;
  let title = null;
  const descriptionLines = [];
  const descriptionIndexes = [];
  let descriptionDone = false;

  for (const line of lines) {
    if (fence) {
      output.push(line);
      if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, "") === "") fence = null;
      continue;
    }
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch && !inComment) {
      fence = fenceMatch[1];
      descriptionDone ||= title !== null;
      output.push(line);
      continue;
    }

    let text = line;
    if (inComment) {
      const end = text.indexOf("-->");
      if (end === -1) continue;
      text = text.slice(end + 3);
      inComment = false;
    }
    text = stripHtmlComments(text);
    const open = text.indexOf("<!--");
    if (open !== -1) {
      text = text.slice(0, open);
      inComment = true;
    }
    if (text.trim() === "" && line.trim() !== "") continue;

    if (title === null && /^#\s+/.test(text)) {
      title = text.replace(/^#\s+/, "").trim();
      continue;
    }
    if (title !== null && !descriptionDone) {
      if (text.trim() === "") {
        descriptionDone = descriptionLines.length > 0;
      } else if (/^\s*([#>|*-]|\d+\.)/.test(text)) {
        descriptionDone = true;
      } else {
        descriptionLines.push(text);
        descriptionIndexes.push(output.length);
      }
    }

    const converted = splitInlineCode(text)
      .map((segment) => (segment.code ? segment.text : escapeProse(rewriteLinks(segment.text, sourcePath, kindOf))))
      .join("")
      .replace(/^(\s*)(import|export)(\s)/, "$1&#x200B;$2$3");
    output.push(converted);
  }

  const fallbackTitle = path.posix.basename(sourcePath, ".md").replace(/_/g, " ");
  // docs.page shows the description under the title, so a short, link-free
  // opening paragraph moves into the description instead of appearing twice.
  const opening = descriptionLines.join(" ");
  let description = plainText(opening);
  if (description.length > DESCRIPTION_LIMIT || opening.includes("](")) {
    description = "";
  } else {
    for (const index of descriptionIndexes.reverse()) output.splice(index, 1);
  }
  const body = output.join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
  return `${frontmatter(title ?? fallbackTitle, description)}\n${body}`;
}

async function listMarkdown(directory, prefix = "") {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdown(directory, relative)));
    else if (entry.name.endsWith(".md")) files.push(relative);
  }
  return files.sort();
}

function sidebarHrefs(sidebar) {
  const hrefs = [];
  const visit = (items) => {
    for (const item of items) {
      if (item.href) hrefs.push(item.href);
      if (item.pages) visit(item.pages);
    }
  };
  visit(sidebar);
  return hrefs;
}

/**
 * Builds the docs.page tree into outDir.
 * @param {{ rootDir?: string, outDir: string }} options
 */
export async function buildDocsSite({ rootDir = repositoryRoot, outDir }) {
  const kindCache = new Map();
  const kindOf = (repoPath) => {
    if (!kindCache.has(repoPath)) {
      let kind = null;
      try {
        const info = statSync(path.join(rootDir, repoPath));
        kind = info.isDirectory() ? "dir" : "file";
      } catch {
        kind = null;
      }
      kindCache.set(repoPath, kind);
    }
    return kindCache.get(repoPath);
  };

  const config = JSON.parse(await readFile(path.join(rootDir, SITE_SOURCE_DIR, "docs.json"), "utf8"));
  const pages = await listMarkdown(path.join(rootDir, "docs"));
  const pageHrefs = new Set(["/", ...pages.map((page) => `/${sitePagePath(page.slice(0, -".md".length))}`)]);

  const errors = [];
  const listed = new Set(sidebarHrefs(config.sidebar ?? []));
  for (const href of listed) {
    if (href.startsWith("/") && !pageHrefs.has(href.split("#")[0])) errors.push(`sidebar link has no page: ${href}`);
  }
  for (const page of pages) {
    const href = `/${sitePagePath(page.slice(0, -".md".length))}`;
    if (!page.includes("/") && !listed.has(href)) errors.push(`top-level page missing from sidebar: docs/${page}`);
  }
  if (errors.length > 0) throw new Error(`docs site configuration is inconsistent:\n- ${errors.join("\n- ")}`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "docs"), { recursive: true });
  await writeFile(path.join(outDir, "docs.json"), `${JSON.stringify(config, null, 2)}\n`);
  await cp(path.join(rootDir, SITE_SOURCE_DIR, "index.mdx"), path.join(outDir, "docs", "index.mdx"));
  for (const page of pages) {
    const source = await readFile(path.join(rootDir, "docs", page), "utf8");
    const target = path.join(outDir, "docs", `${sitePagePath(page.slice(0, -".md".length))}.mdx`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, convertMarkdownToMdx(source, { sourcePath: `docs/${page}`, kindOf }));
  }
  await writeFile(
    path.join(outDir, "README.md"),
    "# ForgeLoop documentation site\n\nGenerated by `scripts/build-docs-site.mjs` from `docs/` on `main`. Do not edit this branch.\n",
  );
  return { pages: pages.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const outDir = path.resolve(outIndex === -1 ? path.join(os.tmpdir(), "forgeloop-docs-site") : process.argv[outIndex + 1]);
  try {
    const { pages } = await buildDocsSite({ outDir });
    console.log(`Built docs.page site: ${pages} pages -> ${outDir}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
