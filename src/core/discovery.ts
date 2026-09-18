import { realpath } from 'node:fs/promises';
import { git, runGit } from '../git/run.js';
import { RepositoryError } from './types.js';
import type { Head } from './types.js';

export type GitRunner = typeof runGit;

export async function discover(directory: string, signal?: AbortSignal): Promise<{ cwd: string; root: string; shallow: boolean }> {
  let cwd: string;
  try { cwd = await realpath(directory); }
  catch { throw new RepositoryError(`Repository directory does not exist or cannot be accessed: ${directory}`); }
  const bare = (await git(cwd, ['rev-parse', '--is-bare-repository'], signal)).toString().trim();
  if (bare === 'true') throw new RepositoryError('Bare repositories are not supported yet. Open a working tree.');
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'], signal)).toString('utf8').replace(/\r?\n$/, '');
  // Older Git may ignore GIT_NO_LAZY_FETCH. Reject partial clones before reading objects.
  const partial = await runGit(cwd, ['config', '--get-regexp', String.raw`^(extensions\.partialclone|remote\..*\.promisor)$`], signal);
  if (partial.code !== 0 && partial.code !== 1) throw new RepositoryError(partial.stderr.trim() || 'Cannot inspect Git configuration.');
  if (partial.code === 0) throw new RepositoryError('Partial-clone configuration detected. Inspection is not supported yet to avoid fetching missing objects.');
  const shallow = (await git(cwd, ['rev-parse', '--is-shallow-repository'], signal)).toString().trim() === 'true';
  return { cwd, root, shallow };
}

export async function readHead(cwd: string, signal?: AbortSignal, run: GitRunner = runGit): Promise<Head> {
  const symbolic = async () => {
    const result = await run(cwd, ['symbolic-ref', '--quiet', 'HEAD'], signal);
    if (result.code === 1) return undefined;
    if (result.code !== 0) throw new RepositoryError(result.stderr.trim() || 'Cannot resolve HEAD.');
    const ref = result.stdout.toString('utf8').trim();
    if (!ref.startsWith('refs/heads/')) throw new RepositoryError('HEAD does not refer to a local branch.');
    return ref;
  };
  const before = await symbolic();
  const commit = await run(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], signal);
  const after = await symbolic();
  if (before !== after) throw new RepositoryError('HEAD changed during inspection. Refresh to try again.');
  if (commit.code === 0) {
    const oid = commit.stdout.toString('ascii').trim();
    if (!/^[0-9a-f]+$/.test(oid)) throw new RepositoryError('Git returned an invalid HEAD object ID.');
    return before ? { kind: 'branch', name: before.slice(11), oid } : { kind: 'detached', oid };
  }
  if (commit.code === 1 && before) {
    const ref = await run(cwd, ['show-ref', '--verify', '--quiet', before], signal);
    if (ref.code === 1) return { kind: 'unborn', name: before.slice(11) };
  }
  throw new RepositoryError(commit.stderr.trim() || 'HEAD commit is unavailable.');
}

export function sameHead(a: Head, b: Head): boolean {
  return a.kind === b.kind && ('name' in a ? a.name : undefined) === ('name' in b ? b.name : undefined)
    && ('oid' in a ? a.oid : undefined) === ('oid' in b ? b.oid : undefined);
}
