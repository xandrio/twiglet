import assert from 'node:assert/strict';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readComparison, readComparisonDetail } from '../src/core/comparison.js';
import { parseDiff } from '../src/git/diff.js';
import { runGit } from '../src/git/run.js';
import { renderComparisonDetail } from '../src/terminal/comparison.js';
import { fixtureGit, repository, snapshot } from './helpers.js';

test('unique commits, tip differences and changes since base remain distinct and read-only', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'b');
  await writeFile(path.join(root, 'tracked.txt'), 'only A\n');
  fixtureGit(root, 'commit', '-am', 'A change');
  fixtureGit(root, 'checkout', 'b');
  await writeFile(path.join(root, 'b.txt'), 'only B\n');
  fixtureGit(root, 'add', '.'); fixtureGit(root, 'commit', '-m', 'B change');
  await writeFile(path.join(root, '.git', 'index'), 'broken index must not be read');
  const before = await snapshot(root);
  const comparison = await readComparison(root, 'topic', 'b');
  assert.deepEqual(comparison.counts, { kind: 'available', value: { a: 1, b: 1 } });
  const a = await readComparisonDetail(comparison, 'commits-a');
  assert.equal(a.kind === 'commits' && a.commits[0]?.subject, 'A change');
  const b = await readComparisonDetail(comparison, 'commits-b');
  assert.equal(b.kind === 'commits' && b.commits[0]?.subject, 'B change');
  const tips = await readComparisonDetail(comparison, 'tips');
  const base = await readComparisonDetail(comparison, 'since-base');
  assert.deepEqual(tips.kind === 'files' && tips.files.map((f) => [f.status, f.path.toString()]), [['A', 'b.txt'], ['M', 'tracked.txt']]);
  assert.deepEqual(base.kind === 'files' && base.files.map((f) => [f.status, f.path.toString()]), [['A', 'b.txt']]);
  const reversed = await readComparisonDetail(await readComparison(root, 'b', 'topic'), 'tips');
  assert.equal(reversed.kind === 'files' && reversed.files[0]?.status, 'D');
  assert.deepEqual(await snapshot(root), before);
});

test('equal tips, ancestor history and equivalent patches with different IDs', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'same');
  const equal = await readComparison(root, 'topic', 'same');
  assert.deepEqual(equal.counts, { kind: 'available', value: { a: 0, b: 0 } });
  assert.equal((await readComparisonDetail(equal, 'tips')).total, 0);
  assert.equal((await readComparisonDetail(await readComparison(root, 'topic', 'topic'), 'since-base')).total, 0);
  const base = fixtureGit(root, 'rev-parse', 'HEAD');
  await writeFile(path.join(root, 'new.txt'), 'same content');
  fixtureGit(root, 'add', '.');
  const tree = fixtureGit(root, 'write-tree');
  const a = fixtureGit(root, 'commit-tree', tree, '-p', base, '-m', 'Original patch');
  const b = fixtureGit(root, 'commit-tree', tree, '-p', base, '-m', 'Equivalent patch with different identity');
  fixtureGit(root, 'update-ref', 'refs/heads/topic', a);
  const linear = await readComparison(root, 'same', 'topic');
  assert.deepEqual(linear.counts, { kind: 'available', value: { a: 0, b: 1 } });
  fixtureGit(root, 'update-ref', 'refs/heads/same', b);
  const equivalent = await readComparison(root, 'topic', 'same');
  assert.deepEqual(equivalent.counts, { kind: 'available', value: { a: 1, b: 1 } });
  assert.equal((await readComparisonDetail(equivalent, 'tips')).total, 0);
  assert.equal((await readComparisonDetail(equivalent, 'since-base')).total, 1);
});

test('unrelated histories and multiple merge bases retain tip/commit inspection', async (t) => {
  const root = await repository(t);
  const tree = fixtureGit(root, 'rev-parse', 'HEAD^{tree}');
  const base = fixtureGit(root, 'rev-parse', 'HEAD');
  const orphan = fixtureGit(root, 'commit-tree', tree, '-m', 'Unrelated');
  fixtureGit(root, 'update-ref', 'refs/heads/other', orphan);
  const unrelated = await readComparison(root, 'topic', 'other');
  assert.deepEqual(unrelated.bases, { kind: 'available', value: [] });
  assert.deepEqual(unrelated.counts, { kind: 'available', value: { a: 1, b: 1 } });
  await assert.rejects(readComparisonDetail(unrelated, 'since-base'), /No common ancestor/);
  assert.equal((await readComparisonDetail(unrelated, 'tips')).total, 0);
  const l = fixtureGit(root, 'commit-tree', tree, '-p', base, '-m', 'Left');
  const r = fixtureGit(root, 'commit-tree', tree, '-p', base, '-m', 'Right');
  const a = fixtureGit(root, 'commit-tree', tree, '-p', l, '-p', r, '-m', 'Merge A');
  const b = fixtureGit(root, 'commit-tree', tree, '-p', r, '-p', l, '-m', 'Merge B');
  fixtureGit(root, 'update-ref', 'refs/heads/topic', a); fixtureGit(root, 'update-ref', 'refs/heads/other', b);
  const multiple = await readComparison(root, 'topic', 'other');
  assert.deepEqual(multiple.bases.kind === 'available' && new Set(multiple.bases.value), new Set([l, r]));
  await assert.rejects(readComparisonDetail(multiple, 'since-base'), /Multiple merge bases/);
  const commits = await readComparisonDetail(multiple, 'commits-a');
  assert.equal(commits.kind === 'commits' && commits.commits[0]?.parents.length, 2);
});

test('shallow, unborn, invalid names and partial clones have explicit limits', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'other');
  await writeFile(path.join(root, '.git', 'shallow'), fixtureGit(root, 'rev-parse', 'HEAD') + '\n');
  const shallow = await readComparison(root, 'topic', 'other');
  assert.equal(shallow.counts.kind, 'unavailable'); assert.equal(shallow.bases.kind, 'unavailable');
  assert.equal((await readComparisonDetail(shallow, 'tips')).total, 0);
  await assert.rejects(readComparisonDetail(shallow, 'commits-a'), /Shallow/);
  const empty = await repository(t, false);
  await assert.rejects(readComparison(empty, 'topic', 'topic'), /unborn/);
  for (const name of ['HEAD', 'topic~1', '--help', 'missing']) await assert.rejects(readComparison(root, name, 'topic'), /Local branch not found/);
  fixtureGit(root, 'config', 'remote.other.promisor', 'true');
  await assert.rejects(readComparisonDetail(shallow, 'tips'), /Partial-clone/);
});

test('raw file inspection handles renames, binary files, type changes and submodule pointers without helpers', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'before');
  await rename(path.join(root, 'tracked.txt'), path.join(root, 'renamed é.txt'));
  await writeFile(path.join(root, 'binary'), Buffer.from([0, 255, 10]));
  fixtureGit(root, 'add', '-A'); fixtureGit(root, 'commit', '-m', 'Rename and binary');
  fixtureGit(root, 'config', 'diff.external', 'twiglet-must-not-run');
  fixtureGit(root, 'config', 'diff.custom.textconv', 'twiglet-must-not-run');
  fixtureGit(root, 'config', 'diff.custom.command', 'twiglet-must-not-run');
  await writeFile(path.join(root, '.git', 'info', 'attributes'), '* diff=custom\n');
  let comparison = await readComparison(root, 'before', 'topic');
  const before = await snapshot(root);
  const files = await readComparisonDetail(comparison, 'tips');
  assert.equal(files.kind, 'files');
  if (files.kind !== 'files') return;
  assert(files.files.some((f) => f.status === 'R' && f.originalPath?.toString() === 'tracked.txt' && f.path.toString() === 'renamed é.txt'));
  assert(files.files.some((f) => f.path.toString() === 'binary'));
  assert.deepEqual(await snapshot(root), before);
  const blob = fixtureGit(root, 'rev-parse', 'HEAD:binary');
  fixtureGit(root, 'update-index', '--add', '--cacheinfo', `120000,${blob},binary`);
  fixtureGit(root, 'update-index', '--add', '--cacheinfo', `160000,${comparison.b.oid},submodule`);
  const tree = fixtureGit(root, 'write-tree');
  const tip = fixtureGit(root, 'commit-tree', tree, '-p', 'HEAD', '-m', 'Modes and gitlink');
  fixtureGit(root, 'branch', 'modes', tip);
  comparison = await readComparison(root, 'topic', 'modes');
  const modes = await readComparisonDetail(comparison, 'tips');
  assert(modes.kind === 'files' && modes.files.some((f) => f.status === 'T' && f.path.toString() === 'binary'));
  assert(modes.kind === 'files' && modes.files.some((f) => f.submodule && f.path.toString() === 'submodule'));
});

test('partial errors stay independent, ref movement invalidates results and cancellation propagates', async (t) => {
  const root = await repository(t); fixtureGit(root, 'branch', 'other');
  const partial = await readComparison(root, 'topic', 'other', undefined, async (cwd, args, signal) => {
    if (args[0] === 'rev-list') throw new Error('Count timed out');
    return runGit(cwd, args, signal);
  });
  assert.equal(partial.counts.kind, 'unavailable'); assert.equal(partial.bases.kind, 'available');
  assert.equal((await readComparisonDetail(partial, 'tips')).total, 0);
  const comparison = await readComparison(root, 'topic', 'other');
  await assert.rejects(readComparisonDetail(comparison, 'tips', undefined, async (cwd, args, signal) => {
    const result = await runGit(cwd, args, signal);
    if (args[0] === 'diff') fixtureGit(root, 'branch', '-D', 'other');
    return result;
  }), /moved or disappeared/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readComparison(root, 'topic', 'topic', abort.signal), /cancelled/);
});

test('comparison detail bounds retain accurate totals', async (t) => {
  const root = await repository(t); fixtureGit(root, 'branch', 'before');
  for (let i = 0; i < 51; i++) await writeFile(path.join(root, `file${i}`), 'content');
  fixtureGit(root, 'add', '.');
  const tree = fixtureGit(root, 'write-tree');
  let parent = fixtureGit(root, 'rev-parse', 'HEAD');
  for (let i = 0; i < 21; i++) parent = fixtureGit(root, 'commit-tree', tree, '-p', parent, '-m', `Commit ${i}`);
  fixtureGit(root, 'update-ref', 'refs/heads/topic', parent);
  const comparison = await readComparison(root, 'before', 'topic');
  const commits = await readComparisonDetail(comparison, 'commits-b');
  const files = await readComparisonDetail(comparison, 'tips');
  assert.equal(commits.total, 21); assert.equal(commits.kind === 'commits' && commits.commits.length, 20);
  assert.equal(files.total, 51); assert.equal(files.kind === 'files' && files.files.length, 50);
  assert.match(renderComparisonDetail(comparison, files), /Showing 50 of 51/);
});

test('raw parser preserves unusual path bytes and rejects incomplete records', () => {
  const raw = Buffer.concat([Buffer.from(':100644 100644 abc def M\0'), Buffer.from([255, 10, 9, 0])]);
  assert.deepEqual(parseDiff(raw)[0]?.path, Buffer.from([255, 10, 9]));
  for (const invalid of ['bad', ':100644 100644 abc def R100\0old\0', ':100644 100644 abc def X\0p\0']) assert.throws(() => parseDiff(Buffer.from(invalid)), /Malformed/);
});
