import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2] || 'dist';
if (!existsSync(root)) throw new Error(`Package root not found: ${root}`);
const forbidden = /(^|\/)(playwright|vitest|typescript|eslint|tests|\.git)(\/|$)/;
const violations = [];
function walk(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, entry.name); const normalized = p.replaceAll('\\', '/'); if (forbidden.test(normalized) || (root !== 'dist' && normalized.endsWith('.map'))) violations.push(p); if (entry.isDirectory()) walk(p); } }
walk(root);
if (violations.length) throw new Error(`Forbidden packaged contents:\n${violations.join('\n')}`);
console.log(`Package contents verified: ${root}`);
