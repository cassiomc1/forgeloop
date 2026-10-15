import { build } from 'esbuild';

await build({
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  absWorkingDir: process.cwd(),
  entryPoints: ['src/server/cli.ts'],
  outfile: 'dist/server/cli.mjs',
  sourcemap: true,
  packages: 'bundle',
  external: ['@cassiomc1/forgeloop', 'chokidar', 'fsevents'],
});
