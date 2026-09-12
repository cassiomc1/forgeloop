import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import { looksLikeSql } from "../src/core/sql-project.js";
import { evaluateRoute } from "../src/core/router.js";
import { temporaryProject, writeFiles } from "./helpers/multi-language-project.js";

test("SQL recognizer masks comments and quoted text and requires a statement shape", () => {
  assert.equal(looksLikeSql("-- SELECT * FROM fake\nCREATE TABLE users (id INTEGER);"), true);
  assert.equal(looksLikeSql("const prose = 'SELECT * FROM fake';"), false);
  assert.equal(looksLikeSql("database schema notes"), false);
  assert.equal(looksLikeSql("/* unterminated SELECT * FROM fake"), false);
  assert.equal(looksLikeSql("Please rollback these changes after reviewing the notes."), false);
  assert.equal(looksLikeSql("$$CREATE TABLE fake (id integer)$$"), false);
  assert.equal(looksLikeSql("$tag$\nSELECT * FROM fake"), false);
  assert.equal(looksLikeSql("`CREATE TABLE fake`"), false);
  assert.equal(looksLikeSql("SELECT payload #> '{user}' FROM events;"), true);
  assert.equal(looksLikeSql("SELECT payload #>> '{user,name}' FROM events;"), true);
  assert.equal(looksLikeSql("WITH recent AS (SELECT id FROM events) SELECT * FROM recent;"), true);
  assert.equal(looksLikeSql("MERGE INTO accounts USING updates ON accounts.id = updates.id;"), true);
  assert.equal(looksLikeSql("CREATE FUNCTION refresh_cache() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;"), true);
  assert.equal(looksLikeSql("GRANT SELECT ON TABLE accounts TO analyst;"), true);
  assert.equal(looksLikeSql("-- CREATE TABLE fake (id INTEGER);\n/* SELECT * FROM fake */"), false);
});

test("SQL migrations in owned directories provide bounded overlay evidence", async () => {
  await temporaryProject("forgeloop-sql-detection-", async (target) => {
    await writeFiles(target, { "migrations/001.sql": "CREATE TABLE users (id INTEGER);\n" });
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, ["sql"]);
    const evidence = await detectProjectEvidence(target, { claims: ["migrations/001.sql"] });
    assert.deepEqual(evidence.frameworks, ["sql"]);
    assert.deepEqual(evidence.projectRoots, []);
    assert.deepEqual(evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.slice(0, 3), ["sql", "clean", "test"]);
  });
});

test("SQL composes with the selected application root", async () => {
  await temporaryProject("forgeloop-sql-composition-", async (target) => {
    await writeFiles(target, {
      "package.json": "{\"dependencies\":{\"express\":\"^5.0.0\"}}\n",
      "migrations/001.sql": "CREATE TABLE users (id INTEGER);\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["migrations/001.sql"] });
    assert.deepEqual(evidence.frameworks, ["nodejs", "sql"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
  });
});

test("SQL directory claims include meaningful migrations and SQL project manifests", async () => {
  await temporaryProject("forgeloop-sql-directory-claim-", async (target) => {
    await writeFiles(target, {
      "api/go.mod": "module example.com/api\n",
      "api/db/migrations/001.sql": "CREATE TABLE users (id INTEGER);\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["api/db/migrations"] });
    assert.deepEqual(evidence.frameworks, ["go", "sql"]);
    assert.deepEqual(evidence.projectRoots, ["api"]);
  });

  await temporaryProject("forgeloop-sql-project-claim-", async (target) => {
    await writeFiles(target, {
      "App.sqlproj": "<Project Sdk=\"Microsoft.Build.Sql/1.0.0\"><PropertyGroup><DSP>Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider</DSP></PropertyGroup></Project>\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["App.sqlproj"] });
    assert.deepEqual(evidence.frameworks, ["sql"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
  });
});
