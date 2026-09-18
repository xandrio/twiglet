import { git } from '../git/run.js';
import { parseHistory } from '../git/history.js';
import { discover, readHead, sameHead } from './discovery.js';
import { RepositoryError } from './types.js';
import type { RecentCommits } from './types.js';

export async function readRecentCommits(directory: string, limit = 20, signal?: AbortSignal): Promise<RecentCommits> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RepositoryError('Commit limit must be an integer from 1 to 100.');
  const { cwd, root, shallow } = await discover(directory, signal);
  const head = await readHead(cwd, signal);
  const commits = head.kind === 'unborn' ? [] : parseHistory(await git(cwd, [
    'log', '-z', '--date-order', `--max-count=${limit + 1}`, '--no-patch',
    '--no-decorate', '--no-notes', '--no-show-signature', '--no-use-mailmap', '--encoding=UTF-8',
    '--format=%H%x00%P%x00%an%x00%cI%x00%s', head.oid, '--',
  ], signal));
  if (!sameHead(head, await readHead(cwd, signal))) throw new RepositoryError('HEAD changed during history inspection. Refresh to try again.');
  return { root, head, shallow, limit, commits: commits.slice(0, limit), hasMore: commits.length > limit };
}
