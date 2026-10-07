import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {ensureFixtureTask} from './helpers/native-storage-fixture.js';
import {removeTempTree} from './helpers/rm-safe.js';
import {getPackageRoot} from '../src/core/templates.js';
import {createContract,writeContract} from '../src/core/contract.js';
import {appendProtocolEvent} from '../src/core/events.js';
import {recordDecisionCriterion} from '../src/core/settlement.js';
import {clearSchemaCache} from '../src/core/schema-validation.js';
import {openStorageDatabase,runInTransaction,putArtifact} from '../src/storage/index.js';
test('decision criterion rejects independently changed contract',async()=>{
 const target=await fs.promises.mkdtemp(path.join(os.tmpdir(),'settlement800-'));const taskId='settlement800',packageRoot=getPackageRoot();let db;const read=fs.promises.readFile;let independent=false;let independentRows;
 const rows=()=>({tasks:db.prepare("SELECT * FROM tasks WHERE task_id = ?").all(taskId),artifacts:db.prepare("SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY kind,artifact_id").all(taskId),events:db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").all(taskId)});
 try{
  await ensureFixtureTask(target,taskId,packageRoot);
  const contract=createContract({taskId,objective:'Test settlement freshness',deliverables:['src/auth.js'],verification:['tests'],successCriteria:['tests pass'],unresolvedDecisions:['Choose provider?']});
  await writeContract(target,contract,packageRoot,{taskId});
  await appendProtocolEvent(target,{taskId,event:'TASK_RECEIVED'},packageRoot,{taskId});
  await appendProtocolEvent(target,{taskId,event:'CONTRACT_VALIDATED'},packageRoot,{taskId});
  db=openStorageDatabase(path.join(target,'.forgeloop/state.sqlite'));clearSchemaCache();
  fs.promises.readFile=async(filename,...args)=>{if(String(filename).endsWith('event.schema.json')&&!independent){runInTransaction(db,()=>putArtifact(db,{taskId,kind:'contract',payload:{...contract,unresolvedDecisions:[]}}));independent=true;independentRows=rows();}return read(filename,...args);};syncBuiltinESMExports();
  let result,error;try{result=await recordDecisionCriterion({target,packageRoot,taskId,decision:'Choose provider?',settledBy:'Existing middleware compatibility'});}catch(e){error=e;}
  assert.equal(independent,true);assert.equal(result,undefined);assert.equal(error?.code,'E_STATE_REVISION_CONFLICT');assert.deepEqual(rows(),independentRows);
  await assert.rejects(recordDecisionCriterion({target,packageRoot,taskId,decision:'Choose provider?',settledBy:'Retry after contract change'}),{code:'E_DECISION_NOT_UNRESOLVED'});assert.deepEqual(rows(),independentRows);
 }finally{fs.promises.readFile=read;syncBuiltinESMExports();clearSchemaCache();db?.close();await removeTempTree(target);}
});
