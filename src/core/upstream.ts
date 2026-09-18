import { runGit } from '../git/run.js';
import { readHead, sameHead } from './discovery.js';
import type { GitRunner } from './discovery.js';
import { RepositoryError } from './types.js';
import type { Head, Upstream, UpstreamTarget } from './types.js';

export function parseDivergence(data: Buffer): { ahead: number; behind: number } {
  const match = /^(\d+)\s+(\d+)\s*$/.exec(data.toString('ascii'));
  if (!match) throw new RepositoryError('Git returned malformed divergence counts.');
  const ahead = Number(match[1]);
  const behind = Number(match[2]);
  if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) throw new RepositoryError('Divergence counts exceed the supported range.');
  return { ahead, behind };
}

/** An optional comparison failure must not discard the primary overview. */
export async function readUpstream(cwd: string, head: Head, shallow: boolean, signal?: AbortSignal, run: GitRunner = runGit): Promise<Upstream> {
  let target: UpstreamTarget | undefined;
  let configured: string | undefined;
  const unavailable = (reason: Extract<Upstream, { kind: 'unavailable' }>['reason'], message: string): Upstream => ({
    kind: 'unavailable', reason, message, ...(target ? { target } : {}), ...(configured ? { configured } : {}),
  });
  const query = async (args: string[]) => {
    const result = await run(cwd, args, signal);
    if (result.code !== 0) throw new RepositoryError(result.stderr.trim() || `Git ${args[0]} failed.`);
    return result.stdout;
  };
  const config = async (key: string) => {
    const result = await run(cwd, ['config', '--null', '--get-all', key], signal);
    if (result.code === 1) return [];
    if (result.code !== 0) throw new RepositoryError(result.stderr.trim() || 'Cannot read upstream configuration.');
    return result.stdout.toString('utf8').split('\0').slice(0, -1);
  };
  const inspect = async (): Promise<Upstream> => {
    if (head.kind === 'detached') return unavailable('detached', 'Detached HEAD has no current-branch upstream.');
    const remotes = await config(`branch.${head.name}.remote`);
    const merges = await config(`branch.${head.name}.merge`);
    if (remotes.length || merges.length) configured = `${remotes.at(-1) ?? 'origin'}:${merges.join(', ') || '(no merge target)'}`;
    if (head.kind === 'unborn') return unavailable('unborn', 'No commits yet; upstream comparison is unavailable.');
    if (!configured) return { kind: 'none' };
    if (merges.length !== 1) return unavailable('unresolved', 'Upstream configuration must identify one merge target.');
    const branchRef = `refs/heads/${head.name}`;
    const data = await query(['for-each-ref', '--format=%(refname)%00%(upstream)%00%(upstream:remotename)%00', '--', branchRef]);
    const row = data.toString('utf8').split('\n').map((line) => line.split('\0')).find((fields) => fields[0] === branchRef);
    if (!row?.[1]) return unavailable('unresolved', 'Configured upstream cannot be mapped to a local reference.');
    target = { ref: row[1], source: row[2] === '.' ? 'local-branch' : 'remote-tracking' };
    const exists = await run(cwd, ['show-ref', '--verify', '--quiet', target.ref], signal);
    if (exists.code === 1) return unavailable('missing-ref', target.source === 'local-branch'
      ? 'Configured upstream branch is unavailable locally.'
      : 'Configured upstream reference is unavailable locally; its remote existence is unknown.');
    if (exists.code !== 0) throw new RepositoryError(exists.stderr.trim() || 'Cannot read upstream reference.');
    const upstreamOid = (await query(['rev-parse', '--verify', '--end-of-options', `${target.ref}^{commit}`])).toString('ascii').trim();
    if (!/^[0-9a-f]+$/.test(upstreamOid)) throw new RepositoryError('Git returned an invalid upstream object ID.');
    if (shallow) return unavailable('shallow', 'Divergence unavailable: shallow history is incomplete.');
    const counts = parseDivergence(await query(['rev-list', '--left-right', '--count', `${head.oid}...${upstreamOid}`, '--']));
    return { kind: 'compared', target, headOid: head.oid, upstreamOid, ...counts };
  };
  try {
    const result = await inspect();
    if (!sameHead(head, await readHead(cwd, signal, run))) return unavailable('changed-head', 'HEAD changed during inspection. Refresh to compare the current HEAD.');
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    return unavailable('error', error instanceof Error ? error.message : String(error));
  }
}
