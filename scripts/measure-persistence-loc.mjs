#!/usr/bin/env node

/**
 * Reproducible, fail-closed function-level persistence LOC analyzer.
 *
 * This is a static verification tool. It deliberately does not modify
 * the repository, run tests, run benchmarks, or decide whether a release is
 * acceptable. It reads a pinned baseline and a current source tree, applies a
 * reviewed scope manifest, closes selection over exact baseline/current
 * identities, and emits a node-level manifest plus provisional totals. Any
 * unresolved membership makes acceptanceEligible false.
 *
 * Usage:
 *   node scripts/measure-persistence-loc.mjs \
 *     --repo-root=/path/to/current \
 *     --baseline-root=/path/to/clean-baseline \
 *     --scope-manifest=/path/to/persistence-loc-function-scope-manifest.json \
 *     --output=/path/to/result.json
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts"]);
const RELATIVE_SPECIFIER = /^\.\.?\//u;
const FUNCTION_KINDS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunction",
  "MethodDeclaration",
  "GetAccessor",
  "SetAccessor",
  "Constructor",
]);
const IMPORT_KINDS = new Set(["ImportDeclaration", "ImportEqualsDeclaration"]);
const SQL_RE = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bCREATE\s+(?:TABLE|INDEX)\b|\bBEGIN\s+IMMEDIATE\b|\bCOMMIT\b|\bROLLBACK\b/u;
const COMMENT_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/gu;
const OPEN_PARSERS = new Set();

function usage() {
  return [
    "Usage:",
    "  node scripts/measure-persistence-loc.mjs \\",
    "    --repo-root=/path/to/current \\",
    "    --baseline-root=/path/to/clean-baseline \\",
    "    --scope-manifest=/path/to/scope-manifest.json \\",
    "    --output=/path/to/result.json",
  ].join("\n");
}

function parseArguments(argv) {
  const required = ["repo-root", "baseline-root", "scope-manifest", "output"];
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--") || !argument.includes("=")) throw new Error(`Invalid argument ${argument}\n${usage()}`);
    const index = argument.indexOf("=");
    const name = argument.slice(2, index);
    if (!required.includes(name)) throw new Error(`Unknown --${name}\n${usage()}`);
    if (values.has(name)) throw new Error(`Duplicate --${name}\n${usage()}`);
    values.set(name, argument.slice(index + 1));
  }
  for (const name of required) {
    if (!values.get(name)) throw new Error(`Missing --${name}=...\n${usage()}`);
  }
  return {
    repoRoot: path.resolve(values.get("repo-root")),
    baselineRoot: path.resolve(values.get("baseline-root")),
    scopeManifest: path.resolve(values.get("scope-manifest")),
    output: path.resolve(values.get("output")),
  };
}

function fail(message, details = []) {
  const suffix = details.length ? `\n${details.map(value => `- ${value}`).join("\n")}` : "";
  throw new Error(`${message}${suffix}`);
}

function loadTypeScript(repoRoot, expectedVersion) {
  let requireFromRepo;
  try {
    requireFromRepo = createRequire(pathToFileURL(path.join(repoRoot, "package.json")).href);
  } catch (error) {
    fail("Cannot create the repository module resolver for TypeScript", [error.message]);
  }
  let typescript;
  try {
    typescript = requireFromRepo("typescript");
  } catch (error) {
    fail("The pinned TypeScript parser is unavailable; do not install a replacement during measurement", [error.message]);
  }
  if (expectedVersion && typescript.version !== expectedVersion) {
    fail(`TypeScript parser version ${typescript.version} does not match manifest ${expectedVersion}`);
  }
  let ast;
  let syncApi;
  try {
    ast = requireFromRepo("typescript/unstable/ast");
    syncApi = requireFromRepo("typescript/unstable/sync");
  } catch (error) {
    fail("The pinned TypeScript 7 AST API is unavailable; do not install a replacement during measurement", [error.message]);
  }
  const ts = {
    ...ast,
    version: typescript.version,
    forEachChild(node, visitNode, visitNodes) {
      return node?.forEachChild(visitNode, visitNodes);
    },
    flattenDiagnosticMessageText(messageText, newline) {
      if (typeof messageText === "string") return messageText;
      if (Array.isArray(messageText)) return messageText.map(value => ts.flattenDiagnosticMessageText(value, newline)).join(newline);
      if (messageText && typeof messageText === "object" && "messageText" in messageText) {
        return `${messageText.messageText}${messageText.next ? newline + ts.flattenDiagnosticMessageText(messageText.next, newline) : ""}`;
      }
      return String(messageText);
    },
    isClassLike(node) {
      return ast.isClassDeclaration(node) || ast.isClassExpression(node);
    },
    isStringLiteralLike(node) {
      return ast.isStringLiteral(node) || ast.isNoSubstitutionTemplateLiteral(node);
    },
    createParser(root) {
      const api = new syncApi.API({ cwd: root });
      let snapshot;
      let closed = false;
      const parser = {
        openFiles(absolutePaths) {
          snapshot = api.updateSnapshot({ openFiles: absolutePaths });
          const projects = snapshot.getProjects();
          const projectsByRootFile = new Map();
          for (const project of projects) {
            for (const rootFile of project.rootFiles) projectsByRootFile.set(rootFile, project);
          }
          const diagnosticsByProject = new Map();
          const parsed = new Map();
          for (const absolutePath of absolutePaths) {
            const project = projectsByRootFile.get(absolutePath) ?? snapshot.getDefaultProjectForFile(absolutePath);
            if (!project) fail(`TypeScript did not create a project for ${absolutePath}`);
            const sourceFile = project.program.getSourceFile(absolutePath);
            if (!sourceFile) fail(`TypeScript did not parse ${absolutePath}`);
            if (!diagnosticsByProject.has(project)) diagnosticsByProject.set(project, project.program.getSyntacticDiagnostics());
            parsed.set(absolutePath, {
              sourceFile,
              diagnostics: diagnosticsByProject.get(project).filter(diagnostic => diagnostic.fileName === absolutePath),
            });
          }
          return parsed;
        },
        close() {
          if (closed) return;
          closed = true;
          if (snapshot) snapshot.dispose();
          api.close();
          OPEN_PARSERS.delete(parser);
        },
      };
      OPEN_PARSERS.add(parser);
      return parser;
    },
  };
  return ts;
}

async function listSourceFiles(root, productionRoots) {
  const files = [];
  async function walk(relative) {
    const absolute = path.join(root, relative);
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      fail(`Cannot read production root ${relative}`, [error.message]);
    }
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(child);
    }
  }
  for (const root of productionRoots) await walk(root);
  return files.sort();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nonblankLines(source) {
  return source.split(/\r?\n/u).filter(line => line.trim()).length;
}

function lineOf(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function nodeKindName(ts, node) {
  // TypeScript 7 exposes VariableStatement and FirstStatement as aliases of
  // the same numeric SyntaxKind.  Prefer the semantic name so identity keys
  // do not depend on enum insertion order.
  if (ts.isVariableStatement?.(node)) return "VariableStatement";
  return ts.SyntaxKind[node.kind] ?? `SyntaxKind(${node.kind})`;
}

function isFunctionNode(ts, node) {
  return FUNCTION_KINDS.has(nodeKindName(ts, node));
}

function isIdentifier(ts, node) {
  return Boolean(node) && ts.isIdentifier(node);
}

function textOfName(ts, node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isPrivateIdentifier?.(node)) return `#${node.text}`;
  if (ts.isComputedPropertyName?.(node)) return `[${node.expression.getText()}]`;
  return node.getText();
}

function hasExportModifier(ts, node) {
  return Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function bindingNameForFunction(ts, node) {
  if (node.name) return textOfName(ts, node.name);
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent)) return textOfName(ts, parent.name);
  if (parent && ts.isPropertyAssignment(parent)) return textOfName(ts, parent.name);
  if (parent && ts.isMethodDeclaration(parent)) return textOfName(ts, parent.name);
  if (parent && ts.isClassLike(parent) && node.name) return textOfName(ts, node.name);
  if (parent && ts.isExportAssignment(parent)) return "default";
  return null;
}

function nearestScopePrefix(ts, node) {
  const pieces = [];
  let current = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      const name = textOfName(ts, current.name);
      if (name) pieces.unshift(name);
    }
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) {
      const name = bindingNameForFunction(ts, current);
      if (name) pieces.unshift(name);
    }
    current = current.parent;
  }
  return pieces.join(".");
}

function functionQualifiedName(ts, node) {
  const own = bindingNameForFunction(ts, node);
  const prefix = nearestScopePrefix(ts, node);
  if (own && prefix && !prefix.endsWith(`.${own}`)) return `${prefix}.${own}`;
  if (own) return own;
  return null;
}

function normalizeTokens(ts, node) {
  const text = node.getText().replace(COMMENT_RE, " ");
  const tokens = [];
  const scanner = ts.createScanner(true, ts.LanguageVariant.Standard, text);
  const endOfFileKind = ts.SyntaxKind.EndOfFileToken ?? ts.SyntaxKind.EndOfFile;
  let previousTokenEnd = 0;
  while (true) {
    const kind = scanner.scan();
    if (kind === endOfFileKind) break;
    const tokenStart = scanner.getTokenStart?.() ?? previousTokenEnd;
    const tokenEnd = scanner.getTokenEnd?.() ?? tokenStart;
    if (tokenEnd <= tokenStart || tokenEnd <= previousTokenEnd) {
      // TypeScript 7's scanner can return a zero-width PrivateIdentifier for
      // hash characters inside regular-expression literals. Keep the
      // heuristic finite and fail over to a whitespace-normalized body hash.
      return sha256(text.replace(/\s+/gu, " ").trim());
    }
    previousTokenEnd = tokenEnd;
    const tokenText = scanner.getTokenText();
    if (kind === ts.SyntaxKind.Identifier) tokens.push(`id:${tokenText}`);
    else if (kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation) tokens.push(`p:${tokenText}`);
    else if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) tokens.push(`str:${scanner.getTokenValue?.() ?? tokenText}`);
    else if (kind === ts.SyntaxKind.NumericLiteral) tokens.push(`num:${tokenText}`);
    else if (kind === ts.SyntaxKind.TrueKeyword || kind === ts.SyntaxKind.FalseKeyword || kind === ts.SyntaxKind.NullKeyword) tokens.push(`kw:${tokenText}`);
  }
  return sha256(tokens.join("\u001f"));
}

function collectFunctionRecords(ts, sourceFile, relativePath, source) {
  const records = [];
  let anonymousOrdinal = 0;
  const functionStack = [];
  function visit(node) {
    if (isFunctionNode(ts, node)) {
      const name = functionQualifiedName(ts, node);
      const anonymous = !name;
      const stableName = name ?? `<anonymous-${++anonymousOrdinal}>`;
      const record = {
        path: relativePath,
        kind: nodeKindName(ts, node),
        name: stableName,
        stable: !anonymous,
        exported: hasExportModifier(ts, node),
        start: node.getStart(sourceFile),
        end: node.end,
        lineStart: lineOf(sourceFile, node.getStart(sourceFile)),
        lineEnd: lineOf(sourceFile, Math.max(node.getStart(sourceFile), node.end - 1)),
        bodyStart: node.body ? node.body.getStart(sourceFile) : node.getStart(sourceFile),
        bodyEnd: node.body ? node.body.end : node.end,
        key: `${relativePath}::${nodeKindName(ts, node)}::${stableName}`,
        identityKey: `${relativePath}::${nodeKindName(ts, node)}::${stableName}`,
        nested: functionStack.length > 0,
        fingerprint: normalizeTokens(ts, node.body ?? node),
        node,
        calls: [],
        directReasons: [],
      };
      records.push(record);
      functionStack.push(record);
      ts.forEachChild(node, visit);
      functionStack.pop();
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return records;
}

function collectImports(ts, sourceFile) {
  const imports = new Map();
  const unresolved = [];
  const dynamicImports = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) imports.set(clause.name.text, { imported: "default", specifier, kind: "default" });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        imports.set(clause.namedBindings.name.text, { imported: "*", specifier, kind: "namespace" });
      } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          imports.set(element.name.text, { imported: textOfName(ts, element.propertyName ?? element.name), specifier, kind: "named" });
        }
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      const moduleReference = statement.moduleReference;
      if (ts.isExternalModuleReference(moduleReference) && ts.isStringLiteral(moduleReference.expression)) {
        imports.set(statement.name.text, { imported: "*", specifier: moduleReference.expression.text, kind: "import-equals" });
      } else {
        unresolved.push(`${sourceFile.fileName}: import-equals declaration cannot be resolved`);
      }
    }
  }
  function inspectDynamicImports(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument)) {
        const argumentText = argument ? argument.getText(sourceFile) : null;
        dynamicImports.push({
          relative: false,
          specifier: null,
          argumentText,
          argumentFingerprint: argumentText ? sha256(argumentText) : null,
          callFingerprint: sha256(node.getText(sourceFile)),
          expressionText: node.getText(sourceFile),
          start: node.getStart(sourceFile),
          end: node.end,
          line: lineOf(sourceFile, node.getStart(sourceFile)),
          column: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).character + 1,
          reason: "dynamic import has no static module specifier",
        });
      } else if (RELATIVE_SPECIFIER.test(argument.text)) {
        const argumentText = argument.getText(sourceFile);
        dynamicImports.push({
          relative: true,
          specifier: argument.text,
          argumentText,
          argumentFingerprint: sha256(argumentText),
          callFingerprint: sha256(node.getText(sourceFile)),
          expressionText: node.getText(sourceFile),
          start: node.getStart(sourceFile),
          end: node.end,
          line: lineOf(sourceFile, node.getStart(sourceFile)),
          column: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).character + 1,
        });
      }
    }
    ts.forEachChild(node, inspectDynamicImports);
  }
  inspectDynamicImports(sourceFile);
  const dynamicBindings = new Map();
  const bindingIssues = [];
  const dynamicByStart = new Map(dynamicImports.map(dynamicImport => [dynamicImport.start, dynamicImport]));

  function unwrap(expression) {
    let current = expression;
    while (current && (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current))) current = current.expression;
    return current;
  }

  function dynamicCall(expression) {
    const call = unwrap(expression);
    if (!call || !ts.isCallExpression(call) || call.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
    const argument = call.arguments[0];
    if (!argument || !ts.isStringLiteralLike(argument) || !RELATIVE_SPECIFIER.test(argument.text)) return null;
    return { call, dynamicImport: dynamicByStart.get(call.getStart(sourceFile)) ?? null, specifier: argument.text };
  }

  function register(localName, binding) {
    const existing = dynamicBindings.get(localName);
    if (existing && (existing.specifier !== binding.specifier || existing.imported !== binding.imported)) {
      bindingIssues.push(`${sourceFile.fileName}: dynamic import binding ${localName} has conflicting static modules`);
      return;
    }
    dynamicBindings.set(localName, binding);
    const dynamicImport = dynamicByStart.get(binding.dynamicStart);
    if (dynamicImport) {
      dynamicImport.bindings ??= [];
      if (!dynamicImport.bindings.some(item => item.local === localName && item.imported === binding.imported)) {
        dynamicImport.bindings.push({ local: localName, imported: binding.imported, kind: binding.kind });
      }
    }
  }

  function registerPattern(pattern, bindingInfo) {
    if (!pattern || !bindingInfo) return false;
    // TypeScript 7 represents each array/object destructuring item as a
    // BindingElement whose `name` contains the actual identifier or nested
    // binding pattern.  Recurse through that wrapper before classifying the
    // binding; otherwise Promise.all([import(...)]) destructuring silently
    // loses its statically provable names.
    if (pattern.kind === ts.SyntaxKind.BindingElement) {
      return registerPattern(pattern.name, bindingInfo);
    }
    if (ts.isIdentifier(pattern)) {
      register(pattern.text, { ...bindingInfo, imported: bindingInfo.imported ?? "*", kind: bindingInfo.kind ?? "dynamic-namespace" });
      return true;
    }
    if (pattern.kind === ts.SyntaxKind.ObjectBindingPattern || ts.isObjectBindingPattern(pattern)) {
      let complete = true;
      for (const element of pattern.elements) {
        if (element.dotDotDotToken || !element.name) {
          complete = false;
          continue;
        }
        const imported = element.propertyName ? textOfName(ts, element.propertyName) : textOfName(ts, element.name);
        if (!imported || !ts.isIdentifier(element.name)) {
          complete = false;
          continue;
        }
        register(element.name.text, { ...bindingInfo, imported, kind: "dynamic-named" });
      }
      return complete;
    }
    return false;
  }

  function registerPromiseAll(pattern, initializer) {
    const call = unwrap(initializer);
    if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)
      || call.expression.name.text !== "all" || !ts.isIdentifier(call.expression.expression)
      || call.expression.expression.text !== "Promise") return false;
    const argument = call.arguments[0] && unwrap(call.arguments[0]);
    if (!argument || !ts.isArrayLiteralExpression(argument) || !ts.isArrayBindingPattern(pattern)) {
      return false;
    }
    if (pattern.elements.length !== argument.elements.length) return false;
    let complete = true;
    pattern.elements.forEach((element, index) => {
      const importedCall = dynamicCall(argument.elements[index]);
      if (!importedCall) {
        complete = false;
        return;
      }
      const dynamicImport = importedCall.dynamicImport;
      if (!dynamicImport) {
        complete = false;
        return;
      }
      complete = registerPattern(element, {
        specifier: importedCall.specifier,
        dynamicStart: dynamicImport.start,
        kind: "dynamic-promise-all",
        imported: "*",
      }) && complete;
    });
    return complete;
  }

  function inspectVariable(statement) {
    if (!ts.isVariableStatement(statement)) return;
    for (const declaration of statement.declarationList.declarations) {
      const direct = dynamicCall(declaration.initializer);
      if (direct?.dynamicImport) {
        registerPattern(declaration.name, {
          specifier: direct.specifier,
          dynamicStart: direct.dynamicImport.start,
          kind: "dynamic-direct",
          imported: "*",
        });
        continue;
      }
      registerPromiseAll(declaration.name, declaration.initializer);
    }
  }
  function inspectNested(node) {
    if (ts.isVariableStatement(node)) inspectVariable(node);
    ts.forEachChild(node, inspectNested);
  }
  for (const statement of sourceFile.statements) inspectNested(statement);
  return { imports, unresolved: [...unresolved, ...bindingIssues], dynamicImports, dynamicBindings };
}

function collectExports(ts, sourceFile) {
  const exports = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (hasExportModifier(ts, statement) && statement.name) {
        exports.set(textOfName(ts, statement.name), {
          kind: ts.isClassDeclaration(statement) ? "class" : "local",
          local: textOfName(ts, statement.name),
        });
      }
      continue;
    }
    if (ts.isVariableStatement?.(statement) && hasExportModifier(ts, statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (isIdentifier(ts, declaration.name)) {
          exports.set(textOfName(ts, declaration.name), { kind: "value", local: textOfName(ts, declaration.name) });
        }
      }
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const imported = textOfName(ts, element.propertyName ?? element.name);
          const exported = textOfName(ts, element.name);
          exports.set(exported, moduleSpecifier
            ? { kind: "reexport", specifier: moduleSpecifier, imported }
            : { kind: "local", local: imported });
        }
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      const expression = statement.expression;
      if (isIdentifier(ts, expression)) exports.set("default", { kind: "local", local: expression.text });
    }
  }
  return exports;
}

function resolveRelativePath(fromPath, specifier, knownPaths) {
  if (!RELATIVE_SPECIFIER.test(specifier)) return { external: true, path: null };
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = [base, ...[".js", ".mjs", ".ts"].map(extension => `${base}${extension}`), ...[".js", ".mjs", ".ts"].map(extension => `${base}/index${extension}`)];
  const match = candidates.find(candidate => knownPaths.has(candidate));
  if (!match) return { external: false, path: null };
  return { external: false, path: match };
}

function callName(ts, expression) {
  if (ts.isIdentifier(expression)) return { local: expression.text, property: null, computed: false };
  if (ts.isPropertyAccessExpression(expression)) {
    const object = ts.isIdentifier(expression.expression) ? expression.expression.text : null;
    return { local: object, property: expression.name.text, computed: false };
  }
  if (ts.isElementAccessExpression(expression)) {
    const object = ts.isIdentifier(expression.expression) ? expression.expression.text : null;
    const property = expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression) ? expression.argumentExpression.text : null;
    return { local: object, property, computed: true };
  }
  return { local: null, property: null, computed: false };
}

function collectOwnCalls(ts, functionRecord) {
  const calls = [];
  const root = functionRecord.node.body;
  if (!root) return calls;
  function visit(node) {
    if (node !== root && isFunctionNode(ts, node)) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const sourceFile = node.getSourceFile();
      const lineAndCharacter = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const argumentTexts = node.arguments.map(argument => argument.getText(sourceFile));
      calls.push({
        ...callName(ts, expression),
        line: lineAndCharacter.line + 1,
        column: lineAndCharacter.character + 1,
        start: node.getStart(sourceFile),
        end: node.end,
        callKind: ts.isNewExpression(node) ? "new" : "call",
        expression: expression.getText(),
        argumentTexts,
        argumentFingerprints: argumentTexts.map(argument => sha256(argument)),
        calleeFingerprint: sha256(expression.getText(sourceFile)),
        callFingerprint: sha256(node.getText(sourceFile)),
        node,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return calls;
}

function sourcePathMatchesPrefix(relativePath, prefixes) {
  return prefixes.some(prefix => relativePath === prefix || relativePath.startsWith(prefix));
}

function anyToken(text, tokens) {
  return tokens.some(token => text.includes(token));
}

function isStoragePath(relativePath, manifest) {
  return sourcePathMatchesPrefix(relativePath, manifest.mandatoryWholeModules.filter(value => value.pathPrefix).map(value => value.pathPrefix));
}

function isMandatoryFunctionPath(relativePath, manifest) {
  return manifest.mandatoryFunctionModules.some(group => group.paths.includes(relativePath));
}

function classifyTopLevelStatement(ts, statement, sourceFile, relativePath, manifest) {
  if (IMPORT_KINDS.has(nodeKindName(ts, statement))) return null;
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) return null;
  const text = statement.getText(sourceFile).replace(COMMENT_RE, " ");
  if (SQL_RE.test(text)) return "sql-or-schema-declaration";
  if (anyToken(text, manifest.operationalBoundary.operationalPathProofTokens)) return "operational-path-or-storage-declaration";
  return null;
}

function nonHelperFindingKey(side, category, record, call) {
  return `${side}:${category}:${record.identityKey ?? record.key}:${call.callFingerprint}`;
}

function classifyDirectFunction(ts, file, record, manifest, moduleMap, side, nonHelperDispositions = new Map()) {
  if (!record.stable && record.nested) {
    record.directReasons = [];
    record.unresolved = [];
    record.nonHelperFindings = [];
    return record.directReasons;
  }
  const text = record.node.getText(file.sourceFile).replace(COMMENT_RE, " ");
  const ownCalls = collectOwnCalls(ts, record);
  record.calls = ownCalls;
  const reasons = [];
  const unresolved = [];
  const nonHelperFindings = [];
  if (SQL_RE.test(text)) reasons.push("sql-or-schema-body");
  if (anyToken(text, manifest.operationalBoundary.operationalPathProofTokens)) reasons.push("operational-path-token");
  const filesystemNames = new Set(manifest.operationalBoundary.filesystemNamesRequiringOperationalPathProof);
  for (const call of ownCalls) {
    const calledName = call.property ?? call.local;
    const imported = file.imports.get(call.local);
    let resolved = { external: true, path: null };
    if (imported) {
      resolved = resolveRelativePath(file.path, imported.specifier, moduleMap);
      if (!resolved.external && !resolved.path) {
        unresolved.push(`${file.path}:${call.line}: unresolved relative import ${imported.specifier}`);
        continue;
      }
      if (!resolved.external && resolved.path && isStoragePath(resolved.path, manifest)) reasons.push(`storage-import:${resolved.path}:${call.property ?? imported.imported}`);
    }
    if (calledName && filesystemNames.has(calledName)) {
      if (manifest.operationalBoundary.reviewedNonOperationalFilesystemPaths.includes(file.path)) continue;
      const pathProof = isStoragePath(file.path, manifest)
        || isMandatoryFunctionPath(file.path, manifest)
        || anyToken(text, manifest.operationalBoundary.operationalPathProofTokens);
      if (pathProof) reasons.push(`operational-filesystem-call:${calledName}`);
      else {
        const resolvedTarget = imported && !resolved.external && resolved.path
          ? {
              path: resolved.path,
              name: call.property ?? imported.imported,
              specifier: imported.specifier,
            }
          : imported
            ? { path: null, name: call.property ?? imported.imported, specifier: imported.specifier }
            : { path: null, name: calledName, specifier: null };
        const finding = {
          category: "filesystem-path-proof-unresolved",
          caller: functionDefinitionEvidence(file, record),
          callsite: callsiteEvidence(call),
          calleeTarget: resolvedTarget,
          reason: `filesystem call ${calledName} has no operational-path proof`,
        };
        nonHelperFindings.push(finding);
        if (!nonHelperDispositions.has(nonHelperFindingKey(side, finding.category, record, call))) {
          unresolved.push(`${file.path}:${call.line}: filesystem call ${calledName} has no operational-path proof`);
        }
      }
    } else if (call.local && manifest.operationalBoundary.legacyFunctionNames.includes(call.local)) {
      reasons.push(`operational-function:${call.local}`);
    }
    if (call.computed && (call.local || call.expression.includes("storage") || call.expression.includes("artifact"))) {
      nonHelperFindings.push({
        category: "computed-local-persistence-call",
        caller: functionDefinitionEvidence(file, record),
        callsite: callsiteEvidence(call),
        calleeTarget: {
          kind: "computed-local",
          local: call.local,
          property: call.property,
          resolved: false,
        },
        reason: `computed local persistence call ${call.expression}`,
      });
      if (!nonHelperDispositions.has(nonHelperFindingKey(side, "computed-local-persistence-call", record, call))) {
        unresolved.push(`${file.path}:${call.line}: computed local persistence call ${call.expression}`);
      }
    }
  }
  record.directReasons = [...new Set(reasons)];
  record.unresolved = [...new Set(unresolved)];
  record.nonHelperFindings = nonHelperFindings;
  return record.directReasons;
}

function functionSpan(record) {
  return {
    start: record.start,
    end: record.end,
    lineStart: record.lineStart,
    lineEnd: record.lineEnd,
    key: record.key,
    identityKey: record.identityKey ?? record.key,
    kind: record.kind,
    name: record.name,
    stable: record.stable,
    fingerprint: record.fingerprint,
  };
}

function functionDefinitionEvidence(file, record) {
  const span = functionSpan(record);
  return {
    path: file.path,
    key: span.identityKey ?? span.key,
    sourceKey: span.key,
    kind: span.kind,
    name: span.name,
    start: span.start,
    end: span.end,
    lineStart: span.lineStart,
    lineEnd: span.lineEnd,
    nonblankPhysicalLines: file.source.slice(span.start, span.end).split(/\r?\n/u).filter(line => line.trim()).length,
    stable: span.stable,
    nested: Boolean(record.nested),
    fingerprint: span.fingerprint,
    sourceSha256: file.sha256,
    rawFileSha256: file.sha256,
    directReasons: [...(record.directReasons ?? [])].sort(),
  };
}

function callsiteEvidence(call) {
  return {
    line: call.line,
    column: call.column,
    start: call.start,
    end: call.end,
    callKind: call.callKind,
    expression: call.expression,
    calleeFingerprint: call.calleeFingerprint,
    callFingerprint: call.callFingerprint,
    argumentTexts: call.argumentTexts,
    argumentFingerprints: call.argumentFingerprints,
    local: call.local,
    property: call.property,
    computed: Boolean(call.computed),
  };
}

function nearestEnclosingFunction(file, position) {
  return file.functions
    .filter(record => record.start <= position && position < record.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0] ?? null;
}

function dynamicImportFinding(side, file, dynamicImport, moduleMap, callerRecord = null) {
  const resolved = dynamicImport.relative
    ? resolveRelativePath(file.path, dynamicImport.specifier, moduleMap)
    : { external: false, path: null };
  const caller = callerRecord ?? nearestEnclosingFunction(file, dynamicImport.start);
  if (!caller) return null;
  return {
    side,
    category: dynamicImport.relative ? "dynamic-local-import" : "dynamic-computed-import",
    caller: functionDefinitionEvidence(file, caller),
    callsite: {
      line: dynamicImport.line,
      column: dynamicImport.column,
      start: dynamicImport.start,
      end: dynamicImport.end,
      callKind: "dynamic-import",
      expression: dynamicImport.expressionText,
      calleeFingerprint: sha256("import"),
      callFingerprint: dynamicImport.callFingerprint,
      argumentTexts: dynamicImport.argumentText === null ? [] : [dynamicImport.argumentText],
      argumentFingerprints: dynamicImport.argumentFingerprint ? [dynamicImport.argumentFingerprint] : [],
      local: null,
      property: null,
      computed: !dynamicImport.relative,
    },
    calleeTarget: {
      kind: "dynamic-module",
      specifier: dynamicImport.specifier,
      resolvedPath: resolved.path,
      resolved: Boolean(dynamicImport.relative && resolved.path),
      external: Boolean(resolved.external),
      bindings: dynamicImport.bindings ?? [],
    },
    reason: dynamicImport.relative
      ? `dynamic local import ${dynamicImport.specifier}`
      : dynamicImport.reason,
  };
}

function proveDynamicImportBindings(ts, file, dynamicImport, record, moduleMap, filesByPath) {
  if (!dynamicImport.relative || !dynamicImport.bindings?.length) return false;
  const resolved = resolveRelativePath(file.path, dynamicImport.specifier, moduleMap);
  if (resolved.external || !resolved.path) return false;
  const targetFile = filesByPath.get(resolved.path);
  if (!targetFile) return false;
  const usesByLocal = new Map(dynamicImport.bindings.map(binding => [binding.local, []]));
  function inspect(node) {
    if (ts.isIdentifier(node) && usesByLocal.has(node.text) && node.getStart(file.sourceFile) > dynamicImport.end) {
      usesByLocal.get(node.text).push(node);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(record.node.body ?? record.node);
  for (const binding of dynamicImport.bindings) {
    const uses = usesByLocal.get(binding.local) ?? [];
    if (!uses.length) return false;
    for (const node of uses) {
      const parent = node.parent;
      const directCall = parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node;
      const namespaceCall = parent && ts.isPropertyAccessExpression(parent) && parent.expression === node
        && parent.parent && (ts.isCallExpression(parent.parent) || ts.isNewExpression(parent.parent))
        && parent.parent.expression === parent;
      if (directCall || namespaceCall) continue;
      if (binding.kind === "dynamic-named" && knownNonFunctionExport(targetFile, binding.imported, moduleMap, filesByPath)) continue;
      return false;
    }
  }
  return true;
}

function topLevelDeclarationSpans(ts, file, manifest) {
  const spans = [];
  for (const statement of file.sourceFile.statements) {
    const reason = classifyTopLevelStatement(ts, statement, file.sourceFile, file.path, manifest);
    if (!reason) continue;
    const name = topLevelDeclarationName(ts, statement);
    spans.push({
      kind: nodeKindName(ts, statement),
      name: name ?? `<statement-${statement.pos}>`,
      key: `${file.path}::top-level::${nodeKindName(ts, statement)}::${name ?? statement.pos}`,
      identityKey: `${file.path}::${nodeKindName(ts, statement)}::${name ?? `<statement-${statement.pos}>`}`,
      start: statement.getStart(file.sourceFile),
      end: statement.end,
      lineStart: lineOf(file.sourceFile, statement.getStart(file.sourceFile)),
      lineEnd: lineOf(file.sourceFile, Math.max(statement.getStart(file.sourceFile), statement.end - 1)),
      reason,
      stable: Boolean(name),
    });
  }
  return spans;
}

function topLevelDeclarationName(ts, statement) {
  if (ts.isVariableStatement?.(statement)) {
    const names = statement.declarationList.declarations
      .map(declaration => textOfName(ts, declaration.name))
      .filter(Boolean);
    return names.length ? names.join(",") : null;
  }
  return statement.name ? textOfName(ts, statement.name) : null;
}

function moduleFullSpan(file, reason) {
  const lineEnd = file.source.split(/\r?\n/u).length;
  return {
    kind: "WholeModule",
    name: "<module>",
    key: `${file.path}::module`,
    identityKey: `${file.path}::WholeModule::<module>`,
    start: 0,
    end: file.source.length,
    lineStart: 1,
    lineEnd,
    reason,
    stable: true,
  };
}

function nodeRecord(file, side, span, reason) {
  return {
    side,
    path: file.path,
    key: span.identityKey ?? span.key,
    sourceKey: span.key,
    kind: span.kind,
    name: span.name,
    lineStart: span.lineStart,
    lineEnd: span.lineEnd,
    nonblankPhysicalLines: file.source.slice(span.start, span.end).split(/\r?\n/u).filter(line => line.trim()).length,
    reason,
    stable: span.stable,
    fingerprint: span.fingerprint ?? null,
    sourceSha256: file.sha256,
    rawFileSha256: file.sha256,
  };
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function selectNonOverlappingSpans(spans) {
  const ordered = [...spans].sort((left, right) => {
    const leftLength = left.end - left.start;
    const rightLength = right.end - right.start;
    return rightLength - leftLength || left.start - right.start;
  });
  const chosen = [];
  for (const span of ordered) {
    if (chosen.some(existing => overlaps(existing, span))) continue;
    chosen.push(span);
  }
  return chosen.sort((left, right) => left.start - right.start);
}

function localFunctionByName(file) {
  const map = new Map();
  for (const record of file.functions) {
    if (!record.stable) continue;
    const shortName = record.name.split(".").at(-1);
    if (!map.has(shortName)) map.set(shortName, record);
    if (!map.has(record.name)) map.set(record.name, record);
  }
  return map;
}

function findFunctionRecord(file, name, moduleMap, filesByPath, visited = new Set()) {
  const direct = localFunctionByName(file).get(name);
  if (direct) return { file, record: direct };
  const binding = file.exports?.get(name);
  if (!binding) return null;
  const visitKey = `${file.path}#${name}`;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);
  if (binding.kind === "local") {
    const imported = file.imports?.get(binding.local);
    if (imported) {
      const resolved = resolveRelativePath(file.path, imported.specifier, moduleMap);
      if (resolved.external || !resolved.path) return null;
      const targetFile = filesByPath.get(resolved.path);
      return targetFile
        ? findFunctionRecord(targetFile, imported.imported, moduleMap, filesByPath, visited)
        : null;
    }
    return findFunctionRecord(file, binding.local, moduleMap, filesByPath, visited);
  }
  if (binding.kind !== "reexport") return null;
  const resolved = resolveRelativePath(file.path, binding.specifier, moduleMap);
  if (resolved.external || !resolved.path) return null;
  const targetFile = filesByPath.get(resolved.path);
  return targetFile ? findFunctionRecord(targetFile, binding.imported, moduleMap, filesByPath, visited) : null;
}

function knownNonFunctionExport(file, name, moduleMap, filesByPath, visited = new Set()) {
  const binding = file.exports?.get(name);
  if (!binding) return false;
  const visitKey = `${file.path}#${name}`;
  if (visited.has(visitKey)) return false;
  visited.add(visitKey);
  if (binding.kind === "value" || binding.kind === "class") return true;
  if (binding.kind !== "reexport") return false;
  const resolved = resolveRelativePath(file.path, binding.specifier, moduleMap);
  if (resolved.external || !resolved.path) return false;
  const targetFile = filesByPath.get(resolved.path);
  return targetFile ? knownNonFunctionExport(targetFile, binding.imported, moduleMap, filesByPath, visited) : false;
}

function addFunctionSelection(file, record, reason, selected) {
  if (!record) return;
  if (!record.stable) {
    if (record.nested) return;
    file.unresolved.push(`${file.path}:${record.lineStart}: selected function has no stable name`);
    return;
  }
  const key = record.identityKey ?? record.key;
  const existing = selected.get(key);
  if (existing) existing.reasons.add(reason);
  else selected.set(key, { record, reasons: new Set([reason]) });
}

function isPureReviewedPath(relativePath, manifest) {
  return manifest.transitivePersistenceHelpers.reviewedHelperPaths.includes(relativePath);
}

function resolveCallTarget(ts, file, call, moduleMap, filesByPath) {
  const local = call.local;
  if (!local) return null;
  const imported = file.imports.get(local);
  if (imported) {
    const resolved = resolveRelativePath(file.path, imported.specifier, moduleMap);
    if (resolved.external) return { external: true };
    if (!resolved.path) return { unresolved: true, specifier: imported.specifier };
    const targetFile = filesByPath.get(resolved.path);
    if (!targetFile) return { unresolved: true, specifier: imported.specifier };
    // A named/default import followed by .includes/.join/etc. is a method on
    // an imported value, not a call to a function exported by that module.
    // Resolving the property against the module previously produced false
    // helper-membership findings for constants and arrays.
    if (call.property && imported.kind !== "namespace") return { nonFunction: true };
    const targetName = call.property ?? imported.imported;
    const target = findFunctionRecord(targetFile, targetName, moduleMap, filesByPath);
    if (target) return target;
    if (knownNonFunctionExport(targetFile, targetName, moduleMap, filesByPath)) return { nonFunction: true };
    return { file: targetFile, name: targetName };
  }
  const localFunctions = localFunctionByName(file);
  const target = localFunctions.get(local);
  return target ? { file, record: target } : null;
}

function collectSelectionsForSide(ts, files, manifest, side, helperDispositions = new Map(), nonHelperDispositions = new Map()) {
  const filesByPath = new Map(files.map(file => [file.path, file]));
  const moduleMap = new Set(filesByPath.keys());
  const selectedByPath = new Map();
  const unresolved = [];
  const helperMembershipEdges = [];
  const nonHelperFindings = [];
  for (const file of files) {
    for (const record of file.functions) classifyDirectFunction(ts, file, record, manifest, moduleMap, side, nonHelperDispositions);
  }
  const reasonsByPath = new Map();
  for (const file of files) {
    file.unresolved = [...file.unresolved];
    const selected = new Map();
    if (isStoragePath(file.path, manifest)) {
      const span = moduleFullSpan(file, "mandatory-storage-module");
      selected.set(span.identityKey, { span, reasons: new Set(["mandatory-storage-module"]) });
    } else if (manifest.mandatoryFunctionModules.some(group => group.paths.includes(file.path))) {
      for (const record of file.functions) addFunctionSelection(file, record, "mandatory-legacy-persistence-boundary", selected);
      for (const span of topLevelDeclarationSpans(ts, file, manifest)) selected.set(span.identityKey, { span, reasons: new Set(["mandatory-legacy-persistence-declaration"]) });
    }
    for (const record of file.functions) {
      if (record.directReasons.length) addFunctionSelection(file, record, "direct-operational-persistence", selected);
    }
    // A mandatory storage module is already charged as one complete module;
    // adding every nested declaration here creates shadow identities that can
    // never contribute lines and later appear as false unpaired changes.
    if (!isStoragePath(file.path, manifest)) {
      for (const span of topLevelDeclarationSpans(ts, file, manifest)) {
        if (!selected.has(span.identityKey)) selected.set(span.identityKey, { span, reasons: new Set(["operational-top-level-declaration"]) });
      }
    }
    selectedByPath.set(file.path, selected);
    reasonsByPath.set(file.path, file.unresolved);
  }

  // Some exact helper endpoints are passed as callbacks (for example a sort
  // comparator) and therefore have no CallExpression edge of their own.  A
  // source-pinned forceSelection disposition makes those reviewed endpoints
  // countable without widening the manifest to a whole file or path.
  for (const disposition of helperDispositions.values()) {
    if (!disposition.forceSelection) continue;
    const targetFile = filesByPath.get(disposition.selector?.path);
    const targetRecord = targetFile?.functions.find(candidate =>
      (candidate.identityKey ?? candidate.key) === disposition.selectorKey);
    if (!targetFile || !targetRecord) {
      unresolved.push(`manifest:${disposition.id}: forced helper endpoint is absent during selection`);
      continue;
    }
    addFunctionSelection(
      targetFile,
      targetRecord,
      "reviewed-explicit-function-persistence",
      selectedByPath.get(targetFile.path),
    );
  }

  const queue = [];
  for (const file of files) {
    const selected = selectedByPath.get(file.path);
    if (isStoragePath(file.path, manifest)) {
      for (const record of file.functions) queue.push({ file, record });
    }
    for (const { record } of selected.values()) if (record) queue.push({ file, record });
  }
  const visited = new Set();
  while (queue.length) {
    const { file, record } = queue.shift();
    const visitKey = `${file.path}::${record.key}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    nonHelperFindings.push(...(record.nonHelperFindings ?? []).map(finding => ({ ...finding, side })));
    unresolved.push(...(record.unresolved ?? []));
    for (const dynamicImport of file.dynamicImports) {
      if (dynamicImport.start < record.start || dynamicImport.end > record.end) continue;
      const finding = dynamicImportFinding(side, file, dynamicImport, moduleMap, record);
      // A selected outer function can contain several nested callbacks with
      // identical imported names.  Prove each import against its nearest
      // lexical function so a later callback's binding cannot invalidate an
      // otherwise exact direct call in the import's own callback.
      const proofRecord = nearestEnclosingFunction(file, dynamicImport.start) ?? record;
      const staticallyProven = proveDynamicImportBindings(ts, file, dynamicImport, proofRecord, moduleMap, filesByPath);
      if (finding) {
        finding.staticBindingProof = staticallyProven
          ? "literal-relative-module-and-binding-uses-proven"
          : "unproven-binding-or-use";
        if (!staticallyProven) nonHelperFindings.push(finding);
      }
      if (!staticallyProven) {
        unresolved.push(`${file.path}:${dynamicImport.line}: ${dynamicImport.relative ? `dynamic local import ${dynamicImport.specifier}` : dynamicImport.reason}`);
      }
    }
    for (const call of record.calls) {
      const target = resolveCallTarget(ts, file, call, moduleMap, filesByPath);
      if (!target || target.external) continue;
      if (target.unresolved) {
        helperMembershipEdges.push({
          side,
          status: "UNRESOLVED_CALL_TARGET",
          caller: functionDefinitionEvidence(file, record),
          callsite: callsiteEvidence(call),
          target: {
            path: null,
            key: null,
            name: null,
            specifier: target.specifier ?? call.expression,
          },
          reason: "relative-import-target-unresolved",
        });
        unresolved.push(`${file.path}:${call.line}: ${target.specifier ?? call.expression}`);
        continue;
      }
      if (target.nonFunction) continue;
      const targetRecord = target.record ?? target.file.functions.find(candidate => candidate.name === target.name || candidate.name.endsWith(`.${target.name}`));
      if (!targetRecord) {
        const targetPath = target.file.path;
        helperMembershipEdges.push({
          side,
          status: "UNRESOLVED_MISSING_DEFINITION",
          caller: functionDefinitionEvidence(file, record),
          callsite: callsiteEvidence(call),
          target: {
            path: targetPath,
            key: null,
            name: target.name,
          },
          reason: "local-persistence-helper-has-no-resolvable-function-declaration",
        });
        if (isStoragePath(targetPath, manifest)) continue;
        unresolved.push(`${file.path}:${call.line}: local persistence helper ${targetPath}#${target.name} has no resolvable function declaration`);
        continue;
      }
      const targetPath = target.file.path;
      const targetName = targetRecord.name ?? target.name;
      const targetKey = targetRecord.identityKey ?? targetRecord.key;
      const targetSelected = selectedByPath.get(targetPath);
      const targetHasPersistence = targetRecord.directReasons.length > 0;
      const storageTarget = isStoragePath(targetPath, manifest);
      const reviewedPathTarget = isPureReviewedPath(targetPath, manifest);
      const helperDisposition = helperDispositions.get(targetKey) ?? null;
      const alreadySelected = Boolean(targetSelected?.has(targetKey));
      let includeTransitive = storageTarget || reviewedPathTarget || targetHasPersistence;
      let inclusionReason = storageTarget
        ? "transitive-storage-helper"
        : reviewedPathTarget
          ? "transitive-reviewed-persistence-helper"
          : targetHasPersistence
            ? "transitive-direct-operational-persistence"
            : null;
      let status = includeTransitive ? "INCLUDED" : "UNRESOLVED_REVIEW_REQUIRED";
      let reason = inclusionReason ?? "helper-membership-requires-function-review";
      if (helperDisposition?.disposition === "REVIEWED_INCLUDE_PERSISTENCE") {
        includeTransitive = true;
        inclusionReason = "reviewed-function-persistence";
        status = "INCLUDED_REVIEWED_PERSISTENCE";
        reason = helperDisposition.reason;
      } else if (helperDisposition?.disposition === "REVIEWED_EXCLUDE_PURE_DOMAIN") {
        const cannotExclude = storageTarget || reviewedPathTarget || targetHasPersistence || isMandatoryFunctionPath(targetPath, manifest) || alreadySelected;
        if (cannotExclude) {
          status = "UNRESOLVED_DISPOSITION_CONFLICT";
          reason = `helper disposition ${helperDisposition.id} conflicts with mandatory or persistence evidence`;
          unresolved.push(`${file.path}:${call.line}: helper disposition ${helperDisposition.id} conflicts with persistence evidence for ${targetPath}#${targetName}`);
        } else {
          includeTransitive = false;
          inclusionReason = null;
          status = "EXCLUDED_REVIEWED_PURE_DOMAIN";
          reason = helperDisposition.reason;
        }
      }
      helperMembershipEdges.push({
        side,
        status,
        caller: functionDefinitionEvidence(file, record),
        callsite: callsiteEvidence(call),
        target: functionDefinitionEvidence(target.file, targetRecord),
        reason,
        disposition: helperDisposition
          ? {
              id: helperDisposition.id,
              disposition: helperDisposition.disposition,
              reason: helperDisposition.reason,
            }
          : null,
      });
      if (includeTransitive) {
        addFunctionSelection(target.file, targetRecord, inclusionReason, targetSelected);
        queue.push({ file: target.file, record: targetRecord });
      } else if (status === "UNRESOLVED_REVIEW_REQUIRED" && (targetPath.startsWith("src/") || targetPath.startsWith("integrations/"))) {
        unresolved.push(`${file.path}:${call.line}: helper membership unresolved for ${targetPath}#${targetName}`);
      }
    }
  }

  for (const file of files) unresolved.push(...file.unresolved);
  const selectionMaps = new Map([...selectedByPath].map(([filePath, selected]) => [filePath, new Map(selected)]));
  const allNodesByKey = new Map();
  for (const file of files) {
    for (const record of file.functions) {
      const span = functionSpan(record);
      allNodesByKey.set(span.identityKey, { file, span });
    }
    for (const span of topLevelDeclarationSpans(ts, file, manifest)) allNodesByKey.set(span.identityKey, { file, span });
    if (isStoragePath(file.path, manifest)) {
      const span = moduleFullSpan(file, "mandatory-storage-module");
      allNodesByKey.set(span.identityKey, { file, span });
    }
  }
  const functionCallGraph = [];
  const allFunctionNonHelperFindings = [];
  for (const file of files) {
    for (const record of file.functions) {
      allFunctionNonHelperFindings.push(...(record.nonHelperFindings ?? []).map(finding => ({ ...finding, side })));
    }
    for (const dynamicImport of file.dynamicImports) {
      const caller = nearestEnclosingFunction(file, dynamicImport.start);
      const finding = dynamicImportFinding(side, file, dynamicImport, moduleMap, caller);
      if (finding) {
        finding.staticBindingProof = caller && proveDynamicImportBindings(ts, file, dynamicImport, caller, moduleMap, filesByPath)
          ? "literal-relative-module-and-binding-uses-proven"
          : "unproven-binding-or-use";
        allFunctionNonHelperFindings.push(finding);
      }
    }
  }
  for (const file of files) {
    for (const record of file.functions) {
      if (!record.stable || !record.calls) continue;
      const calls = record.calls.map(call => {
        const target = resolveCallTarget(ts, file, call, moduleMap, filesByPath);
        let resolution;
        if (!target || target.external) resolution = { kind: "external-or-untracked" };
        else if (target.unresolved) resolution = { kind: "unresolved-import", specifier: target.specifier ?? null };
        else if (target.nonFunction) resolution = { kind: "non-function-export" };
        else {
          const targetRecord = target.record ?? target.file?.functions.find(candidate => candidate.name === target.name || candidate.name.endsWith(`.${target.name}`));
          if (targetRecord) {
            resolution = {
              kind: "local-function",
              target: functionDefinitionEvidence(target.file, targetRecord),
            };
          } else if (target.file) {
            resolution = {
              kind: "missing-function-definition",
              target: { path: target.file.path, name: target.name ?? null },
            };
          } else resolution = { kind: "unresolved-target" };
        }
        return { callsite: callsiteEvidence(call), resolution };
      });
      functionCallGraph.push({
        side,
        function: functionDefinitionEvidence(file, record),
        calls,
      });
    }
  }
  return {
    nodeRows: [],
    unresolved: [...new Set(unresolved)].sort(),
    selectionMaps,
    allNodesByKey,
    helperMembershipEdges,
    nonHelperFindings,
    allFunctionNonHelperFindings,
    functionCallGraph,
  };
}

function finalizeSelection(side, files, selectionMaps) {
  const nodeRows = [];
  for (const [filePath, selected] of selectionMaps) {
    for (const value of selected.values()) {
      if (value.record) value.span = functionSpan(value.record);
      value.reason = [...value.reasons].sort().join(",");
    }
    const spans = selectNonOverlappingSpans([...selected.values()].map(value => ({ ...value.span, reason: value.reason })));
    const file = files.find(candidate => candidate.path === filePath);
    if (!file) continue;
    for (const span of spans) nodeRows.push(nodeRecord(file, side, span, span.reason));
  }
  return nodeRows;
}

function identitySelectorKey(selector) {
  if (!selector || typeof selector.path !== "string" || typeof selector.kind !== "string" || typeof selector.name !== "string") return null;
  return `${selector.path}::${selector.kind}::${selector.name}`;
}

function selectedIdentityKeys(selection) {
  const spans = [];
  for (const selected of selection.selectionMaps.values()) {
    for (const [key, value] of selected) {
      const span = value.span ?? (value.record ? functionSpan(value.record) : null);
      if (span) spans.push({ ...span, identityKey: span.identityKey ?? key });
    }
  }
  return new Set(selectNonOverlappingSpans(spans).map(span => span.identityKey ?? span.key));
}

function addCounterpartSelection(selection, identityKey, reason) {
  const descriptor = selection.allNodesByKey.get(identityKey);
  if (!descriptor) return false;
  if (!selection.selectionMaps.has(descriptor.file.path)) selection.selectionMaps.set(descriptor.file.path, new Map());
  const selected = selection.selectionMaps.get(descriptor.file.path);
  const existing = selected.get(identityKey);
  if (existing) {
    existing.reasons.add(reason);
    return false;
  }
  selected.set(identityKey, { span: descriptor.span, reasons: new Set([reason]) });
  return true;
}

function applySymmetricIdentityClosure(baselineSelection, currentSelection, manifest) {
  const unresolved = [];
  const identityMappings = manifest.identityMappings ?? [];
  const mappingPairs = [];
  for (const mapping of identityMappings) {
    const baselineKey = identitySelectorKey(mapping.baseline);
    const currentKey = identitySelectorKey(mapping.current);
    if (!baselineKey || !currentKey) {
      unresolved.push(`manifest:${mapping.id ?? "<unnamed>"}: invalid identity mapping selector`);
      continue;
    }
    if (!baselineSelection.allNodesByKey.has(baselineKey) || !currentSelection.allNodesByKey.has(currentKey)) {
      unresolved.push(`manifest:${mapping.id ?? "<unnamed>"}: identity mapping endpoint is absent on its declared side`);
      continue;
    }
    mappingPairs.push({ id: mapping.id ?? `${baselineKey}->${currentKey}`, baselineKey, currentKey });
  }

  const baselineKeys = selectedIdentityKeys(baselineSelection);
  const currentKeys = selectedIdentityKeys(currentSelection);
  for (const pair of mappingPairs) {
    if (baselineKeys.has(pair.baselineKey) || currentKeys.has(pair.currentKey)) {
      addCounterpartSelection(baselineSelection, pair.baselineKey, `explicit-identity-mapping:${pair.id}`);
      addCounterpartSelection(currentSelection, pair.currentKey, `explicit-identity-mapping:${pair.id}`);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const baselineKeys = selectedIdentityKeys(baselineSelection);
    let currentKeys = selectedIdentityKeys(currentSelection);
    for (const key of baselineKeys) {
      if (currentSelection.allNodesByKey.has(key) && !currentKeys.has(key)) {
        changed = addCounterpartSelection(currentSelection, key, "symmetric-counterpart") || changed;
      }
    }
    if (changed) currentKeys = selectedIdentityKeys(currentSelection);
    const baselineKeysAfter = baselineKeys;
    for (const key of currentKeys) {
      if (baselineSelection.allNodesByKey.has(key) && !baselineKeysAfter.has(key)) {
        changed = addCounterpartSelection(baselineSelection, key, "symmetric-counterpart") || changed;
      }
    }
  }

  const dispositions = new Set((manifest.identityDispositions ?? []).map(disposition => {
    const key = identitySelectorKey(disposition.selector);
    return key ? `${disposition.side}:${key}` : null;
  }).filter(Boolean));
  const renameCandidates = [];
  function inspectUnpaired(selection, otherSelection, side) {
    for (const key of selectedIdentityKeys(selection)) {
      const descriptor = selection.allNodesByKey.get(key);
      if (!descriptor || descriptor.span.kind === "WholeModule") continue;
      if (otherSelection.allNodesByKey.has(key)) continue;
      if (dispositions.has(`${side}:${key}`)) continue;
      const samePathCandidates = [...otherSelection.allNodesByKey.values()].filter(candidate =>
        candidate.span.kind === descriptor.span.kind
        && candidate.span.name !== "<module>"
        && candidate.file.path === descriptor.file.path,
      );
      const fingerprintCandidates = [...otherSelection.allNodesByKey.values()].filter(candidate =>
        candidate.span.kind === descriptor.span.kind
        && candidate.span.fingerprint
        && descriptor.span.fingerprint
        && candidate.span.fingerprint === descriptor.span.fingerprint
        && candidate.span.identityKey !== descriptor.span.identityKey,
      );
      if (fingerprintCandidates.length) {
        renameCandidates.push({
          side,
          selectedKey: key,
          candidates: fingerprintCandidates.map(candidate => candidate.span.identityKey).sort(),
          method: "same-file-kind-body-token-fingerprint-heuristic",
          autoPaired: false,
        });
      }
      const context = samePathCandidates.length ? "same-path-function-exists" : "no-exact-counterpart";
      unresolved.push(`${side}:${key}: unpaired function identity (${context}); add an explicit identity mapping or reviewed disposition`);
    }
  }
  inspectUnpaired(baselineSelection, currentSelection, "baseline");
  inspectUnpaired(currentSelection, baselineSelection, "current");
  return { unresolved: [...new Set(unresolved)].sort(), mappingPairs, renameCandidates };
}

async function loadSide(root, productionRoots, ts) {
  const paths = await listSourceFiles(root, productionRoots);
  const knownPaths = new Set(paths);
  const parser = ts.createParser(root);
  let parsed;
  try {
    parsed = parser.openFiles(paths.map(relativePath => path.join(root, relativePath)));
  } catch (error) {
    parser.close();
    throw error;
  }
  const files = [];
  for (const relativePath of paths) {
    const absolute = path.join(root, relativePath);
    const sourceBuffer = await readFile(absolute);
    const source = sourceBuffer.toString("utf8");
    const parsedFile = parsed.get(absolute);
    if (!parsedFile) fail(`TypeScript parser returned no result for ${absolute}`);
    const sourceFile = parsedFile.sourceFile;
    const diagnostics = parsedFile.diagnostics ?? [];
    const unresolved = diagnostics.map(diagnostic => `${relativePath}:${lineOf(sourceFile, diagnostic.start ?? 0)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    const importData = collectImports(ts, sourceFile);
    const functionRecords = collectFunctionRecords(ts, sourceFile, relativePath, source);
    const imports = new Map(importData.imports);
    for (const [localName, binding] of importData.dynamicBindings) {
      if (imports.has(localName)) {
        const existing = imports.get(localName);
        // A module may retain a static import for one path and use a guarded
        // dynamic import for the same named export elsewhere.  When both
        // bindings resolve to the exact same relative module/export, this is
        // a redundant binding, not an unresolved conflict.  Keep the static
        // binding as the canonical call-resolution entry.
        if (existing?.specifier !== binding.specifier || existing?.imported !== binding.imported) {
          importData.unresolved.push(`${relativePath}: dynamic import binding ${localName} conflicts with a static import`);
        }
      } else imports.set(localName, binding);
    }
    files.push({
      path: relativePath,
      source,
      sourceFile,
      sha256: sha256(sourceBuffer),
      nonblankPhysicalLines: nonblankLines(source),
      imports,
      exports: collectExports(ts, sourceFile),
      dynamicImports: importData.dynamicImports,
      unresolved: [...unresolved, ...importData.unresolved],
      functions: functionRecords,
    });
  }
  return { files, knownPaths, parser };
}

function validateHelperMembershipDispositions(manifest, sides) {
  const entries = manifest.helperMembershipDispositions ?? [];
  if (!Array.isArray(entries)) {
    return {
      dispositions: new Map(),
      unresolved: ["manifest:helper-membership-dispositions must be an array"],
    };
  }
  const dispositions = new Map();
  const unresolved = [];
  const allowed = new Set(["REVIEWED_INCLUDE_PERSISTENCE", "REVIEWED_EXCLUDE_PURE_DOMAIN"]);
  for (const entry of entries) {
    const id = typeof entry?.id === "string" && entry.id ? entry.id : "<unnamed>";
    const side = entry?.side;
    const selector = entry?.selector;
    const selectorKey = identitySelectorKey(selector);
    const disposition = entry?.disposition;
    const reason = entry?.reason;
    if (side !== "baseline" && side !== "current") {
      unresolved.push(`manifest:${id}: helper disposition side must be baseline or current`);
      continue;
    }
    if (!selectorKey || selector.kind === "WholeModule" || selector.name === "<module>") {
      unresolved.push(`manifest:${id}: helper disposition requires a stable function selector`);
      continue;
    }
    if (!allowed.has(disposition)) {
      unresolved.push(`manifest:${id}: unsupported helper disposition ${disposition ?? "<missing>"}`);
      continue;
    }
    if (typeof reason !== "string" || !reason.trim()) {
      unresolved.push(`manifest:${id}: helper disposition requires a source-backed reason`);
      continue;
    }
    if (typeof entry.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sourceSha256)) {
      unresolved.push(`manifest:${id}: helper disposition requires a 64-character sourceSha256`);
      continue;
    }
    if (typeof entry.fingerprint !== "string" || !entry.fingerprint) {
      unresolved.push(`manifest:${id}: helper disposition requires a function fingerprint`);
      continue;
    }
    if (!Number.isInteger(entry.lineStart) || !Number.isInteger(entry.lineEnd) || entry.lineStart < 1 || entry.lineEnd < entry.lineStart) {
      unresolved.push(`manifest:${id}: helper disposition requires a valid definition line span`);
      continue;
    }
    const files = sides[side]?.files ?? [];
    const file = files.find(candidate => candidate.path === selector.path);
    const record = file?.functions.find(candidate => (candidate.identityKey ?? candidate.key) === selectorKey);
    if (!file || !record) {
      unresolved.push(`manifest:${id}: helper disposition endpoint is absent on ${side}`);
      continue;
    }
    const actual = functionDefinitionEvidence(file, record);
    if (actual.sourceSha256 !== entry.sourceSha256) {
      unresolved.push(`manifest:${id}: helper disposition source hash changed for ${selectorKey}`);
      continue;
    }
    if (actual.fingerprint !== entry.fingerprint) {
      unresolved.push(`manifest:${id}: helper disposition function fingerprint changed for ${selectorKey}`);
      continue;
    }
    if (actual.lineStart !== entry.lineStart || actual.lineEnd !== entry.lineEnd) {
      unresolved.push(`manifest:${id}: helper disposition definition span changed for ${selectorKey}`);
      continue;
    }
    const mapKey = `${side}:${selectorKey}`;
    if (dispositions.has(mapKey)) {
      unresolved.push(`manifest:${id}: duplicate helper disposition for ${mapKey}`);
      continue;
    }
    dispositions.set(mapKey, {
      ...entry,
      id,
      selectorKey,
    });
  }
  return { dispositions, unresolved };
}

function validateNonHelperMembershipDispositions(manifest, sides, ts) {
  // Function records are created before selection and intentionally start with
  // an empty calls array.  Populate the exact callsite evidence before
  // validating dispositions; otherwise every source-backed non-helper entry
  // is falsely rejected as absent.
  for (const side of Object.values(sides)) {
    for (const file of side?.files ?? []) {
      for (const record of file.functions ?? []) record.calls = collectOwnCalls(ts, record);
    }
  }
  const entries = manifest.nonHelperMembershipDispositions ?? [];
  if (!Array.isArray(entries)) {
    return {
      dispositions: new Map(),
      unresolved: ["manifest:non-helper-membership-dispositions must be an array"],
    };
  }
  const dispositions = new Map();
  const unresolved = [];
  const allowedCategories = new Set([
    "dynamic-local-import",
    "filesystem-path-proof-unresolved",
    "computed-local-persistence-call",
  ]);
  for (const entry of entries) {
    const id = typeof entry?.id === "string" && entry.id ? entry.id : "<unnamed>";
    const side = entry?.side;
    const category = entry?.category;
    const selector = entry?.selector;
    const selectorKey = identitySelectorKey(selector);
    const callsite = entry?.callsite;
    const disposition = entry?.disposition;
    if (side !== "baseline" && side !== "current") {
      unresolved.push(`manifest:${id}: non-helper disposition side must be baseline or current`);
      continue;
    }
    if (!allowedCategories.has(category)) {
      unresolved.push(`manifest:${id}: unsupported non-helper disposition category ${category ?? "<missing>"}`);
      continue;
    }
    if (disposition !== "REVIEWED_INCLUDE_PERSISTENCE") {
      unresolved.push(`manifest:${id}: non-helper disposition must conservatively include persistence`);
      continue;
    }
    if (!selectorKey || selector.kind === "WholeModule" || selector.name === "<module>") {
      unresolved.push(`manifest:${id}: non-helper disposition requires a function selector`);
      continue;
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      unresolved.push(`manifest:${id}: non-helper disposition requires a source-backed reason`);
      continue;
    }
    if (!callsite || typeof callsite.callFingerprint !== "string" || !callsite.callFingerprint) {
      unresolved.push(`manifest:${id}: non-helper disposition requires a callsite fingerprint`);
      continue;
    }
    const files = sides[side]?.files ?? [];
    const file = files.find(candidate => candidate.path === selector.path);
    const record = file?.functions.find(candidate => (candidate.identityKey ?? candidate.key) === selectorKey);
    if (!file || !record) {
      unresolved.push(`manifest:${id}: non-helper caller endpoint is absent on ${side}`);
      continue;
    }
    const callerEvidence = functionDefinitionEvidence(file, record);
    for (const field of ["sourceSha256", "fingerprint", "lineStart", "lineEnd"]) {
      if (entry.caller?.[field] !== callerEvidence[field]) {
        unresolved.push(`manifest:${id}: caller ${field} changed for ${selectorKey}`);
      }
    }
    const actualCall = record.calls?.find(call => call.callFingerprint === callsite.callFingerprint);
    if (!actualCall) {
      unresolved.push(`manifest:${id}: non-helper callsite is absent for ${selectorKey}`);
      continue;
    }
    for (const field of ["start", "end", "line", "column", "calleeFingerprint"]) {
      if (callsite[field] !== actualCall[field]) {
        unresolved.push(`manifest:${id}: callsite ${field} changed for ${selectorKey}`);
      }
    }
    if (unresolved.some(error => error.includes(`manifest:${id}:`))) continue;
    const key = nonHelperFindingKey(side, category, record, actualCall);
    if (dispositions.has(key)) {
      unresolved.push(`manifest:${id}: duplicate non-helper disposition for ${key}`);
      continue;
    }
    dispositions.set(key, { ...entry, id, selectorKey });
  }
  return { dispositions, unresolved };
}

function gitRevision(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch (error) {
    fail(`Cannot resolve Git revision for ${root}`, [error.message]);
  }
}

function assertBaselineSourceClean(root, productionRoots) {
  try {
    const status = execFileSync(
      "git",
      ["-C", root, "status", "--porcelain=v1", "--untracked-files=all", "--", ...productionRoots],
      { encoding: "utf8" },
    ).trim();
    if (status) fail(`Pinned baseline production source is not clean at ${root}`, status.split("\n"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Pinned baseline production source is not clean")) throw error;
    fail(`Cannot inspect pinned baseline source status at ${root}`, [error.message]);
  }
}

function sideSummary(nodeRows, side) {
  return nodeRows.filter(row => row.side === side).reduce((sum, row) => sum + row.nonblankPhysicalLines, 0);
}

async function main() {
  const argumentsValue = parseArguments(process.argv.slice(2));
  const scopeBytes = await readFile(argumentsValue.scopeManifest);
  const scopeText = argumentsValue.scopeManifest.endsWith(".gz")
    ? gunzipSync(scopeBytes).toString("utf8") : scopeBytes.toString("utf8");
  const manifest = JSON.parse(scopeText);
  if (manifest.schemaVersion !== 1 || manifest.kind !== "PERSISTENCE_LOC_FUNCTION_SCOPE_MANIFEST") fail("Unsupported scope manifest kind/version");
  const typescript = loadTypeScript(argumentsValue.repoRoot, manifest.parser?.expectedVersion);
  const manifestHash = sha256(JSON.stringify(manifest));
  assertBaselineSourceClean(argumentsValue.baselineRoot, manifest.productionRoots);
  const baselineRevision = gitRevision(argumentsValue.baselineRoot);
  if (baselineRevision !== manifest.baselineRevision) fail(`Baseline revision ${baselineRevision} does not match manifest ${manifest.baselineRevision}`);
  const [baseline, current] = await Promise.all([
    loadSide(argumentsValue.baselineRoot, manifest.productionRoots, typescript),
    loadSide(argumentsValue.repoRoot, manifest.productionRoots, typescript),
  ]);
  const helperDispositionValidation = validateHelperMembershipDispositions(manifest, { baseline, current });
  const nonHelperDispositionValidation = validateNonHelperMembershipDispositions(manifest, { baseline, current }, typescript);
  const baselineDispositions = new Map(
    [...helperDispositionValidation.dispositions]
      .filter(([key]) => key.startsWith("baseline:"))
      .map(([key, value]) => [key.slice("baseline:".length), value]),
  );
  const currentDispositions = new Map(
    [...helperDispositionValidation.dispositions]
      .filter(([key]) => key.startsWith("current:"))
      .map(([key, value]) => [key.slice("current:".length), value]),
  );
  const baselineNonHelperDispositions = new Map(
    [...nonHelperDispositionValidation.dispositions]
      .filter(([key]) => key.startsWith("baseline:"))
      .map(([key, value]) => [key, value]),
  );
  const currentNonHelperDispositions = new Map(
    [...nonHelperDispositionValidation.dispositions]
      .filter(([key]) => key.startsWith("current:"))
      .map(([key, value]) => [key, value]),
  );
  const baselineSelection = collectSelectionsForSide(typescript, baseline.files, manifest, "baseline", baselineDispositions, baselineNonHelperDispositions);
  const currentSelection = collectSelectionsForSide(typescript, current.files, manifest, "current", currentDispositions, currentNonHelperDispositions);
  const symmetry = applySymmetricIdentityClosure(baselineSelection, currentSelection, manifest);
  const baselineNodeRows = finalizeSelection("baseline", baseline.files, baselineSelection.selectionMaps);
  const currentNodeRows = finalizeSelection("current", current.files, currentSelection.selectionMaps);
  const nodeRows = [...baselineNodeRows, ...currentNodeRows];
  const declaredUnresolvedMembership = (manifest.knownUnresolvedMembership ?? [])
    .filter(entry => entry.status !== "RESOLVED")
    .map(entry => `manifest:${entry.id}: ${entry.reason}`);
  const unresolvedMembership = [...new Set([
    ...declaredUnresolvedMembership,
    ...helperDispositionValidation.unresolved,
    ...nonHelperDispositionValidation.unresolved,
    ...baselineSelection.unresolved,
    ...currentSelection.unresolved,
    ...symmetry.unresolved,
  ])].sort();
  const baselineSelectedLines = sideSummary(nodeRows, "baseline");
  const currentSelectedLines = sideSummary(nodeRows, "current");
  if (baselineSelectedLines <= 0) fail("Selected baseline persistence scope is empty; fail closed rather than measuring a zero denominator");
  const acceptanceEligible = unresolvedMembership.length === 0;
  const targetMet = acceptanceEligible && currentSelectedLines <= baselineSelectedLines * 0.75;
  const result = {
    schemaVersion: 1,
    kind: "PERSISTENCE_LOC_FUNCTION_SCOPE_RESULT",
    acceptanceEligible,
    targetMet,
    baselineRevision,
    currentRevision: gitRevision(argumentsValue.repoRoot),
    parserVersion: typescript.version,
    baselineSourceClean: true,
    rawFileHashes: "sha256 over source bytes, preserved per side/path in fileRows and per selected node in nodeRows",
    scopeManifest: argumentsValue.scopeManifest,
    scopeManifestSha256: manifestHash,
    productionRoots: manifest.productionRoots,
    baselineSelectedLines,
    currentSelectedLines,
    netReduction: 1 - currentSelectedLines / baselineSelectedLines,
    threshold: "currentSelectedLines <= baselineSelectedLines * 0.75",
    identityMappingsApplied: symmetry.mappingPairs,
    renameCandidates: symmetry.renameCandidates,
    helperMembershipDispositionsApplied: [...helperDispositionValidation.dispositions.values()].map(disposition => ({
      id: disposition.id,
      side: disposition.side,
      selector: disposition.selector,
      disposition: disposition.disposition,
      reason: disposition.reason,
      sourceSha256: disposition.sourceSha256,
      fingerprint: disposition.fingerprint,
      lineStart: disposition.lineStart,
      lineEnd: disposition.lineEnd,
      forceSelection: Boolean(disposition.forceSelection),
    })),
    nonHelperMembershipDispositionsApplied: [...nonHelperDispositionValidation.dispositions.values()].map(disposition => ({
      id: disposition.id,
      side: disposition.side,
      category: disposition.category,
      selector: disposition.selector,
      disposition: disposition.disposition,
      reason: disposition.reason,
      semanticStatus: disposition.semanticStatus ?? "INCLUDED_WITH_SEMANTIC_UNCERTAINTY",
      caller: disposition.caller,
      callsite: disposition.callsite,
    })),
    helperMembershipEdges: [
      ...baselineSelection.helperMembershipEdges,
      ...currentSelection.helperMembershipEdges,
    ],
    functionCallGraph: [
      ...baselineSelection.functionCallGraph,
      ...currentSelection.functionCallGraph,
    ],
    nonHelperFindings: [
      ...baselineSelection.nonHelperFindings,
      ...currentSelection.nonHelperFindings,
    ],
    allFunctionNonHelperFindings: [
      ...baselineSelection.allFunctionNonHelperFindings,
      ...currentSelection.allFunctionNonHelperFindings,
    ],
    declaredUnresolvedMembership,
    unresolvedMembership,
    fileRows: [
      ...baseline.files.map(file => ({ side: "baseline", path: file.path, sha256: file.sha256, rawFileSha256: file.sha256, nonblankPhysicalLines: file.nonblankPhysicalLines })),
      ...current.files.map(file => ({ side: "current", path: file.path, sha256: file.sha256, rawFileSha256: file.sha256, nonblankPhysicalLines: file.nonblankPhysicalLines })),
    ],
    nodeRows,
    wholeModuleInventory: {
      retainedAsSeparateEvidence: true,
      path: path.join(argumentsValue.repoRoot, "benchmarks/storage-sqlite/persistence-loc/whole-module-inventory.json"),
      candidateTargetMet: false,
      scopeReviewComplete: false,
    },
    limitations: [
      "This result is static LOC evidence; it does not prove runtime sole-writer closure, correctness, latency, or durability gates.",
      "Any unresolved membership makes acceptanceEligible=false and forbids targetMet=true.",
    ],
  };
  await writeFile(argumentsValue.output, `${JSON.stringify(result, null, 2)}\n`);
  baseline.parser.close();
  current.parser.close();
  process.stdout.write(`${JSON.stringify({
    output: argumentsValue.output,
    acceptanceEligible,
    targetMet,
    baselineSelectedLines,
    currentSelectedLines,
    netReduction: result.netReduction,
    unresolvedMembership: unresolvedMembership.length,
    identityMappingsApplied: symmetry.mappingPairs.length,
    renameCandidates: symmetry.renameCandidates.length,
  }, null, 2)}\n`);
}

main().catch(error => {
  for (const parser of OPEN_PARSERS) parser.close();
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
