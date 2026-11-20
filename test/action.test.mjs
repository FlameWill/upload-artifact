// actions/upload-artifact/test/action.test.mjs — FlameWill/upload-artifact and FlameWill/download-artifact (HANDOVER D252), run for real:
// the built dist/stage.mjs on fixture trees (the archive layout actions/upload-artifact keeps: one folder, several paths and their least
// common ancestor, a single file, ! excludes, hidden files, symlinks followed, nothing found), and each action's own bash step (read out of
// action.yml) with a stand-in fw-artifact on the PATH that records what it was asked to keep: who keeps the artifact and why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = new URL('..', import.meta.url).pathname;
const STAGE = join(HERE, 'dist/stage.mjs');
const work = await mkdtemp(join(tmpdir(), 'fw-upload-artifact-'));
test.after(() => rm(work, { recursive: true, force: true }));

async function tree(root, files) {
  for (const [p, text] of Object.entries(files)) {
    await mkdir(join(root, p, '..'), { recursive: true });
    await writeFile(join(root, p), text);
  }
}
async function listed(dir) {
  const out = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(d, e.name));
      else out.push(relative(dir, join(d, e.name)));
    }
  };
  await walk(dir);
  return out.sort();
}
let n = 0;
async function stage(root, path, extra = {}) {
  const to = join(work, `stage-${++n}`);
  await mkdir(to);
  const out = join(work, `out-${n}`);
  const r = spawnSync(process.execPath, [STAGE, to], { cwd: root, env: { ...process.env, INPUT_PATH: path, INPUT_NAME: 'a', GITHUB_OUTPUT: out, ...extra }, encoding: 'utf8' });
  return { status: r.status, files: await listed(to), stdout: r.stdout, staged: to };
}

test('the archive layout is actions/upload-artifact\'s: one folder, several paths (their common ancestor), a single file, excludes, hidden files', async () => {
  const root = join(work, 'repo');
  await tree(root, { 'dist/app.js': 'a', 'dist/css/site.css': 'c', 'dist/.cache/x': 'h', 'reports/junit/r.xml': 'j', 'reports/cov/c.json': 'v', 'logs/one.log': 'l' });
  assert.deepEqual((await stage(root, 'dist')).files, ['app.js', 'css/site.css'], 'a folder: its contents, hidden ones left out');
  assert.deepEqual((await stage(root, 'dist', { INPUT_INCLUDE_HIDDEN_FILES: 'true' })).files, ['.cache/x', 'app.js', 'css/site.css'], 'include-hidden-files');
  assert.deepEqual((await stage(root, 'reports/junit\nreports/cov')).files, ['cov/c.json', 'junit/r.xml'], 'two paths: relative to reports/, their common ancestor');
  assert.deepEqual((await stage(root, 'logs/one.log')).files, ['one.log'], 'a single file: at the archive root');
  assert.deepEqual((await stage(root, 'dist\n!dist/css')).files, ['app.js'], '! excludes');
  assert.deepEqual((await stage(root, 'dist/**/*.css')).files, ['css/site.css'], 'a wildcard: relative to the folder before it');
});

test('a symlink is followed: the archive holds the file it points to, as upstream does', async () => {
  const root = join(work, 'links');
  await tree(root, { 'real/data.txt': 'payload' });
  await mkdir(join(root, 'out'));
  await symlink(join(root, 'real/data.txt'), join(root, 'out/data.txt'));
  const s = await stage(root, 'out');
  assert.deepEqual(s.files, ['data.txt']);
  assert.equal(await readFile(join(s.staged, 'data.txt'), 'utf8'), 'payload');
});

test('nothing found: exit 3 and nothing said, whatever if-no-files-found says (GitHub\'s action then reports it as upstream does)', async () => {
  const root = join(work, 'empty');
  await mkdir(root);
  for (const ifNone of ['warn', 'ignore', 'error']) {
    const s = await stage(root, 'nothing-here', { INPUT_IF_NO_FILES_FOUND: ifNone });
    assert.equal(s.status, 3, ifNone);
    // @actions/glob's ::debug:: lines show only when the run's debug logging is on, as in upstream
    assert.deepEqual(s.stdout.split('\n').filter((l) => l && !l.startsWith('::debug::')), [], ifNone);
  }
});

// each action's FlameWill step, as the runner runs it (bash, the env the step names), with a stand-in fw-artifact
const stepOf = async (action) => {
  const text = await readFile(join(HERE, '..', action, 'action.yml'), 'utf8');
  const start = text.indexOf('      run: |\n') + '      run: |\n'.length;
  const end = text.indexOf('\n\n    - name:', start);
  return text.slice(start, end).split('\n').map((l) => l.replace(/^ {8}/, '')).join('\n');
};
async function runStep(action, env, { fw = 'ok', stage: bundle = 'ok' } = {}) {
  const bin = join(work, `bin-${++n}`);
  await mkdir(bin);
  let actionPath = join(HERE, '..', action);
  if (bundle === 'broken') {
    actionPath = join(work, `broken-${n}`);
    await mkdir(join(actionPath, 'dist'), { recursive: true });
    await writeFile(join(actionPath, 'dist/stage.mjs'), "throw new Error('a broken bundle');\n");
  }
  const log = join(work, `fw-${n}.log`);
  if (fw) {
    await writeFile(join(bin, 'fw-artifact'), `#!/usr/bin/env bash\necho "$PWD|$*" >> ${log}\n[ "${fw}" = ok ] || { echo "fw-artifact: not kept (stand-in)"; exit 1; }\n`);
    await chmod(join(bin, 'fw-artifact'), 0o755);
  }
  const out = join(work, `out-${n}`);
  await writeFile(out, '');
  const cwd = join(work, 'repo');
  const r = spawnSync('bash', ['-c', await stepOf(action)], {
    cwd, encoding: 'utf8',
    env: { PATH: `${bin}:${join(process.execPath, '..')}:/usr/bin:/bin`, HOME: work, GITHUB_OUTPUT: out, GITHUB_ACTION_PATH: actionPath, GITHUB_REPOSITORY: 'Acme/web', GITHUB_RUN_ID: '42', RUNNER_TEMP: work, ...env },
  });
  const outputs = Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const calls = await readFile(log, 'utf8').catch(() => '');
  return { status: r.status, stdout: r.stdout, outputs, calls };
}
const UP = { INPUT_NAME: 'report', INPUT_PATH: 'dist', INPUT_IF_NO_FILES_FOUND: 'warn', INPUT_INCLUDE_HIDDEN_FILES: 'false', INPUT_OVERWRITE: 'false', INPUT_RETENTION_DAYS: '0', INPUT_ARCHIVE: 'true' };

test('upload on a FlameWill runner: FlameWill keeps it, from the staged tree, and the dashboard link is the URL', async () => {
  const r = await runStep('upload-artifact', UP);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.outputs.kept, 'true');
  assert.match(r.outputs.url, /^https:\/\/flamewill\.com\/dashboard\/artifacts\/\?org=Acme&repository=Acme\/web&run_id=42$/);
  assert.match(r.calls, /\|upload report \.$/m, 'fw-artifact upload <name> . in the staging directory');
});

test('upload goes to GitHub, saying why: not a FlameWill runner, overwrite, a name FlameWill does not keep, FlameWill could not keep it', async () => {
  for (const [why, env, opts] of [
    ['not a FlameWill runner', UP, { fw: null }],
    ['overwrite is true', { ...UP, INPUT_OVERWRITE: 'true' }, {}],
    ['the name has characters', { ...UP, INPUT_NAME: 'test results' }, {}],
    ['archive is false', { ...UP, INPUT_ARCHIVE: 'false' }, {}],
    ['FlameWill could not keep it', UP, { fw: 'fail' }],
  ]) {
    const r = await runStep('upload-artifact', env, opts);
    assert.equal(r.status, 0, `${why}: ${r.stdout}`);
    assert.equal(r.outputs.kept, 'false', why);
    assert.match(r.stdout, new RegExp(why), why);
  }
});

test('upload with no files found, or files that cannot be staged: GitHub\'s action takes it, fw-artifact never asked', async () => {
  const r = await runStep('upload-artifact', { ...UP, INPUT_PATH: 'missing' });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.outputs.kept, 'false');
  assert.match(r.stdout, /no files were found/);
  assert.equal(r.calls, '', 'fw-artifact never asked');
  const broken = await runStep('upload-artifact', UP, { stage: 'broken' });
  assert.equal(broken.outputs.kept, 'false');
  assert.match(broken.stdout, /could not be staged/);
  assert.equal(broken.calls, '');
});

const DOWN = { INPUT_NAME: 'report', INPUT_PATH: join(work, 'got'), INPUT_PATTERN: '', INPUT_REPOSITORY: 'Acme/web', INPUT_RUN_ID: '42', INPUT_ARTIFACT_IDS: '', INPUT_SKIP_DECOMPRESS: 'false' };
test('download on a FlameWill runner reads the named artifact of this run; GitHub for all, a pattern, another repository or run, or a name FlameWill does not keep', async () => {
  const r = await runStep('download-artifact', DOWN);
  assert.equal(r.outputs.read, 'true', r.stdout);
  assert.match(r.calls, /\|download report /);
  for (const [why, env, opts] of [
    ['not a FlameWill runner', DOWN, { fw: null }],
    ['no name', { ...DOWN, INPUT_NAME: '' }, {}],
    ['artifact ids', { ...DOWN, INPUT_NAME: '', INPUT_ARTIFACT_IDS: '17,18' }, {}],
    ['skip-decompress is true', { ...DOWN, INPUT_SKIP_DECOMPRESS: 'true' }, {}],
    ['another repository', { ...DOWN, INPUT_REPOSITORY: 'Acme/other' }, {}],
    ['another run', { ...DOWN, INPUT_RUN_ID: '7' }, {}],
    ['does not keep report', DOWN, { fw: 'fail' }],
  ]) {
    const g = await runStep('download-artifact', env, opts);
    assert.equal(g.outputs.read, 'false', why);
    assert.match(g.stdout, new RegExp(why), why);
  }
});
