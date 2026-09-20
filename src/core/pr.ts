import { discover, readHead, sameHead } from './discovery.js';
import { loadCloudSetup, ConfigurationError } from '../config/user.js';
import { observePullRequests, ProviderError } from '../providers/bitbucket-cloud.js';
import type { HttpTransport, PrObservation } from '../providers/bitbucket-cloud.js';

export type PrCheck =
  | { kind: 'observed'; root: string; branch: string; headOid: string; repository: string; observation: PrObservation }
  | { kind: 'not-configured' | 'configuration' | 'local-context' | 'provider'; message: string };

export async function checkPullRequests(directory: string, signal?: AbortSignal, env: NodeJS.ProcessEnv = process.env, transport?: HttpTransport): Promise<PrCheck> {
  const { cwd, root } = await discover(directory, signal);
  const head = await readHead(cwd, signal);
  if (head.kind !== 'branch') return { kind: 'local-context', message: head.kind === 'detached' ? 'Detached HEAD: select a local branch before checking PRs.' : 'Unborn branch: a committed local branch is required to check PRs.' };
  try {
    const setup = await loadCloudSetup(root, env);
    if (!setup) return { kind: 'not-configured', message: 'Bitbucket Cloud is not configured for this worktree. Add an explicit mapping in user configuration.' };
    const observation = await observePullRequests(setup, head.name, signal, transport);
    if (!sameHead(head, await readHead(cwd, signal))) return { kind: 'local-context', message: 'HEAD changed during the check. Check again to associate PRs with the current branch.' };
    return { kind: 'observed', root, branch: head.name, headOid: head.oid, repository: `${setup.mapping.workspace}/${setup.mapping.repository}`, observation };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ConfigurationError) return { kind: 'configuration', message: error.message };
    if (error instanceof ProviderError) return { kind: 'provider', message: `${error.kind}: ${error.message}` };
    throw error;
  }
}

export const prCheckSucceeded = (check: PrCheck): boolean => check.kind === 'observed' && check.observation.complete;
