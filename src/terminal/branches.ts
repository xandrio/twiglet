import type { BranchDetails, BranchList, LocalBranch } from '../core/types.js';
import { renderCommit, renderUpstream, safeText } from './render.js';
import { plain } from './style.js';
import type { Style } from './style.js';

function trackingLabel(branch: LocalBranch, style: Style): string {
  const tracking = branch.tracking;
  if (tracking.kind === 'none') return style.muted('no upstream');
  if (tracking.kind === 'unavailable') return style.warning(`tracking unavailable: ${safeText(tracking.message)}`);
  return `${style.ref(safeText(tracking.target.ref))}${tracking.target.source === 'local-branch' ? ' (local branch)' : ''}${tracking.available ? '' : style.warning(' (missing locally)')}`;
}

export function branchChoice(branch: LocalBranch, style: Style = plain): string {
  const subject = safeText(branch.tip?.subject ?? 'No commits yet');
  return `${branch.current ? style.good('* ') : ''}${(branch.current ? style.branch : style.ref)(safeText(branch.name))} | ${style.muted(safeText(branch.tip?.committedAt.slice(0, 10) ?? 'unborn'))} | ${style.subject(subject.length > 50 ? subject.slice(0, 47) + '...' : subject)} | ${trackingLabel(branch, style)}`;
}

export function renderBranchContext(list: BranchList, style: Style = plain): string {
  return `${style.heading('Local branches')}\nLocation: ${safeText(list.root)}\n${list.head.kind === 'detached' ? style.warning('HEAD is detached.') : `Current branch: ${style.branch(safeText(list.head.name))}`}\n* Current in this worktree. Dates are tip commit dates, not branch usage dates.\nRemote-tracking information is local; remote freshness unknown. No fetch performed.\n`;
}

export function renderBranches(list: BranchList, style: Style = plain): string {
  return renderBranchContext(list, style) + '\n' + (list.branches.length ? list.branches.map((branch) => branchChoice(branch, style)).join('\n') : 'No local branches.') + '\n';
}

export function renderBranchDetails(details: BranchDetails, style: Style = plain): string {
  const { branch, history } = details;
  const lines = [style.heading('Branch details'), `Location: ${safeText(details.root)}`, `Branch: ${(branch.current ? style.branch : style.ref)(safeText(branch.name))}${branch.current ? ' (current in this worktree)' : ''}`,
    style.muted('Inspection only; no branch is checked out and no working-tree status is shown.')];
  if (branch.tip) lines.push(`Tip: ${style.hash(branch.tip.oid)}`, `Subject: ${style.subject(safeText(branch.tip.subject))}`, `Author: ${style.author(safeText(branch.tip.author))}`, `Tip commit date: ${style.muted(safeText(branch.tip.committedAt))}`);
  else lines.push('No commits yet.');
  lines.push(...renderUpstream(details.upstream, style), '', style.heading('Recent commits reachable from this branch, including merges:'));
  if (history.kind === 'unavailable') lines.push(style.warning(`History unavailable: ${safeText(history.message)}`));
  else {
    for (const commit of history.commits) lines.push(...renderCommit(commit, style));
    if (history.hasMore) lines.push('Showing the latest 20 reachable commits; more are available.');
  }
  if (details.shallow) lines.push(style.warning('Shallow repository: history is incomplete.'));
  return lines.join('\n') + '\n';
}
