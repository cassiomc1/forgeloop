import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
const report = JSON.parse(result.stdout || '{}');
writeFileSync('npm-audit.json', `${JSON.stringify(report, null, 2)}\n`);
const production = report.vulnerabilities || {};
const blocking = Object.values(production).filter((item) => item.isDirect && ['high', 'critical'].includes(item.severity));
if (blocking.length) throw new Error(`Production dependency policy failed: ${blocking.length} high/critical direct findings`);
console.log('Dependency policy verified; production audit stored in npm-audit.json');
