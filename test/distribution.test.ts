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
  assert.equal(invoke(entry, directory, ['--version']).stdout.trim(), '0.5.0');
  const history = invoke(entry, directory, ['--repo', nested, 'log', '--limit', '1']);
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /Initial/);
  const branches = invoke(entry, nested, ['branches']);
  assert.equal(branches.status, 0, branches.stderr);
  assert.match(branches.stdout, /\* topic/);
  const branch = invoke(entry, nested, ['branch', 'topic']);
  assert.equal(branch.status, 0, branch.stderr);
  assert.match(branch.stdout, /Branch: topic/);
  assert.match(branch.stdout, /Initial/);
  fixtureGit(other, 'branch', 'reference');
  fixtureGit(other, 'commit', '--allow-empty', '-m', 'Unique B commit');
  const summary = invoke(entry, nested, ['compare', 'reference', 'topic']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /Only in B: 1 commits/);
  for (const view of ['commits-a', 'commits-b', 'tips', 'since-base']) {
    const result = invoke(entry, directory, ['--repo', nested, 'compare', 'reference', 'topic', '--view', view]);
    assert.equal(result.status, 0, result.stderr);
    assert(!result.stdout.includes('\x1b'));
    assert.match(result.stdout, /refs\/heads\/reference/);
  }
  await writeFile(path.join(other, 'tracked.txt'), 'Patch example\n');
  fixtureGit(other, 'add', '.'); fixtureGit(other, 'commit', '-m', 'Patch');
  for (const view of ['tips', 'since-base']) {
    const patch = invoke(entry, nested, ['compare', 'reference', 'topic', '--view', view, '--file', 'tracked.txt']);
    assert.equal(patch.status, 0, patch.stderr);
    assert.match(patch.stdout, /\+Patch example/);
    assert(!patch.stdout.includes('\x1b'));
  }
  assert.equal(invoke(entry, nested, ['compare', 'reference', 'topic', '--file', 'tracked.txt']).status, 1);
  assert.equal(invoke(entry, nested, ['compare', 'reference', 'topic', '--view', 'tips', '--file', 'missing']).status, 1);
  const unrelated = fixtureGit(other, 'commit-tree', 'HEAD^{tree}', '-m', 'Orphan');
  fixtureGit(other, 'branch', 'unrelated', unrelated);
  assert.equal(invoke(entry, nested, ['compare', 'topic', 'unrelated']).status, 0);
  assert.equal(invoke(entry, nested, ['compare', 'topic', 'unrelated', '--view', 'tips']).status, 0);
  const unavailable = invoke(entry, nested, ['compare', 'topic', 'unrelated', '--view', 'since-base']);
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /No common ancestor/);
  for (const args of [['compare'], ['compare', 'topic'], ['compare', 'topic~1', 'topic'], ['compare', 'topic', 'topic', '--view', 'diff'], ['status', '--view', 'tips']]) {
    assert.equal(invoke(entry, nested, args).status, 1);
  }
  for (const args of [['branch'], ['branch', 'HEAD~1'], ['branch', 'missing'], ['branches', '--limit', '2']]) {
    assert.equal(invoke(entry, nested, args).status, 1);
  }
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
  const partialBranch = invoke(entry, other, ['branch', 'topic']);
  assert.equal(partialBranch.status, 0, partialBranch.stderr);
  assert.match(partialBranch.stdout, /Comparison unavailable/);
  assert.match(partialBranch.stdout, /Initial/);
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
test('bundled prompts refresh overview, history and branches, navigate Back/Exit and restore raw mode', async (t) => {
  const directory = await temp(t);
  const entry = path.join(directory, 'twiglet.cjs');
  await cp(path.join(project, 'dist', 'twiglet.cjs'), entry);
  const repo = await repository(t);
  for (const [cancel, color] of [[false, false], [true, false], [false, true]]) {
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
  } else if (phase === 7 && text.includes('? Local branches')) {
    phase = 8;
    setTimeout(() => input.write('\r'), 30);
  } else if (phase === 8 && text.includes('Navigation')) {
    phase = 9;
    setTimeout(() => input.write('\x1b[B\r'), 30);
  } else if (phase === 9 && text.includes('Navigation')) {
    phase = 10;
    setTimeout(() => input.write('\r'), 30);
  } else if (phase === 10 && text.includes('? Local branches')) {
    phase = 11;
    setTimeout(() => input.write('\x1b[A\x1b[A\r'), 30);
  } else if (phase === 11 && text.includes('Twiglet')) {
    phase = 12;
    setTimeout(() => input.write('\x1b[B\r'), 30);
  }
  return original(chunk, ...args);
};
process.on('exit', () => {
  if (input.isRaw) { process.stderr.write('RAW MODE LEAK'); process.exitCode = 9; }
});
`;
    await writeFile(preload, boot.replace('__KEY__', JSON.stringify(cancel ? '\u0003' : '\r')));
    const result = invoke(entry, repo, [], { ...process.env, TERM: 'xterm', NO_COLOR: color ? '' : '1', FORCE_COLOR: color ? '1' : '0' }, preload);
    assert.equal(result.status, cancel ? 130 : 0, result.stderr + result.stdout);
    assert(!result.stderr.includes('RAW MODE LEAK'));
    assert.equal(/\x1b\[\d+(?:;\d+)*m/.test(result.stdout), Boolean(color));
    if (!cancel) { assert.match(result.stdout, /Location:/); assert.match(result.stdout, /Initial/); assert.match(result.stdout, /Branch details/); }
  }
});

test('bundled comparison workflow selects branches, opens file views and exits without installation', async (t) => {
  const directory = await temp(t);
  const entry = path.join(directory, 'twiglet.cjs');
  await cp(path.join(project, 'dist', 'twiglet.cjs'), entry);
  const repo = await repository(t);
  fixtureGit(repo, 'branch', 'reference');
  await writeFile(path.join(repo, 'tracked.txt'), 'Interactive patch\n');
  fixtureGit(repo, 'add', '.'); fixtureGit(repo, 'commit', '-m', 'Patch');
  const preload = path.join(directory, 'terminal.cjs');
  await writeFile(preload, String.raw`
const { PassThrough } = require('node:stream');
const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
input.setRawMode = raw => { input.isRaw = raw; return input; };
Object.defineProperty(process, 'stdin', { value: input });
Object.defineProperty(process.stdout, 'isTTY', { value: true }); process.stdout.columns = 120;
const down = n => '\x1b[B'.repeat(n) + '\r';
const steps = [
  ['? Twiglet', down(2)], ['? Local branches', '\r'], ['? Navigation', down(2)],
  ['? Reference branch A', down(1)], ['? Comparison\n> Commits only in A', down(2)], ['? Navigation', down(2)],
  ['? Changed files', down(2)], ['? File navigation', '\r'], ['? Changed files', '\x1b[A\x1b[A\r'],
  ['? Comparison\n> Commits only in A', down(3)], ['? Navigation', '\r'], ['? Comparison\n> Commits only in A', down(4)],
  ['? Comparison\n> Commits only in A', down(5)], ['? Comparison\n> Commits only in A', down(6)], ['? Navigation', '\r'],
  ['? Local branches', '\x1b[A\x1b[A\r'], ['? Twiglet', down(1)],
];
let phase = 0;
const original = process.stdout.write.bind(process.stdout);
process.stdout.write = function(chunk, ...args) {
  const text = String(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  if (steps[phase] && text.includes(steps[phase][0])) {
    const key = steps[phase++][1]; setTimeout(() => input.write(key), 30);
  }
  return original(chunk, ...args);
};
process.on('exit', () => { if (input.isRaw || phase !== steps.length) process.exitCode = 9; });
`);
  const result = spawnSync(process.execPath, ['--require', preload, entry], { cwd: repo, encoding: 'utf8', timeout: 30_000, windowsHide: true, env: { ...process.env, TERM: 'xterm', NO_COLOR: '1', FORCE_COLOR: '0' } });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Files: A tip → B tip/);
  assert.match(result.stdout, /Files: merge base → B tip/);
  assert.match(result.stdout, /\+Interactive patch/);
});

test('distribution includes notices and no absolute development paths', async () => {
  const bundle = await readFile(path.join(project, 'dist', 'twiglet.cjs'), 'utf8');
  const notices = await readFile(path.join(project, 'dist', 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert.match(notices, /@inquirer\/select/);
  assert.match(notices, /Permission is hereby granted/);
  assert(!bundle.includes(project));
});
