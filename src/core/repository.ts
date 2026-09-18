import { realpath } from 'node:fs/promises';
import { git, runGit } from '../git/run.js';
import { parseStatus } from '../git/status.js';
import { RepositoryError } from './types.js';
import type { Overview } from './types.js';

export async function readOverview(directory: string, signal?: AbortSignal): Promise<Overview> {
  let cwd: string;
  try { cwd = await realpath(directory); }
  catch { throw new RepositoryError(`Repository directory does not exist or cannot be accessed: ${directory}`); }
  const bare = (await git(cwd, ['rev-parse', '--is-bare-repository'], signal)).toString().trim();
  if (bare === 'true') throw new RepositoryError('Bare repositories are not supported yet. Open a working tree.');
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'], signal)).toString('utf8').replace(/\r?\n$/, '');
  // Refuse partial clones even on older Git versions that ignore GIT_NO_LAZY_FETCH.
  // Merely reading config does not access missing objects or invoke transports.
  const partial = await runGit(cwd, ['config', '--get-regexp', String.raw`^(extensions\.partialclone|remote\..*\.promisor)$`], signal);
  if (partial.code !== 0 && partial.code !== 1) throw new RepositoryError(partial.stderr.trim() || 'Cannot inspect Git configuration.');
  if (partial.code === 0) throw new RepositoryError('Partial-clone configuration detected. Inspection is not supported yet to avoid fetching missing objects.');
  // Status can invoke clean/process filters to compare worktree content. Disable
  // them locally for this command, without editing config or executing helpers.
  const filters = await runGit(cwd, ['config', '--null', '--name-only', '--get-regexp', String.raw`^filter\..*\.(clean|process)$`], signal);
  if (filters.code !== 0 && filters.code !== 1) throw new RepositoryError('Cannot inspect Git filter configuration.');
  const drivers = new Set(filters.stdout.toString('utf8').split('\0').filter(Boolean).map((key) => key.replace(/\.(clean|process)$/, '')));
  const filterOptions = [...drivers].flatMap((driver) => [
    '-c', `${driver}.clean=`, '-c', `${driver}.process=`, '-c', `${driver}.required=false`,
  ]);
  const shallow = (await git(cwd, ['rev-parse', '--is-shallow-repository'], signal)).toString().trim() === 'true';
  const status = parseStatus(await git(cwd, [
    ...filterOptions,
    'status', '--porcelain=v2', '--branch', '-z', '--no-ahead-behind',
    '--untracked-files=normal', '--renames', '--ignore-submodules=all',
  ], signal));
  return { root, shallow, filtersDisabled: drivers.size > 0, ...status };
}
