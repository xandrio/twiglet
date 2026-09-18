import { git, runGit } from '../git/run.js';
import { parseStatus } from '../git/status.js';
import { discover } from './discovery.js';
import { readUpstream } from './upstream.js';
import { RepositoryError } from './types.js';
import type { Overview } from './types.js';

export async function readOverview(directory: string, signal?: AbortSignal): Promise<Overview> {
  const { cwd, root, shallow } = await discover(directory, signal);
  // Status can invoke clean/process filters to compare worktree content. Disable
  // them locally for this command, without editing config or executing helpers.
  const filters = await runGit(cwd, ['config', '--null', '--name-only', '--get-regexp', String.raw`^filter\..*\.(clean|process)$`], signal);
  if (filters.code !== 0 && filters.code !== 1) throw new RepositoryError('Cannot inspect Git filter configuration.');
  const drivers = new Set(filters.stdout.toString('utf8').split('\0').filter(Boolean).map((key) => key.replace(/\.(clean|process)$/, '')));
  const filterOptions = [...drivers].flatMap((driver) => [
    '-c', `${driver}.clean=`, '-c', `${driver}.process=`, '-c', `${driver}.required=false`,
  ]);
  const status = parseStatus(await git(cwd, [
    ...filterOptions,
    'status', '--porcelain=v2', '--branch', '-z', '--no-ahead-behind',
    '--untracked-files=normal', '--renames', '--ignore-submodules=all',
  ], signal));
  const upstream = await readUpstream(cwd, status.head, shallow, signal);
  return { root, shallow, filtersDisabled: drivers.size > 0, head: status.head, changes: status.changes, upstream };
}
