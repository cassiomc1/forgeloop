import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import {
  parseBazelJava,
  parseGradleBuild,
  parseGradleProperties,
  parseGradleSettings,
  parseMavenPom,
} from "../src/core/java-project.js";
import { evaluateRoute } from "../src/core/router.js";
import { temporaryProject, writeFiles } from "./helpers/multi-language-project.js";

test("Java build metadata is defensive and rejects external XML entities", () => {
  assert.equal(parseMavenPom("<project><artifactId>app</artifactId></project>").valid, true);
  assert.equal(parseMavenPom("<!DOCTYPE project [<!ENTITY x SYSTEM 'file:///tmp/x'>]><project><artifactId>app</artifactId></project>").valid, false);
  assert.equal(parseMavenPom("<!-- <artifactId>fake</artifactId> --><project></project>").valid, false);
  assert.equal(parseMavenPom("<project><artifactId>app</project>").valid, false);
  assert.equal(parseMavenPom("<project><artifactId>docs</artifactId><description>maven-compiler-plugin</description></project>").javaCompiler, false);
  assert.equal(parseMavenPom("<project><broken!><artifactId>maven-compiler-plugin</artifactId></project>").valid, false);
  assert.equal(parseGradleBuild("plugins { id 'java' }\n").javaPlugin, true);
  assert.equal(parseGradleBuild("plugins { java }\n").javaPlugin, true);
  assert.equal(parseGradleBuild("plugins { id(\"java-library\") }\n").javaPlugin, true);
  assert.equal(parseGradleBuild("def example = \"id 'java'\"\n").valid, false);
  assert.equal(parseGradleBuild("plugins { id 'application' }\n").valid, true);
  assert.equal(parseGradleBuild("plugins { id 'java-gradle-plugin' }\n").javaPlugin, true);
  assert.equal(parseGradleBuild("plugins { `java-gradle-plugin` }\n").javaPlugin, true);
  assert.equal(parseGradleBuild("// plugins { id 'java-platform' }\n").valid, false);
  assert.deepEqual(parseGradleSettings("include(\"app\", ':services:api')\n"), {
    valid: true,
    javaPlugin: false,
    javaPlatform: false,
    javaCompiler: false,
    packaging: null,
    modules: [],
    includes: ["app", ":services:api"],
    gradleBuild: false,
    gradleSettings: true,
    gradleProperties: false,
  });
  assert.deepEqual(parseGradleSettings("include ':app', ':lib'\n").includes, [":app", ":lib"]);
  assert.deepEqual(parseGradleSettings("include(\"app\", // comment\n  \":lib\")\n").includes, ["app", ":lib"]);
  assert.equal(parseGradleSettings("include(projectNames)\n").valid, false);
  assert.deepEqual(parseGradleSettings("if (false) { include(\"app\") }\n").includes, []);
  assert.deepEqual(parseGradleSettings("include(\"${moduleName}\")\n").valid, false);
  assert.equal(parseGradleSettings("include(\"app\" + \"x\")\n").valid, false);
  assert.equal(parseGradleSettings("include(\"app\"\n").valid, false);
  assert.equal(parseGradleProperties("org.gradle.jvmargs=-Xmx1g\n").gradleProperties, true);
  assert.equal(parseBazelJava("# java_library(name = 'fake')\n").valid, false);
  assert.equal(parseBazelJava("example = \"java_library(name = 'fake')\"\n").valid, false);
  assert.equal(parseMavenPom("<project><properties><maven.compiler.release>21</maven.compiler.release></properties></project>").javaCompiler, true);
});

test("Maven and Gradle Java projects require structural Java evidence", async () => {
  await temporaryProject("forgeloop-java-detection-", async (target) => {
    await writeFiles(target, {
      "pom.xml": "<project><artifactId>app</artifactId><packaging>jar</packaging></project>\n",
      "src/main/java/App.java": "package app; public class App {}\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["java"]);
    assert.deepEqual(evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.slice(0, 3), ["java", "clean", "test"]);
  });

  await temporaryProject("forgeloop-java-pom-negative-", async (target) => {
    await writeFiles(target, { "pom.xml": "<project><artifactId>metadata-only</artifactId></project>\n" });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
  });

  await temporaryProject("forgeloop-java-aggregator-negative-", async (target) => {
    await writeFiles(target, {
      "pom.xml": "<project><packaging>pom</packaging><modules><module>service</module></modules></project>\n",
      "service/pom.xml": "<project><artifactId>service</artifactId></project>\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
  });

  await temporaryProject("forgeloop-java-aggregator-claim-", async (target) => {
    await writeFiles(target, {
      "pom.xml": "<project><packaging>pom</packaging><modules><module>service</module></modules></project>\n",
      "service/pom.xml": "<project><artifactId>service</artifactId></project>\n",
      "service/src/main/java/App.java": "class App {}\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["pom.xml"] });
    assert.deepEqual(evidence.frameworks, ["java"]);
    assert.ok(evidence.projectRoots.includes("service"));
  });
});

test("direct Java source claims remain usable without a build manifest", async () => {
  await temporaryProject("forgeloop-java-source-", async (target) => {
    await writeFiles(target, { "src/App.java": "package app; record App(String value) {}\n" });
    const evidence = await detectProjectEvidence(target, { claims: ["src/App.java"] });
    assert.deepEqual(evidence.frameworks, ["java"]);
  });
});

test("Bazel Java rules and compiler metadata provide Java build evidence", async () => {
  await temporaryProject("forgeloop-java-bazel-", async (target) => {
    await writeFiles(target, {
      "BUILD.bazel": "java_library(name = 'app', srcs = ['App.java'])\n",
      "App.java": "class App {}\n",
    });
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, ["java"]);
  });

  await temporaryProject("forgeloop-java-build-metadata-only-", async (target) => {
    await writeFiles(target, {
      "build.gradle": "plugins { id 'java-library' }\n",
      "BUILD.bazel": "java_library(name = 'library')\n",
    });
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, ["java"]);
  });
});

test("Gradle settings statically connect included projects and keep shared properties scoped", async () => {
  await temporaryProject("forgeloop-gradle-settings-topology-", async (target) => {
    await writeFiles(target, {
      "settings.gradle.kts": 'include("app", ":services:api")\n',
      "app/build.gradle.kts": "plugins { id(\"java\") }\n",
      "services/api/build.gradle": "plugins { id 'application' }\n",
      "docs/build.gradle.kts": "plugins { id(\"base\") }\n",
      "gradle.properties": "org.gradle.jvmargs=-Xmx1g\n",
      "tools/isolated/settings.gradle.kts": 'rootProject.name = "isolated"\ninclude(":compiler")\n',
      "tools/isolated/compiler/build.gradle.kts": "plugins { id(\"java-library\") }\n",
      "tools/isolated/gradle.properties": "org.gradle.jvmargs=-Xmx512m\n",
    });

    const unscoped = await detectProjectEvidence(target);
    assert.deepEqual(unscoped.frameworks, ["java"]);
    assert.deepEqual(unscoped.projectRoots, ["app", "services/api", "tools/isolated/compiler"]);
    assert.equal(unscoped.projectRoots.includes("docs"), false);

    const settingsClaim = await detectProjectEvidence(target, { claims: ["settings.gradle.kts"] });
    assert.deepEqual(settingsClaim.frameworks, ["java"]);
    assert.deepEqual(settingsClaim.projectRoots, ["app", "services/api"]);

    const rootPropertiesClaim = await detectProjectEvidence(target, { claims: ["gradle.properties"] });
    assert.deepEqual(rootPropertiesClaim.frameworks, ["java"]);
    assert.deepEqual(rootPropertiesClaim.projectRoots, ["app", "services/api"]);

    const isolatedPropertiesClaim = await detectProjectEvidence(target, {
      claims: ["tools/isolated/gradle.properties"],
    });
    assert.deepEqual(isolatedPropertiesClaim.frameworks, ["java"]);
    assert.deepEqual(isolatedPropertiesClaim.projectRoots, ["tools/isolated/compiler"]);
  });
});

test("gradle.properties is shared metadata rather than a standalone Java root", async () => {
  await temporaryProject("forgeloop-gradle-properties-negative-", async (target) => {
    await writeFiles(target, { "gradle.properties": "org.gradle.jvmargs=-Xmx1g\n" });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.projectRoots, []);
  });
});

test("Gradle settings do not execute dynamic includes or cross independent builds", async () => {
  await temporaryProject("forgeloop-gradle-settings-dynamic-", async (target) => {
    await writeFiles(target, {
      "settings.gradle": "include(System.getenv(\"MODULES\"))\n",
      "dynamic/build.gradle": "plugins { id 'java' }\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["settings.gradle"] });
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.projectRoots, []);
  });
});

test("comment-only Gradle files do not hide Node runtime source", async () => {
  await temporaryProject("forgeloop-gradle-auxiliary-node-", async (target) => {
    await writeFiles(target, {
      "package.json": "{}\n",
      "src/server.js": "import http from 'node:http';\n",
      "src/build.gradle": "// build helper only\n",
      "src/build.gradle.kts": "// Kotlin build helper only\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["nodejs"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
  });
});

test("conditional Gradle includes do not create Java topology", async () => {
  await temporaryProject("forgeloop-gradle-conditional-", async (target) => {
    await writeFiles(target, {
      "settings.gradle": "if (false) { include(\"app\") }\n",
      "app/build.gradle": "plugins { id 'java' }\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["settings.gradle"] });
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.projectRoots, []);
  });
});
