import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import { parseBazelJava, parseGradleBuild, parseMavenPom } from "../src/core/java-project.js";
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
  assert.equal(parseGradleBuild("// plugins { id 'java-platform' }\n").valid, false);
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
