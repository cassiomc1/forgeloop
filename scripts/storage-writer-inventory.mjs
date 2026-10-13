import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const reportPath = "benchmarks/storage-sqlite/rc-writer-inventory.json";
const require = createRequire(import.meta.url);
const { parse } = createRequire(require.resolve("eslint"))("espree");
const primitives = new Set(["open", "openSync", "write", "writeSync", "writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "rename", "renameSync", "rm", "rmSync", "unlink", "unlinkSync", "mkdir", "mkdirSync", "copyFile", "copyFileSync", "link", "linkSync", "symlink", "symlinkSync", "truncate", "truncateSync", "writeFileAtomic"]);

export function inventorySource(filename, text) {
  const source = parse(text, { ecmaVersion: "latest", sourceType: "module", loc: true, range: true });
  const imports = []; const calls = [];
  const aliases = new Map();
  const visit = node => {
    if (node.type === "ImportDeclaration") {
      imports.push(node.source.value);
      for (const specifier of node.specifiers) {
        if (specifier.imported?.name) aliases.set(specifier.local.name, specifier.imported.name);
      }
    }
    if (node.type === "CallExpression") {
      const callee = node.callee;
      const name = callee.type === "MemberExpression" ? (callee.computed ? callee.property.value : callee.property.name) : aliases.get(callee.name) ?? callee.name;
      if (primitives.has(name)) calls.push({ line: node.loc.start.line, expression: text.slice(...callee.range), primitive: name });
    }
    if (node.type === "ImportExpression") imports.push(node.source.type === "Literal" ? node.source.value : "UNRESOLVED_DYNAMIC_IMPORT");
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child?.type) visit(child); }
      else if (value?.type) visit(value);
    }
  };
  visit(source);
  return { path: filename, sha256: createHash("sha256").update(text).digest("hex"), imports, potentialWrites: calls };
}

export function buildInventory(root = process.cwd()) {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "src"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(file => file.endsWith(".js")).sort();
  const modules = files.map(file => inventorySource(file, readFileSync(path.join(root, file), "utf8")));
  return { schemaVersion: 1, wholeConsumerClosure: false, scope: "Every tracked or unignored src JavaScript module; potential writes and import edges",
    limitations: ["Static call names do not prove every alias, computed member, external caller, or path invariant.",
      "All potential writers require disposition and transitive authority review before soleSQLiteWriter can become true.",
      "This inventory prevents source drift for the RC; it is not stable migration acceptance."], modules };
}

export function assertInventory(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Writer inventory drift: review new or changed sources before release");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const actual = buildInventory();
    if (process.argv.slice(2).some(arg => arg !== "--write")) throw new Error("Unknown inventory argument");
    if (process.argv.includes("--write")) writeFileSync(reportPath, `${JSON.stringify(actual, null, 2)}\n`);
    else assertInventory(JSON.parse(readFileSync(reportPath, "utf8")), actual);
    console.log(JSON.stringify({ modules: actual.modules.length, potentialWriterModules: actual.modules.filter(item => item.potentialWrites.length).length, wholeConsumerClosure: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
