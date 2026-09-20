import type { PrCheck } from '../core/pr.js';
import type { CloudPr } from '../providers/bitbucket-cloud.js';
import type { Terminal } from './session.js';
import { isCancellation } from './session.js';
import { safeText } from './render.js';
import { plain } from './style.js';
import type { Style } from './style.js';

export function renderPr(pr: CloudPr, style: Style = plain): string {
  const value = (value: string | null) => value === null ? style.muted('unavailable') : safeText(value);
  const tip = (hash: string | null) => style.hash(value(hash)) + (hash?.length === 12 ? style.muted(' (abbreviated)') : '');
  return [style.heading(`PR #${pr.id}: ${safeText(pr.title)}`), `State: ${safeText(pr.state)}`, `URL: ${safeText(pr.url)}`,
    `Source repository: ${value(pr.source.repository)}`, `Source branch: ${style.ref(value(pr.source.branch))}`,
    `Destination repository: ${value(pr.destination.repository)}`, `Destination branch: ${style.ref(value(pr.destination.branch))}`,
    `PR source tip reported by Bitbucket: ${tip(pr.source.tip)}`,
    `PR destination tip reported by Bitbucket: ${tip(pr.destination.tip)}`,
    style.muted(`Observed at: ${pr.observedAt}`)].join('\n') + '\n';
}

export function renderPrCheck(check: PrCheck, style: Style = plain, details = true): string {
  if (check.kind !== 'observed') return style.warning(`${check.kind}: ${safeText(check.message)}`) + '\n';
  const { observation } = check;
  const lines = [style.heading('Bitbucket Cloud PR observation'), `Location: ${safeText(check.root)}`,
    `Local branch: ${style.branch(safeText(check.branch))} (${style.hash(check.headOid)})`, `Mapped repository: ${safeText(check.repository)}`,
    style.muted('Scope: same-repository PRs, exact source branch, all states. Fork PR discovery is not included.'),
    style.muted('API-reported PR tips; not local tracking refs or separately verified live branch tips. No Git fetch performed.'),
    style.muted(`Last page observed at: ${observation.observedAt}. Pages are not an atomic snapshot.`), ''];
  if (!observation.complete) lines.push(style.warning(observation.message ?? 'Search incomplete.'));
  if (!observation.prs.length) lines.push(observation.complete ? 'No matching PR in this search scope.' : 'No confirmed matches in this incomplete search.');
  else {
    lines.push(`${observation.prs.length} matching PR${observation.prs.length === 1 ? '' : 's'}${observation.complete ? '.' : ' observed so far.'}`);
    if (details) for (const pr of observation.prs) lines.push('', renderPr(pr, style).trimEnd());
  }
  return lines.join('\n') + '\n';
}

export async function prSession(terminal: Terminal, check: () => Promise<PrCheck>, signal?: AbortSignal): Promise<void> {
  const style = terminal.style ?? plain;
  while (!signal?.aborted) {
    terminal.write('\n' + style.muted('Checking Bitbucket Cloud online...') + '\n');
    let result: PrCheck;
    try { result = await check(); }
    catch (error) {
      if (signal?.aborted || isCancellation(error)) throw error;
      result = { kind: 'local-context', message: 'Unable to inspect local repository context.' };
    }
    const prs = result.kind === 'observed' ? result.observation.prs : [];
    terminal.write(renderPrCheck(result, style, prs.length <= 1));
    let selected = 'back';
    while (!signal?.aborted) {
      const action = await terminal.choose('Bitbucket PRs', [{ name: 'Back', value: 'back' }, { name: 'Check again (online)', value: 'refresh' },
        ...(prs.length > 1 ? prs.map(pr => ({ name: `#${pr.id} ${safeText(pr.state)} | ${safeText(pr.title)} | → ${safeText(pr.destination.branch ?? 'unavailable')}`, value: String(pr.id) })) : [])], selected);
      if (action === 'back') return;
      if (action === 'refresh') break;
      selected = action;
      terminal.write('\n' + renderPr(prs.find(pr => String(pr.id) === action)!, style));
      await terminal.choose('PR navigation', [{ name: 'Back to results', value: 'back' }]);
    }
  }
}
