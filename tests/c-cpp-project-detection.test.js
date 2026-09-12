import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import { parseBazelNative, parseCMake, parseMeson } from "../src/core/c-cpp-project.js";
import { evaluateRoute } from "../src/core/router.js";
import { temporaryProject, writeFiles } from "./helpers/multi-language-project.js";

test("native build recognizers require explicit or owned C/C++ evidence", () => {
  assert.deepEqual(parseCMake("project(app LANGUAGES C CXX)"), { valid: true, c: true, cpp: true, make: false });
  assert.equal(parseCMake("project(app C)").c, true);
  assert.equal(parseCMake("enable_language(CXX)").cpp, true);
  assert.deepEqual(parseCMake("PROJECT(app LANGUAGES CXX)"), { valid: true, c: false, cpp: true, make: false });
  assert.equal(parseCMake("enable_language(# fake CXX\n)").cpp, false);
  assert.deepEqual(parseMeson("project('app', 'c', 'cpp')"), { valid: true, c: true, cpp: true, make: false });
  assert.equal(parseMeson("add_languages('c')").c, true);
  assert.deepEqual(parseCMake('message("project(fake LANGUAGES CXX)")'), {
    valid: false,
    c: false,
    cpp: false,
    make: false,
  });
  assert.deepEqual(parseMeson("project('c', 'rust')"), { valid: true, c: false, cpp: false, make: false });
  assert.equal(parseBazelNative("cc_library(name = 'app')").c, false);
  assert.equal(parseBazelNative('example = "cc_library(name = \'fake\')"').valid, false);
  assert.equal(parseCMake("# project(fake LANGUAGES CXX)\n").valid, false);
  assert.equal(parseCMake("project(app)").valid, true);
});

test("CMake and Meson can compose C and C++ at one root", async () => {
  await temporaryProject("forgeloop-native-detection-", async (target) => {
    await writeFiles(target, {
      "CMakeLists.txt": "cmake_minimum_required(VERSION 3.20)\nproject(app LANGUAGES C CXX)\n",
      "src/main.c": "int main(void) { return 0; }\n",
      "src/main.cpp": "int main() { return 0; }\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["c", "cpp"]);
    assert.deepEqual(evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.slice(0, 4), ["c", "cpp", "clean", "test"]);
  });
});

test("Makefiles and headers alone remain negative, while owned implementation source confirms the stack", async () => {
  await temporaryProject("forgeloop-native-negative-", async (target) => {
    await writeFiles(target, {
      Makefile: "all:\n\tcc main.c -o app\n",
      "include/app.h": "#define APP 1\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.projectRoots, []);
  });

  await temporaryProject("forgeloop-make-source-positive-", async (target) => {
    await writeFiles(target, {
      Makefile: "all:\n\tcc main.c -o app\n",
      "main.c": "int main(void) { return 0; }\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["c"]);
  });
});

test("default native build context needs owned implementation source", async () => {
  await temporaryProject("forgeloop-native-default-language-", async (target) => {
    await writeFiles(target, {
      "CMakeLists.txt": "project(app)\n",
      "include/app.hpp": "class App {};\n",
    });
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, []);
  });

  await temporaryProject("forgeloop-native-auxiliary-boundary-", async (target) => {
    await writeFiles(target, {
      "CMakeLists.txt": "project(app)\n",
      "tools/Makefile": "all:\n\tcc main.c -o app\n",
      "tools/main.c": "int main(void) { return 0; }\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["c"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
  });

  await temporaryProject("forgeloop-meson-auxiliary-boundary-", async (target) => {
    await writeFiles(target, {
      "meson.build": "project('app', 'c')\n",
      "src/Makefile": "all:\n\tcc main.c -o app\n",
      "src/main.c": "int main(void) { return 0; }\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["c"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
  });

  await temporaryProject("forgeloop-bazel-native-language-", async (target) => {
    await writeFiles(target, {
      "BUILD": "cc_library(name = 'app', srcs = ['main.cpp'])\n",
      "main.cpp": "int main() { return 0; }\n",
    });
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, ["cpp"]);
  });
});

test("a native child with owned implementation source remains separate from a Node parent", async () => {
  await temporaryProject("forgeloop-native-nested-node-", async (target) => {
    await writeFiles(target, {
      "package.json": "{\"dependencies\":{\"express\":\"5\"}}\n",
      "native/Makefile": "all:\n\tcc main.c -o app\n",
      "native/main.c": "int main(void) { return 0; }\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["native/Makefile"] });
    assert.deepEqual(evidence.frameworks, ["c"]);
    assert.deepEqual(evidence.projectRoots, ["native"]);
  });
});

test("an auxiliary Makefile without native source does not create a child root", async () => {
  await temporaryProject("forgeloop-native-nested-node-helper-", async (target) => {
    await writeFiles(target, {
      "package.json": "{}\n",
      "src/Makefile": "all:\n\tnode server.js\n",
      "src/server.js": "console.log('server');\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.projectRoots, ["."]);
  });
});

test("direct C and C++ source claims provide distinct specialists", async () => {
  await temporaryProject("forgeloop-native-source-", async (target) => {
    await writeFiles(target, {
      "main.c": "int main(void) { return 0; }\n",
      "main.cpp": "int main() { return 0; }\n",
      "legacy.C": "int legacy() { return 0; }\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["main.c", "main.cpp", "legacy.C"] });
    assert.deepEqual(evidence.frameworks, ["c", "cpp"]);
  });
});
