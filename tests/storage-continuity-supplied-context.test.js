import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { buildCanonicalDiagnosisProject } from './helpers/canonical-diagnosis-fixture.js';
import { writeContinuity, readContinuity } from '../src/core/continuity.js';
import { reconcileContinuity } from '../src/core/continuity-reconciliation.js';
import { readWorkState } from '../src/core/work-state.js';
import { readContract } from '../src/core/contract.js';
import { canonicalFingerprint } from '../src/core/artifacts.js';
import { currentRepositoryFingerprint } from '../src/core/repository.js';
import { openStorageDatabase } from '../src/storage/index.js';
function tables(db){return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,rows:db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()}));}
for(const kind of ['state','contract','foreign-task']){
 test(`supplied continuity ${kind} context cannot replace canonical authority`, async()=>{
  const context=await buildCanonicalDiagnosisProject({taskId:`continuity-supplied-${kind}`,git:true});
  const {target,packageRoot,taskId}=context;
  const db=openStorageDatabase(path.join(target,'.forgeloop/state.sqlite'));
  try{
   const state=await readWorkState(target,{packageRoot,taskId});
   const contract=await readContract(target,packageRoot,{taskId});
   const repositoryFingerprint=await currentRepositoryFingerprint(target);
   let suppliedState=state;let suppliedContract=contract;
   if(kind==='state')suppliedState={...state,phase:'COMPLETE'};
   if(kind==='contract'){
    const value={...contract.value,objective:'Caller-supplied replacement contract'};
    const fingerprint=canonicalFingerprint(value);
    suppliedContract={value,fingerprint};suppliedState={...state,contractFingerprint:fingerprint};
   }
   if(kind==='foreign-task')suppliedState={...state,taskId:'outside-selected-task'};
   const before=tables(db);
   const write=()=>writeContinuity(target,{remainingWork:[],knownIssues:[],changedAreas:[],inspectFirst:[]},{packageRoot,taskId,state:suppliedState,contract:suppliedContract,repositoryFingerprint});
   if(kind==='foreign-task'){
    await assert.rejects(write,{code:'E_TASK_CONTEXT_MISMATCH'});
    assert.deepEqual(tables(db),before);
   }else{
    await write();
    const stored=await readContinuity(target,{packageRoot,taskId});
    assert.equal(stored.value.taskId,taskId);
    const result=await reconcileContinuity({target,packageRoot,taskId});
    assert.notEqual(result.classification,'FRESH');
    assert.equal(result.taskMatches,true);
    assert.equal(result.workStateMatches,false);
    if(kind==='state')assert.equal(result.phaseMatches,false);
    else assert.equal(result.contractMatches,false);
    const after=tables(db);
    const previousArtifacts=before.find(t=>t.name==='task_artifacts').rows;
    const currentArtifacts=after.find(t=>t.name==='task_artifacts').rows;
    assert.deepEqual(currentArtifacts.filter(row=>row.kind!=='continuity'),previousArtifacts);
    assert.equal(currentArtifacts.filter(row=>row.kind==='continuity').length,1);
    const previousEvents=before.find(t=>t.name==='events').rows;
    const currentEvents=after.find(t=>t.name==='events').rows;
    assert.deepEqual(currentEvents.slice(0,previousEvents.length),previousEvents);
    assert.ok(currentEvents.slice(previousEvents.length).every(row=>row.event_type==='TRANSACTION_COMMITTED'));
    for(const table of before.filter(t=>!['task_artifacts','events'].includes(t.name))){
     assert.deepEqual(tables(db).find(t=>t.name===table.name),table);
    }
   }
   assert.deepEqual(await readWorkState(target,{packageRoot,taskId}),state);
   assert.deepEqual((await readContract(target,packageRoot,{taskId})).value,contract.value);
  }finally{db.close();await context.cleanup();}
 });
}
