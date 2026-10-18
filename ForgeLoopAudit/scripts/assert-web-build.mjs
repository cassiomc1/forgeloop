import { existsSync, readFileSync } from 'node:fs';

const required = ['dist/renderer/index.html', 'dist/server/cli.mjs', 'schemas/provenance.json', 'vendor/cassiomc1-forgeloop-2.0.0-4ff11bb.tgz'];
const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) throw new Error(`Web build is incomplete: ${missing.join(', ')}`);

const html = readFileSync('dist/renderer/index.html', 'utf8');
if (!html.includes('<script') || !html.includes('/assets/')) throw new Error('Renderer build does not contain a Vite asset entrypoint');

const server = readFileSync('dist/server/cli.mjs', 'utf8');
if (!server.includes('ForgeLoopAudit web server listening')) throw new Error('Server build does not contain the local web entrypoint');

console.log('Web build assertions passed.');
