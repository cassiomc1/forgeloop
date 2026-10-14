import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const prefix = path.resolve(process.argv[2]);
const root = path.resolve(process.argv[3]);
mkdirSync(root, { recursive: true });
const cli = path.join(prefix, 'node_modules/@cassiomc1/forgeloop/src/cli.js');
const project = path.join(root, 'fresh-project');
mkdirSync(project, { recursive: true });
const report = { platform: os.platform(), arch: os.arch(), node: process.version, package: JSON.parse(readFileSync(path.join(prefix,'node_modules/@cassiomc1/forgeloop/package.json'))).version, checks: [], commands: [] };
function run(args, { target = project, allowFailure = false } = {}) {
  const r = spawnSync(process.execPath, [cli, args[0], '--path', target, ...args.slice(1)], { encoding: 'utf8', timeout: 180000, env: process.env });
  report.commands.push({ args, target, exitCode: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message });
  if (!allowFailure) assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr || r.stdout}`);
  let json;
  try { json = JSON.parse(r.stdout); } catch {}
  return { ...r, json };
}
async function check(name, fn) {
  try { const details = await fn(); report.checks.push({ name, status: 'PASS', details }); }
  catch (e) { report.checks.push({ name, status: 'FAIL', error: e.message }); }
  writeFileSync(path.join(root,'report.json'), JSON.stringify(report,null,2));
}
await check('published-version', () => { assert.equal(report.package,'2.0.0-rc.2'); run(['--version']); run(['protocol-info','--json']); });
await check('live-jev-health', () => { assert.equal(run(['decision-status','--health','--json']).json.health.status,'healthy'); });
await check('fresh-git-init', () => {
  const r = spawnSync('git',['init',project],{encoding:'utf8'}); assert.equal(r.status,0);
  run(['init']); assert.ok(existsSync(path.join(project,'AGENTS.md')));
  assert.ok(existsSync(path.join(project,'.forgeloop/state.sqlite')));
});
await check('empty-task-list', () => { assert.equal(run(['task-list','--json']).json.total,0); });
await check('create-and-reopen', () => {
  run(['task-create','--task','user-task','--claim','output','--json']);
  const tasks=run(['task-list','--json']).json;
  assert.equal(tasks.total,1); assert.equal(tasks.tasks[0].taskId,'user-task');
  run(['task-show','--task','user-task','--json']);
});
await check('claim-conflict-refused', () => {
  const r=run(['task-create','--task','overlap','--claim','output/nested','--json'],{allowFailure:true});
  assert.notEqual(r.status,0); assert.match(r.stdout+r.stderr,/CLAIM|OVERLAP|CONFLICT/);
  assert.equal(run(['task-list','--json']).json.total,1);
});
await check('discovery-contract-route-preflight', () => {
  run(['discover','--task','user-task','--json']);
  const contract={schemaVersion:1,protocolVersion:1,taskId:'user-task',objective:'Validate a clean npm installation and durable SQLite task lifecycle',deliverables:['output/result.txt'],constraints:['No changes to installed package'],risks:[],assumptions:[],verification:[{id:'sqlite-proof',text:'The output and SQLite integrity checks pass.',type:'VERIFICATION'}],successCriteria:[{id:'output-created',text:'The requested output file exists with the expected content.',type:'PRODUCT'}],stopConditions:[],unresolvedDecisions:[],sourceRefs:[]};
  writeFileSync(path.join(project,'contract-input.json'),JSON.stringify(contract,null,2));
  run(['contract-create','--task','user-task','--contract-file','contract-input.json','--json']);
  run(['route','--task','user-task','--work','test-only','--surface','database','--platform','cross-platform','--json']);
  assert.equal(run(['preflight','--task','user-task','--json']).json.status,'READY');
  run(['advance','--task','user-task','--to','PLANNED']);
  run(['advance','--task','user-task','--to','EXECUTING']);
  mkdirSync(path.join(project,'output')); writeFileSync(path.join(project,'output/result.txt'),'SQLite persisted successfully\n');
  const next=run(['next','--task','user-task','--json']).json;
  assert.equal(next.currentPhase,'EXECUTING');
});
await check('concurrent-distinct-task-writes', async () => {
  const outcomes=await Promise.all(Array.from({length:8},(_,i)=>new Promise(resolve=>{
    const args=['task-create','--task',`parallel-${i}`,'--claim',`parallel/${i}`,'--json','--path',project];
    const child=spawn(process.execPath,[cli,...args],{env:process.env});
    let stdout='',stderr=''; child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
    child.on('close',code=>resolve({code,stdout,stderr}));child.on('error',e=>resolve({error:e.message}));
  })));
  report.concurrency=outcomes; assert.ok(outcomes.every(r=>r.code===0),JSON.stringify(outcomes));
  assert.equal(run(['task-list','--json']).json.total,9);
});
await check('sqlite-integrity-foreign-keys-and-authority', () => {
  const db=new DatabaseSync(path.join(project,'.forgeloop/state.sqlite'),{readOnly:true});
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
    assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n,9);
    assert.ok(db.prepare('SELECT count(*) AS n FROM events').get().n>10);
    return { tasks:9, events:db.prepare('SELECT count(*) AS n FROM events').get().n, files:readdirSync(path.join(project,'.forgeloop')) };
  } finally { db.close(); }
});
await check('database-backup-and-no-overwrite', () => {
  run(['storage-backup','--destination','backup.sqlite','--json']);
  const db=new DatabaseSync(path.join(project,'backup.sqlite'),{readOnly:true});
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n,9); } finally {db.close();}
  const before=readFileSync(path.join(project,'backup.sqlite'));
  assert.notEqual(run(['storage-backup','--destination','backup.sqlite','--json'],{allowFailure:true}).status,0);
  assert.deepEqual(readFileSync(path.join(project,'backup.sqlite')),before);
});
await check('doctor-storage-health', () => {
  const r=run(['doctor','--json'],{allowFailure:true});
  assert.equal(r.json.storage.backend,'sqlite');assert.equal(r.json.storage.integrity.ok,true);
  return {exitCode:r.status,storage:r.json.storage,findings:r.json.findings};
});
await check('mixed-legacy-writes-fail-closed', () => {
  const target=path.join(root,'mixed');mkdirSync(path.join(target,'.forgeloop/task-state'),{recursive:true});
  cpSync(path.join(project,'backup.sqlite'),path.join(target,'.forgeloop/state.sqlite'));
  const r=run(['task-create','--task','must-refuse','--json'],{target,allowFailure:true});
  assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/E_STORAGE_MIGRATION_REQUIRED/);
});
await check('tampered-ledger-detected', () => {
  const target=path.join(root,'tampered');mkdirSync(path.join(target,'.forgeloop'),{recursive:true});
  cpSync(path.join(project,'backup.sqlite'),path.join(target,'.forgeloop/state.sqlite'));
  const db=new DatabaseSync(path.join(target,'.forgeloop/state.sqlite'));
  db.exec("UPDATE events SET event_type='TAMPERED' WHERE seq=1");db.close();
  const r=run(['doctor','--json'],{target,allowFailure:true});assert.equal(r.json.storage.integrity.ok,false);
});
await check('verification-review-and-completion', () => {
  run(['advance','--task','user-task','--to','VERIFYING']);
  run(['prepare-completion','--task','user-task','--json']);
  const proof="const fs=require('node:fs');const assert=require('node:assert/strict');assert.equal(fs.readFileSync('output/result.txt','utf8'),'SQLite persisted successfully\\n');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('.forgeloop/state.sqlite',{readOnly:true});assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();";
  run(['run-check','--task','user-task','--id','sqlite-proof','--requirement','sqlite-proof','--',process.execPath,'-e',proof]);
  run(['run-check','--task','user-task','--id','output-created','--requirement','output-created','--',process.execPath,'-e',proof]);
  run(['advance','--task','user-task','--to','REVIEWING']);
  run(['audit','--task','user-task','--json']);
  assert.equal(run(['complete','--task','user-task','--json']).json.status,'VALID');
  assert.equal(run(['next','--task','user-task','--json']).json.terminal,true);
});
run(['index-stop','--json'],{allowFailure:true});
report.status=report.checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({platform:report.platform,node:report.node,package:report.package,status:report.status,checks:report.checks},null,2));
if(report.status!=='PASS') process.exitCode=1;
