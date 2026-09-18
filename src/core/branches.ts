import { git, runGit } from '../git/run.js';
import { branchFormat, parseBranches } from '../git/branches.js';
import { discover, readHead, sameHead } from './discovery.js';
import type { GitRunner } from './discovery.js';
import { readCommitHistory } from './history.js';
import { readUpstream } from './upstream.js';
import { RepositoryError } from './types.js';
import type { BranchDetails, BranchList, Head, LocalBranch, Tracking } from './types.js';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function readList(cwd: string, root: string, signal?: AbortSignal): Promise<BranchList> {
  const head = await readHead(cwd, signal);
  const rows = parseBranches(await git(cwd, ['for-each-ref', `--format=${branchFormat}`, '--', 'refs/heads/'], signal));
  let trackingError: string | undefined;
  const configured = new Map<string, { remote: string[]; merge: string[] }>();
  let refs = new Set<string>();
  try {
    refs = new Set((await git(cwd, ['for-each-ref', '--format=%(refname)'], signal)).toString('utf8').split('\n'));
    const config = await runGit(cwd, ['config', '--null', '--get-regexp', '^branch\\..*\\.(remote|merge)$'], signal);
    if (config.code !== 0 && config.code !== 1) throw new RepositoryError(config.stderr.trim() || 'Cannot read tracking configuration.');
    for (const record of config.stdout.toString('utf8').split('\0').filter(Boolean)) {
      const separator = record.indexOf('\n');
      const match = /^branch\.(.*)\.(remote|merge)$/.exec(record.slice(0, separator));
      if (!match || separator < 0) throw new RepositoryError('Malformed branch configuration.');
      const values = configured.get(match[1]!) ?? { remote: [], merge: [] };
      values[match[2] as 'remote' | 'merge'].push(record.slice(separator + 1));
      configured.set(match[1]!, values);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    trackingError = message(error);
  }
  const tracking = (name: string, upstream = '', remote = ''): Tracking => {
    if (trackingError) return { kind: 'unavailable', message: trackingError };
    const config = configured.get(name);
    if (!config && !upstream) return { kind: 'none' };
    if (config?.merge.length !== 1 || !upstream) return { kind: 'unavailable', message: 'Configured upstream cannot be resolved to one local reference.' };
    return { kind: 'configured', target: { ref: upstream, source: remote === '.' ? 'local-branch' : 'remote-tracking' }, available: refs.has(upstream) };
  };
  const branches: LocalBranch[] = rows.map((row) => ({
    ref: row.ref, name: row.ref.slice(11), tip: row.tip,
    current: head.kind !== 'detached' && row.ref === `refs/heads/${head.name}`,
    tracking: tracking(row.ref.slice(11), row.upstream, row.remote),
  }));
  if (head.kind === 'unborn') branches.push({ ref: `refs/heads/${head.name}`, name: head.name, current: true, tip: null, tracking: tracking(head.name) });
  if (!sameHead(head, await readHead(cwd, signal))) throw new RepositoryError('HEAD changed while listing branches. Refresh to try again.');
  branches.sort((a, b) => Number(b.current) - Number(a.current)
    || Date.parse(b.tip?.committedAt ?? '1970-01-01') - Date.parse(a.tip?.committedAt ?? '1970-01-01')
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { root, head, branches };
}

export async function listLocalBranches(directory: string, signal?: AbortSignal): Promise<BranchList> {
  const { cwd, root } = await discover(directory, signal);
  return readList(cwd, root, signal);
}

export async function readBranchDetails(directory: string, name: string, signal?: AbortSignal, run: GitRunner = runGit): Promise<BranchDetails> {
  const { cwd, root, shallow } = await discover(directory, signal);
  // Exact lookup in local refs prevents option/revision-expression interpretation.
  const branch = (await readList(cwd, root, signal)).branches.find((entry) => entry.name === name);
  if (!branch) throw new RepositoryError(`Local branch not found: ${name}`);
  const head: Head = branch.tip ? { kind: 'branch', name, oid: branch.tip.oid } : { kind: 'unborn', name };
  // This is a selected ref, not necessarily HEAD. Its consistency is checked below.
  const upstream = await readUpstream(cwd, head, shallow, signal, run, false);
  let history: BranchDetails['history'];
  try {
    const commits = branch.tip ? await readCommitHistory(cwd, branch.tip.oid, 20, signal, run) : [];
    history = { kind: 'available', commits: commits.slice(0, 20), hasMore: commits.length > 20 };
  } catch (error) {
    if (signal?.aborted) throw error;
    history = { kind: 'unavailable', message: message(error) };
  }
  const after = await run(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', branch.ref], signal);
  const unchanged = branch.tip ? after.code === 0 && after.stdout.toString('ascii').trim() === branch.tip.oid
    : after.code === 1 && sameHead(head, await readHead(cwd, signal));
  if (!unchanged) throw new RepositoryError('Selected branch changed or disappeared during inspection. Refresh to try again.');
  const current = await readHead(cwd, signal);
  branch.current = current.kind !== 'detached' && current.name === name;
  return { root, branch, shallow, upstream, history };
}
