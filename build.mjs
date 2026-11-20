// actions/upload-artifact/build.mjs — `pnpm --filter @flamewill/upload-artifact build`: src/stage.mjs (with actions/upload-artifact's
// own search, vendor/search.ts, checked against vendor/SHA256SUMS first, and @actions/glob and @actions/core) as one file, dist/stage.mjs, kept in git: a composite action runs what its repository holds, with Node alone.
// `--check` (make actions-artifact-check) fails when the kept file is not what the sources build.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const check = process.argv.includes('--check');
// the vendored search is upstream's file byte for byte
const vendored = createHash('sha256').update(await readFile(new URL('./vendor/search.ts', import.meta.url))).digest('hex');
const pinned = (await readFile(new URL('./vendor/SHA256SUMS', import.meta.url), 'utf8')).split(/\s+/)[0];
if (vendored !== pinned) {
  console.error(`FAIL vendor/search.ts is not actions/upload-artifact's file (sha256 ${vendored}, SHA256SUMS ${pinned})`);
  process.exit(1);
}
const out = new URL('./dist/stage.mjs', import.meta.url);
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
const result = await build({
  entryPoints: [new URL('./src/stage.mjs', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  target: 'node24',
  // smaller and quicker to load on every upload; the bundled packages' licenses are kept
  minify: true,
  format: 'esm',
  write: false,
  // the licenses of what is bundled (@actions/glob and its packages: MIT) stay in the file
  legalComments: 'inline',
  banner: { js: "import { createRequire as __fwRequire } from 'node:module'; const require = __fwRequire(import.meta.url);" },
});
const code = result.outputFiles[0].contents;
if (check) {
  const kept = await readFile(out).catch(() => Buffer.alloc(0));
  if (Buffer.compare(Buffer.from(code), kept) !== 0) {
    console.error('FAIL dist/stage.mjs is not what src/ builds: pnpm --filter @flamewill/upload-artifact build');
    process.exit(1);
  }
  console.log(`ok   dist/stage.mjs is what src/ builds (${code.length} bytes)`);
} else {
  await writeFile(out, code);
  console.log(`dist/stage.mjs ${code.length} bytes`);
}
