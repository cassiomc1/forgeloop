import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { buildCanonicalDiagnosisProject } from './helpers/canonical-diagnosis-fixture.js';
import { executeForgeLoopCommand } from '../src/core/command-runtime.js';
import { readWorkState } from '../src/core/work-state.js';
import { validateEventLedger, validateStateLedgerCoherence } from '../src/core/events.js';
const requirement='The deterministic fixture check passes';
async function fixture(run) {
 const ctx=await buildCanonicalDiagnosisProject({git:true});
 const invoke=(command,input={})=>executeForgeLoopCommand({command,projectPath:ctx.target,input:{taskId:ctx.taskId,...input}});
 try {
  const d=await invoke('record-diagnosis',{hypothesis:'Correction must retain its diagnosis after a Git commit',failureClass:'VERIFICATION_FAILURE',evidenceRefs:['check-auth-boundary'],settledBy:'pending-evidence',nextSafeAction:'Verify the corrected fixture'});assert.equal(d.ok,true,JSON.stringify(d));
  assert.equal((await invoke('advance',{to:'CORRECTING'})).ok,true);
  const before=await readWorkState(ctx.target,ctx);
  execFileSync('git',['-C',ctx.target,'commit','--allow-empty','-qm','record correction'],{stdio:'ignore'});
  const next=await invoke('next');assert.equal(next.ok,true,JSON.stringify(next));assert.equal(next.result.nextAction,'RECONCILE_CLOSURE');
  await run({ctx,invoke,before});
 } finally { await ctx.cleanup(); }
}
test('public recommended reconciliation retains a diagnosed CORRECTING task and permits canonical verification',async()=>fixture(async({ctx,invoke,before})=>{
 const result=await invoke('reconcile-closure',{checkId:'fixture-verification',checkRequirement:requirement,commandArgv:[process.execPath,'-e','process.exit(0)']});assert.equal(result.ok,true,JSON.stringify(result));
 const state=await readWorkState(ctx.target,ctx);assert.equal(state.phase,'CORRECTING');assert.deepEqual(state.diagnosedHypothesis,before.diagnosedHypothesis);assert.equal(state.verificationCycle,before.verificationCycle);assert.notDeepEqual(state.repositoryFingerprint,before.repositoryFingerprint);
 const ledger=await validateEventLedger(ctx.target,ctx.packageRoot,{taskId:ctx.taskId});assert.equal(ledger.valid,true);assert.deepEqual(validateStateLedgerCoherence(state,ledger.events),[]);assert.equal(ledger.events.filter(e=>e.event==='CHECKPOINT_RECONCILED').length,1);
 const advance=await invoke('advance',{to:'VERIFYING'});assert.equal(advance.ok,true,JSON.stringify(advance));assert.equal(advance.result.verificationCycle,before.verificationCycle+1);
}));
for(const [name,input,code] of [
 ['failed command',{commandArgv:[process.execPath,'-e','process.exit(1)']},'E_RECONCILE_EVIDENCE_FAILED'],
 ['unbound requirement',{checkRequirement:'Unbound requirement'},'E_RECONCILE_REQUIREMENT_UNKNOWN'],
]) test(`public correction reconciliation refuses ${name} without rebinding`,async()=>fixture(async({ctx,invoke,before})=>{
 const result=await invoke('reconcile-closure',{checkId:'fixture-verification',checkRequirement:requirement,commandArgv:[process.execPath,'-e','process.exit(0)'],...input});assert.equal(result.ok,false);assert.equal(result.error.code,code,JSON.stringify(result));
 const state=await readWorkState(ctx.target,ctx);assert.deepEqual(state.repositoryFingerprint,before.repositoryFingerprint);assert.equal(state.phase,'CORRECTING');assert.deepEqual(state.diagnosedHypothesis,before.diagnosedHypothesis);
 const ledger=await validateEventLedger(ctx.target,ctx.packageRoot,{taskId:ctx.taskId});assert.equal(ledger.valid,true);assert.equal(ledger.events.some(e=>e.event==='CHECKPOINT_RECONCILED'),false);
}));
