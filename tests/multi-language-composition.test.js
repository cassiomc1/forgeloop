import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import { evaluateRoute } from "../src/core/router.js";
import { temporaryProject, writeFiles } from "./helpers/multi-language-project.js";

const nodePackage = "{\"name\":\"service\",\"scripts\":{\"start\":\"node src/server.js\"}}\n";
const goModule = "module example.com/service\ngo 1.27\n";
const phpPackage = "{\"name\":\"acme/service\",\"require\":{\"php\":\"^8.3\"},\"autoload\":{\"psr-4\":{\"Acme\\\\\":\"src/\"}}}\n";
const swiftPackage = "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"service\")\n";

test("same-root language evidence composes across native, JVM, SQL, and application stacks", async () => {
  await temporaryProject("forgeloop-language-composition-", async (target) => {
    await writeFiles(target, {
      "native/CMakeLists.txt": "project(native LANGUAGES C CXX)\n",
      "native/src/main.c": "int main(void) { return 0; }\n",
      "native/src/main.cpp": "int main() { return 0; }\n",
      "services/node-ts/package.json": nodePackage,
      "services/node-ts/tsconfig.json": "{}\n",
      "services/node-ts/src/server.js": "console.log('runtime');\n",
      "services/java/pom.xml": "<project><artifactId>service</artifactId><packaging>jar</packaging></project>\n",
      "services/java/src/main/java/App.java": "package app; class App {}\n",
      "services/java/db/migrations/001.sql": "CREATE TABLE users (id INTEGER);\n",
      "services/go/go.mod": goModule,
      "services/go/db/migrations/001.sql": "CREATE TABLE go_users (id INTEGER);\n",
      "services/php/composer.json": phpPackage,
      "services/php/db/migrations/001.sql": "CREATE TABLE php_users (id INTEGER);\n",
      "services/php/ext/CMakeLists.txt": "project(extension LANGUAGES C)\n",
      "services/php/ext/extension.c": "int extension_entry(void) { return 0; }\n",
      "services/swift/Package.swift": swiftPackage,
      "services/swift/Sources/App/main.swift": "import Foundation\nstruct App {}\n",
      "services/swift/Sources/C/main.c": "int c_entry(void) { return 0; }\n",
      "services/swift/Sources/Cpp/main.cpp": "int cpp_entry() { return 0; }\n",
    });

    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["c", "cpp", "go", "java", "nodejs", "php", "sql", "swift", "typescript"]);
    assert.equal(evidence.schemaVersion, 1);
    assert.deepEqual(
      evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.slice(0, 11),
      ["nodejs", "c", "cpp", "java", "go", "typescript", "php", "swift", "sql", "clean", "test"],
    );

    const javaSql = await detectProjectEvidence(target, { claims: ["services/java/db/migrations/001.sql"] });
    assert.deepEqual(javaSql.frameworks, ["java", "sql"]);
    const phpSql = await detectProjectEvidence(target, { claims: ["services/php/db/migrations/001.sql"] });
    assert.deepEqual(phpSql.frameworks, ["php", "sql"]);
    const native = await detectProjectEvidence(target, { claims: ["native/src/main.cpp"] });
    assert.deepEqual(native.frameworks, ["c", "cpp"]);
  });
});

test("new language roots remain boundaries around a Node.js parent", async () => {
  await temporaryProject("forgeloop-language-boundaries-", async (target) => {
    await writeFiles(target, {
      "package.json": nodePackage,
      "src/server.js": "console.log('parent runtime');\n",
      "services/go/go.mod": goModule,
      "services/go/main.go": "package main\nfunc main() {}\n",
      "services/java/pom.xml": "<project><artifactId>java-service</artifactId><packaging>jar</packaging></project>\n",
      "services/java/src/main/java/App.java": "class App {}\n",
      "services/php/composer.json": phpPackage,
      "services/php/src/index.php": "<?php echo 'ok';\n",
      "services/swift/Package.swift": swiftPackage,
      "services/swift/Sources/App/main.swift": "struct App {}\n",
      "services/native/CMakeLists.txt": "project(native LANGUAGES C)\n",
      "services/native/main.c": "int main(void) { return 0; }\n",
      "services/ts/tsconfig.json": "{}\n",
      "services/ts/src/index.ts": "export const value = 1;\n",
      "vendor/generated.go": "package generated\n",
    });

    const parent = await detectProjectEvidence(target, { claims: ["src/server.js"] });
    assert.deepEqual(parent.frameworks, ["nodejs"]);
    assert.deepEqual(parent.projectRoots, ["."]);

    const go = await detectProjectEvidence(target, { claims: ["services/go/go.mod"] });
    assert.deepEqual(go.frameworks, ["go"]);
    const java = await detectProjectEvidence(target, { claims: ["services/java/src/main/java/App.java"] });
    assert.deepEqual(java.frameworks, ["java"]);
    const php = await detectProjectEvidence(target, { claims: ["services/php/src/index.php"] });
    assert.deepEqual(php.frameworks, ["php"]);
    const swift = await detectProjectEvidence(target, { claims: ["services/swift/Sources/App/main.swift"] });
    assert.deepEqual(swift.frameworks, ["swift"]);
    const native = await detectProjectEvidence(target, { claims: ["services/native/main.c"] });
    assert.deepEqual(native.frameworks, ["c"]);
    const typescript = await detectProjectEvidence(target, { claims: ["services/ts/tsconfig.json"] });
    assert.deepEqual(typescript.frameworks, ["typescript"]);
  });
});
