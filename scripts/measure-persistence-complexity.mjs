import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [baselineArgument, inventoryArgument, outputArgument] = process.argv.slice(2);
if (!baselineArgument || !inventoryArgument || !outputArgument) throw new Error('Usage: node scripts/measure-persistence-complexity.mjs <baseline-root> <scope-inventory.json> <output.json>');
const baseline=path.resolve(baselineArgument);
const inventoryBytes=await fs.readFile(path.resolve(inventoryArgument));
const inventory=JSON.parse(inventoryBytes);
const files=inventory.files ? inventory.files.filter(x=>x.included) : inventory.rows;
if (!Array.isArray(files) || files.length === 0) throw new Error('Inventory must contain included files or prior measurement rows');
const baselineRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim();
if (baselineRevision !== inventory.baselineRevision) throw new Error('Baseline revision differs from inventory');
const eslint=new ESLint({cwd:root,overrideConfigFile:true,overrideConfig:{languageOptions:{ecmaVersion:'latest',sourceType:'module'},rules:{complexity:['error',0]}}});
const rows=[];
for(const file of files) {
 if (!file.path || path.isAbsolute(file.path) || file.path.split(/[\\/]/u).includes('..')) throw new Error('Invalid inventory path');
 const row={path:file.path};
 for(const [side,dir] of [['baseline',baseline],['current',root]]) {
  let source;
  try{source=await fs.readFile(path.join(dir,file.path),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;if(file[side]?.sha256)throw new Error(`Expected inventoried source is missing: ${side}/${file.path}`);row[side]={functions:0,total:0,branches:0,maximum:0,absent:true};continue;}
  const hash=createHash('sha256').update(source).digest('hex');
  if (file[side]?.sha256 && file[side].sha256 !== hash) throw new Error(`Source hash differs from inventory: ${side}/${file.path}`);
  const [r]=await eslint.lintText(source,{filePath:path.join(root,file.path)});
  const unexpected=r.messages.filter(m=>m.ruleId!=='complexity');
  if(unexpected.length)throw Error(JSON.stringify({file:file.path,side,unexpected}));
  const scores=r.messages.map(m=>Number(m.message.match(/complexity of (\d+)/)?.[1]));
  if(scores.some(x=>!Number.isFinite(x)))throw Error('Unrecognized diagnostic');
  row[side]={sha256:hash,functions:scores.length,total:scores.reduce((a,b)=>a+b,0),branches:scores.reduce((a,b)=>a+b-1,0),maximum:Math.max(0,...scores)};
 }
 row.deltaBranches=row.current.branches-row.baseline.branches;rows.push(row);
}
const sums=side=>rows.reduce((a,r)=>({functions:a.functions+r[side].functions,total:a.total+r[side].total,branches:a.branches+r[side].branches,maximum:Math.max(a.maximum,r[side].maximum)}),{functions:0,total:0,branches:0,maximum:0});
const r={increment:884,inventorySha256:createHash('sha256').update(inventoryBytes).digest('hex'),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),baselineRevision:inventory.baselineRevision,eslintVersion:JSON.parse(await fs.readFile(path.join(root,'node_modules/eslint/package.json'),'utf8')).version,scope:'Same conservative 281-module inclusive union as persistence-loc871; not a revised acceptance scope.',method:'ESLint complexity rule, default classic variant, maximum zero to emit every function score. Total sums function complexity; branches sums score minus one. Missing modules contribute zero. Module maxima are not summed. No execution/latency inference.',baseline:sums('baseline'),current:sums('current'),rows};
await fs.writeFile(path.resolve(outputArgument),JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify({...r,rows:undefined,largestReductions:[...rows].sort((a,b)=>a.deltaBranches-b.deltaBranches).slice(0,8),largestIncreases:[...rows].sort((a,b)=>b.deltaBranches-a.deltaBranches).slice(0,8)},null,2));
