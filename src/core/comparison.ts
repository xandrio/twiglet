import { runGit } from '../git/run.js';
import { parseDiff } from '../git/diff.js';
import type { FileChange } from '../git/diff.js';
import { parseHistory } from '../git/history.js';
import { discover } from './discovery.js';
import type { GitRunner } from './discovery.js';
import { resolveLocalBranch } from './branches.js';
import { parseDivergence } from './upstream.js';
import { RepositoryError } from './types.js';
import type { CommitSummary } from './types.js';

export interface Endpoint { name: string; ref: string; oid: string }
type Result<T> = { kind: 'available'; value: T } | { kind: 'unavailable'; message: string };
export interface Comparison {
  root: string;
  a: Endpoint;
  b: Endpoint;
  shallow: boolean;
  counts: Result<{ a: number; b: number }>;
  bases: Result<string[]>;
}
export type ComparisonView = 'commits-a' | 'commits-b' | 'tips' | 'since-base';
export type ComparisonDetail =
  | { kind: 'commits'; side: 'a' | 'b'; commits: CommitSummary[]; total: number }
  | { kind: 'files'; view: 'tips' | 'since-base'; before: string; after: string; files: FileChange[]; total: number };

async function query(cwd: string, args: string[], signal: AbortSignal | undefined, run: GitRunner): Promise<Buffer> {
  const result = await run(cwd, args, signal);
  if (result.code !== 0) throw new RepositoryError(result.stderr.trim() || `Git ${args[0]} failed.`);
  return result.stdout;
}

async function optional<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<Result<T>> {
  try { return { kind: 'available', value: await operation() }; }
  catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) };
  }
}

async function verify(cwd: string, comparison: Comparison, signal: AbortSignal | undefined, run: GitRunner) {
  for (const endpoint of [comparison.a, comparison.b]) {
    const result = await run(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', endpoint.ref], signal);
    if (result.code !== 0 || result.stdout.toString('ascii').trim() !== endpoint.oid) {
      throw new RepositoryError('A comparison branch moved or disappeared. Refresh to capture both tips again.');
    }
  }
}

export async function readComparison(directory: string, a: string, b: string, signal?: AbortSignal, run: GitRunner = runGit): Promise<Comparison> {
  const { cwd, root, shallow } = await discover(directory, signal);
  const left = await resolveLocalBranch(cwd, a, signal, run);
  const right = await resolveLocalBranch(cwd, b, signal, run);
  if (!left.oid || !right.oid) throw new RepositoryError('Comparison requires two committed branch tips; an unborn branch has no snapshot.');
  const counts: Comparison['counts'] = shallow ? { kind: 'unavailable', message: 'Shallow history: unique commit counts are unavailable.' } : await optional(async () => {
    const result = parseDivergence(await query(cwd, ['rev-list', '--left-right', '--count', `${left.oid}...${right.oid}`, '--'], signal, run));
    return { a: result.ahead, b: result.behind };
  }, signal);
  const bases: Comparison['bases'] = shallow ? { kind: 'unavailable', message: 'Shallow history: merge-base conclusions are unavailable.' } : await optional(async () => {
    const result = await run(cwd, ['merge-base', '--all', left.oid!, right.oid!], signal);
    if (result.code === 1 && !result.stdout.length) return [];
    if (result.code !== 0) throw new RepositoryError(result.stderr.trim() || 'Cannot determine merge bases.');
    const ids = result.stdout.toString('ascii').trim().split(/\s+/);
    if (!ids.every((id) => /^[0-9a-f]+$/.test(id))) throw new RepositoryError('Invalid merge-base output.');
    return ids;
  }, signal);
  const comparison: Comparison = { root, a: { ...left, oid: left.oid }, b: { ...right, oid: right.oid }, shallow, counts, bases };
  await verify(cwd, comparison, signal, run);
  return comparison;
}

export async function readComparisonDetail(comparison: Comparison, view: ComparisonView, signal?: AbortSignal, run: GitRunner = runGit): Promise<ComparisonDetail> {
  // Recheck safeguards: configuration may have changed since the summary was read.
  const { cwd, shallow } = await discover(comparison.root, signal);
  if (shallow !== comparison.shallow) throw new RepositoryError('History completeness changed. Refresh the comparison.');
  await verify(cwd, comparison, signal, run);
  let detail: ComparisonDetail;
  if (view === 'commits-a' || view === 'commits-b') {
    if (comparison.counts.kind === 'unavailable') throw new RepositoryError(comparison.counts.message);
    const side = view === 'commits-a' ? 'a' : 'b';
    const other = side === 'a' ? 'b' : 'a';
    const commits = parseHistory(await query(cwd, ['log', '-z', '--date-order', '--max-count=20', '--no-patch', '--no-decorate', '--no-notes', '--no-show-signature', '--no-use-mailmap', '--encoding=UTF-8', '--format=%H%x00%P%x00%an%x00%cI%x00%s', comparison[side].oid, `^${comparison[other].oid}`, '--'], signal, run));
    detail = { kind: 'commits', side, commits, total: comparison.counts.value[side] };
  } else {
    let before = comparison.a.oid;
    if (view === 'since-base') {
      if (comparison.bases.kind === 'unavailable') throw new RepositoryError(comparison.bases.message);
      if (comparison.bases.value.length !== 1) throw new RepositoryError(comparison.bases.value.length ? 'Multiple merge bases; no single base was selected.' : 'No common ancestor; merge-base comparison is unavailable.');
      before = comparison.bases.value[0]!;
    }
    const files = parseDiff(await query(cwd, ['diff', '--raw', '-z', '--no-abbrev', '--no-ext-diff', '--no-textconv', '--no-relative', '--ignore-submodules=none', '--submodule=short', '--no-renames', '--find-renames=50%', '-l1000', before, comparison.b.oid, '--'], signal, run));
    detail = { kind: 'files', view, before, after: comparison.b.oid, files: files.slice(0, 50), total: files.length };
  }
  await verify(cwd, comparison, signal, run);
  return detail;
}
