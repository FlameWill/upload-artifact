// actions/upload-artifact/src/stage.mjs — `node dist/stage.mjs <staging dir>` on a FlameWill runner (action.yml): finds the files with
// actions/upload-artifact's own search (vendor/search.ts, its src/shared/search.ts at v7.0.2, the latest, unchanged and the same file as v4's: the same @actions/glob options,
// the same least common ancestor of several paths, the same single-file rule) and copies each into the staging directory at its path relative to the artifact's root, so
// fw-artifact, run in that directory on ".", keeps the same archive layout GitHub's upload keeps. Symlinks are followed (upstream's
// followSymbolicLinks): the staged files are real files. Reads the action's inputs from the environment the composite step gives it.
// Writes to $GITHUB_OUTPUT: files (the count). Exit 0 with the files staged; 3 with none found, saying nothing: the action then hands the
// upload to actions/upload-artifact itself, which finds nothing the same way and warns, ignores or fails as if-no-files-found says. Any
// other exit (an error) also hands the upload to GitHub's action.
import { findFilesToUpload } from '../vendor/search.ts';
import { copyFile, link, mkdir, appendFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';

const staging = process.argv[2];
if (!staging) {
  process.stderr.write('usage: stage.mjs <staging directory>\n');
  process.exit(2);
}
const searchPath = process.env.INPUT_PATH ?? '';
const includeHidden = (process.env.INPUT_INCLUDE_HIDDEN_FILES ?? 'false').toLowerCase() === 'true';
const name = process.env.INPUT_NAME ?? 'artifact';
const output = async (k, v) => {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
};

const { filesToUpload, rootDirectory } = await findFilesToUpload(searchPath, includeHidden);
if (filesToUpload.length === 0) {
  await output('files', 0);
  process.exit(3);
}
// every folder made once, then the files linked 64 at a time (an upload of thousands of small files is syscalls, not bytes)
const places = filesToUpload.map((file) => {
  const rel = path.relative(rootDirectory, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${file} is outside the artifact's root ${rootDirectory}`);
  return { file, to: path.join(staging, rel) };
});
for (const dir of new Set(places.map((p) => path.dirname(p.to)))) await mkdir(dir, { recursive: true });
// a hard link to the file's real path when the staging directory is on the same disk (no copy; a link to a symlink would keep the
// symlink, and fw-artifact's zip -y would store it as one: upstream follows symlinks), else a copy (copyFile follows them)
const place = async ({ file, to }) => {
  const real = await realpath(file);
  await link(real, to).catch(() => copyFile(real, to));
};
for (let i = 0; i < places.length; i += 64) await Promise.all(places.slice(i, i + 64).map(place));
const n = places.length;
process.stdout.write(`With the provided path, there will be ${n} file(s) uploaded as ${name} (root ${rootDirectory})\n`);
await output('files', n);
