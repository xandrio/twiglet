import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertSameDirectory, directoryAlias, fixtureGit, repository, temp } from './helpers.js';

const project = fileURLToPath(new URL('../', import.meta.url));
function invoke(entry: string, cwd: string, args: string[] = [], env = process.env, preload?: string) {
  return spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), entry, ...args], {
    cwd, env, encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
}

async function assertLocation(output: string, expected: string): Promise<void> {
  const locations = output.split(/\r?\n/).filter((line) => line.startsWith('Location: '));
  assert.equal(locations.length, 1, `Expected exactly one Location line in:\n${output}`);
  await assertSameDirectory(locations[0]!.slice('Location: '.length), expected);
}

test('candidate checkout can be cloned and run without install, build, or node_modules', async (t) => {
  const directory = await temp(t);
  const candidate = path.join(directory, 'candidate');
  const checkout = path.join(directory, 'fresh clone é');
  await mkdir(candidate);
  // Commit only in a disposable fixture; the developer checkout and its index stay untouched.
  for (const name of ['src', 'scripts', 'test', 'dist', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'AGENTS.md', '.gitignore', '.gitattributes']) {
    await cp(path.join(project, name), path.join(candidate, name), { recursive: true });
  }
  fixtureGit(candidate, 'init', '--initial-branch=topic');
  fixtureGit(candidate, 'add', '.');
  fixtureGit(candidate, 'commit', '-m', 'Candidate checkout');
  fixtureGit(directory, 'clone', '--no-hardlinks', candidate, checkout);
  await assert.rejects(stat(path.join(checkout, 'node_modules')), { code: 'ENOENT' });
  const before = fixtureGit(checkout, 'status', '--porcelain');
  const entry = path.join(checkout, 'dist', 'twiglet.cjs');
  const other = await directoryAlias(t, await repository(t));
  const nested = path.join(other, 'nested');
  await mkdir(nested);
  const direct = invoke(entry, nested);
  assert.equal(direct.status, 0, direct.stderr);
  assert.match(direct.stdout, /Repository overview/);
  assert.match(direct.stdout, /HEAD: topic/);
  await assertLocation(direct.stdout, other);
  assert(!direct.stdout.includes('\x1b'));
  const own = invoke(entry, checkout, ['status']);
  assert.equal(own.status, 0, own.stderr);
  await assertLocation(own.stdout, checkout);
  const explicit = invoke(entry, directory, ['--repo', nested, 'status']);
  assert.equal(explicit.status, 0, explicit.stderr);
  await assertLocation(explicit.stdout, other);
  assert.match(invoke(entry, directory, ['--help']).stdout, /Usage: tl/);
  assert.equal(invoke(entry, directory, ['--version']).stdout.trim(), '0.2.0');
  const history = invoke(entry, directory, ['--repo', nested, 'log', '--limit', '1']);
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /Initial/);
  await assertLocation(history.stdout, other);
  for (const args of [['log', '--limit', '0'], ['log', '--limit', '101'], ['log', '--limit', '1.5'], ['status', '--limit', '2']]) {
    assert.equal(invoke(entry, other, args).status, 1);
  }
  // A non-commit upstream object is a real comparison failure, not a missing repository.
  const blob = fixtureGit(other, 'rev-parse', 'HEAD:tracked.txt');
  fixtureGit(other, 'config', 'remote.team.fetch', '+refs/heads/*:refs/remotes/team/*');
  fixtureGit(other, 'config', 'branch.topic.remote', 'team');
  fixtureGit(other, 'config', 'branch.topic.merge', 'refs/heads/topic');
  fixtureGit(other, 'update-ref', 'refs/remotes/team/topic', blob);
  const partial = invoke(entry, other, ['status']);
  assert.equal(partial.status, 0, partial.stderr);
  assert.match(partial.stdout, /HEAD: topic/);
  assert.match(partial.stdout, /Working tree: clean/);
  assert.match(partial.stdout, /unavailable/i);
  assert.equal(invoke(entry, directory, ['--repo']).status, 1);
  assert.equal(invoke(entry, directory, ['--unknown']).status, 1);
  assert.match(invoke(entry, directory).stderr, /not a git repository/i);
  const injected = invoke(entry, nested, [], { ...process.env, GIT_DIR: path.join(checkout, '.git'), GIT_WORK_TREE: checkout });
  assert.equal(injected.status, 0, injected.stderr);
  await assertLocation(injected.stdout, other);
  const noGit = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  noGit.PATH = directory;
  const missing = invoke(entry, other, [], noGit);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Could not start Git/);
  assert.equal(fixtureGit(checkout, 'status', '--porcelain'), before);
});

// Terminal-like streams exercise the bundled prompt library, not native OS PTYs.
test('bundled prompts refresh both views, navigate Back/Exit and restore raw mode', async (t) => {
  const directory = await temp(t);
  const entry = path.join(directory, 'twiglet.cjs');
  await cp(path.join(project, 'dist', 'twiglet.cjs'), entry);
  const repo = await repository(t);
  for (const cancel of [false, true]) {
    const preload = path.join(directory, 'terminal.cjs');
    const boot = String.raw`
const { PassThrough } = require('node:stream');
const input = new PassThrough();
input.isTTY = true;
input.isRaw = false;
input.setRawMode = (raw) => { input.isRaw = raw; return input; };
Object.defineProperty(process, 'stdin', { value: input });
Object.defineProperty(process.stdout, 'isTTY', { value: true });
process.stdout.columns = 100;
const original = process.stdout.write.bind(process.stdout);
let phase = 0;
process.stdout.write = function(chunk, ...args) {
  const text = String(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  if (phase === 0 && text.includes('Repository overview')) {
    phase = 1;
    setTimeout(() => input.write(__KEY__), 30);
  } else if (phase === 1 && text.includes('Navigation')) {
    phase = 2;
    setTimeout(() => input.write('\x1b[B\r'), 30);
  } else if (phase === 2 && text.includes('Navigation')) {
    phase = 3;
    setTimeout(() => input.write('\r'), 30);
  } else if (phase === 3 && text.includes('Twiglet')) {
    phase = 4;
    setTimeout(() => input.write('\x1b[B\r'), 30);
  } else if (phase === 4 && text.includes('Navigation')) {
    phase = 5;
    setTimeout(() => input.write('\x1b[B\r'), 30);
  } else if (phase === 5 && text.includes('Navigation')) {
    phase = 6;
    setTimeout(() => input.write('\r'), 30);
  } else if (phase === 6 && text.includes('Twiglet')) {
    phase = 7;
    setTimeout(() => input.write('\x1b[B\r'), 30);
  }
  return original(chunk, ...args);
};
process.on('exit', () => {
  if (input.isRaw) { process.stderr.write('RAW MODE LEAK'); process.exitCode = 9; }
});
`;
    await writeFile(preload, boot.replace('__KEY__', JSON.stringify(cancel ? '\u0003' : '\r')));
    const result = invoke(entry, repo, [], { ...process.env, TERM: 'xterm', NO_COLOR: '1' }, preload);
    assert.equal(result.status, cancel ? 130 : 0, result.stderr + result.stdout);
    assert(!result.stderr.includes('RAW MODE LEAK'));
    if (!cancel) { assert.match(result.stdout, /Location:/); assert.match(result.stdout, /Initial/); assert.match(result.stdout, /Navigation/); }
  }
});

test('distribution includes notices and no absolute development paths', async () => {
  const bundle = await readFile(path.join(project, 'dist', 'twiglet.cjs'), 'utf8');
  const notices = await readFile(path.join(project, 'dist', 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert.match(notices, /@inquirer\/select/);
  assert.match(notices, /Permission is hereby granted/);
  assert(!bundle.includes(project));
});
