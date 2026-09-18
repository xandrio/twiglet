import type { BranchDetails, BranchList, LocalBranch } from '../core/types.js';
import { renderUpstream, safeText } from './render.js';

function trackingLabel(branch: LocalBranch): string {
  const tracking = branch.tracking;
  if (tracking.kind === 'none') return 'no upstream';
  if (tracking.kind === 'unavailable') return `tracking unavailable: ${safeText(tracking.message)}`;
  return `${safeText(tracking.target.ref)}${tracking.target.source === 'local-branch' ? ' (local branch)' : ''}${tracking.available ? '' : ' (missing locally)'}`;
}

export function branchChoice(branch: LocalBranch): string {
  const subject = safeText(branch.tip?.subject ?? 'No commits yet');
  return `${branch.current ? '* ' : ''}${safeText(branch.name)} | ${branch.tip?.committedAt.slice(0, 10) ?? 'unborn'} | ${subject.length > 50 ? subject.slice(0, 47) + '...' : subject} | ${trackingLabel(branch)}`;
}

export function renderBranchContext(list: BranchList): string {
  return `Local branches\nLocation: ${safeText(list.root)}\n${list.head.kind === 'detached' ? 'HEAD is detached.' : `Current branch: ${safeText(list.head.name)}`}\n* Current in this worktree. Dates are tip commit dates, not branch usage dates.\nRemote-tracking information is local; remote freshness unknown. No fetch performed.\n`;
}

export function renderBranches(list: BranchList): string {
  return renderBranchContext(list) + '\n' + (list.branches.length ? list.branches.map(branchChoice).join('\n') : 'No local branches.') + '\n';
}

export function renderBranchDetails(details: BranchDetails): string {
  const { branch, history } = details;
  const lines = ['Branch details', `Location: ${safeText(details.root)}`, `Branch: ${safeText(branch.name)}${branch.current ? ' (current in this worktree)' : ''}`,
    'Inspection only; no branch is checked out and no working-tree status is shown.'];
  if (branch.tip) lines.push(`Tip: ${branch.tip.oid}`, `Subject: ${safeText(branch.tip.subject)}`, `Author: ${safeText(branch.tip.author)}`, `Tip commit date: ${branch.tip.committedAt}`);
  else lines.push('No commits yet.');
  lines.push(...renderUpstream(details.upstream), '', 'Recent commits reachable from this branch, including merges:');
  if (history.kind === 'unavailable') lines.push(`History unavailable: ${safeText(history.message)}`);
  else {
    for (const commit of history.commits) lines.push(`${commit.oid.slice(0, 12)} ${safeText(commit.subject) || '(no subject)'}`, `  ${safeText(commit.author)} | ${commit.committedAt}${commit.parents.length > 1 ? ' | merge' : ''}`);
    if (history.hasMore) lines.push('Showing the latest 20 reachable commits; more are available.');
  }
  if (details.shallow) lines.push('Shallow repository: history is incomplete.');
  return lines.join('\n') + '\n';
}
