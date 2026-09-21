import { checkPullRequests, prCheckSucceeded } from './core/pr.js';
import { readDoctor } from './core/doctor.js';
import { renderDoctor } from './terminal/doctor.js';
import { renderPrCheck } from './terminal/pr.js';
import { renderPatch } from './terminal/patch.js';
import { readOverview } from './core/repository.js';
import { readRecentCommits } from './core/history.js';
import { listLocalBranches, readBranchDetails } from './core/branches.js';
import { renderBranches, renderBranchDetails } from './terminal/branches.js';
import { createTerminal } from './terminal/prompt.js';
import { interactiveSession, isCancellation } from './terminal/session.js';
import { renderHistory, renderOverview, safeText } from './terminal/render.js';
import { outputStyle } from './terminal/style.js';
import { readComparison, readComparisonDetail, readComparisonPatch } from './core/comparison.js';
import type { Comparison, ComparisonView } from './core/comparison.js';
import { renderComparison, renderComparisonDetail } from './terminal/comparison.js';

const help = `Twiglet 0.6.0 - a small Git repository companion

Usage: tl [--repo <directory>] [status]
       tl [--repo <directory>] log [--limit N]
       tl [--repo <directory>] branches
       tl [--repo <directory>] branch <name>
       tl [--repo <directory>] compare <A> <B> [--view commits-a|commits-b|tips|since-base]
       tl [--repo <directory>] compare <A> <B> --view tips|since-base --file <path>
       tl [--repo <directory>] pr --online
       tl [--repo <directory>] doctor [--check-credentials]
       tl --help
       tl --version

Run tl in a terminal for Repository overview, Recent commits, or Local branches.
Without an interactive terminal, print the overview and exit.
status always prints the overview. --repo defaults to the current directory.
log prints history reachable from HEAD, including merges (default 20, limit 1-100).
branches lists local branches. branch inspects one exact local name without checkout.
compare prints a summary. A is the reference, B the inspected local branch.
tips compares A tip to B tip; since-base compares their single merge base to B.
Unavailable upstream comparison does not fail an otherwise useful overview.
pr --online checks same-repository Bitbucket Cloud PRs using user-local configuration.
Other inspection commands remain offline.
doctor checks local setup only; --check-credentials may trigger OS permission prompts.
Requires Node 22+ and installed Git. No fetch or repository changes.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let directory = process.cwd();
  let command: 'status' | 'log' | 'branches' | 'branch' | 'compare' | 'pr' | 'doctor' | undefined;
  let comparisonNames: [string, string] | undefined;
  let view: ComparisonView | undefined;
  let file: string | undefined;
  let branchName: string | undefined;
  let limit: number | undefined;
  let information: 'help' | 'version' | undefined;
  let repoSet = false;
  let online = false;
  let checkCredentials = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--repo' && !repoSet) {
      if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('--repo requires a directory.');
      directory = args[++i]!;
      repoSet = true;
    } else if ((arg === 'status' || arg === 'log' || arg === 'branches' || arg === 'branch' || arg === 'compare' || arg === 'pr' || arg === 'doctor') && !command) {
      command = arg;
      if (arg === 'branch') {
        branchName = args[++i];
        if (!branchName) throw new Error('branch requires a local branch name.');
      }
      if (arg === 'compare') {
        const a = args[++i];
        const b = args[++i];
        if (!a || !b) throw new Error('compare requires two local branch names: A B.');
        comparisonNames = [a, b];
      }
    }
    else if (arg === '--online' && !online) online = true;
    else if (arg === '--check-credentials' && !checkCredentials) checkCredentials = true;
    else if (arg === '--view' && view === undefined) {
      const value = args[++i];
      if (!value || !['commits-a', 'commits-b', 'tips', 'since-base'].includes(value)) throw new Error('--view requires commits-a, commits-b, tips, or since-base.');
      view = value as ComparisonView;
    }
    else if (arg === '--file' && file === undefined) {
      file = args[++i];
      if (!file) throw new Error('--file requires an exact repository-relative Git path.');
    }
    else if (arg === '--limit' && limit === undefined) {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error('--limit requires an integer from 1 to 100.');
      limit = Number(value);
    }
    else if (arg === '--help' || arg === '-h') information = 'help';
    else if (arg === '--version') information = 'version';
    else throw new Error('Unknown or repeated argument. Use --help for usage.');
  }
  if (information) { process.stdout.write(information === 'help' ? help : '0.6.0\n'); return; }
  if (limit !== undefined && command !== 'log') throw new Error('--limit is only supported with log.');
  if (view !== undefined && command !== 'compare') throw new Error('--view is only supported with compare.');
  if (file !== undefined && (command !== 'compare' || (view !== 'tips' && view !== 'since-base'))) throw new Error('--file requires compare with --view tips or since-base.');
  if (command === 'pr' && !online) throw new Error('pr requires --online to explicitly request a Bitbucket Cloud check.');
  if (online && command !== 'pr') throw new Error('--online is only supported with pr.');
  if (checkCredentials && command !== 'doctor') throw new Error('--check-credentials is only supported with doctor.');
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const wasRaw = process.stdin.isRaw ?? false;
  const style = outputStyle(process.stdout);
  try {
    const operations = {
      prs: () => checkPullRequests(directory, abort.signal),
      overview: () => readOverview(directory, abort.signal),
      history: () => readRecentCommits(directory, limit ?? 20, abort.signal),
      branches: () => listLocalBranches(directory, abort.signal),
      branch: (name: string) => readBranchDetails(directory, name, abort.signal),
      compare: (a: string, b: string) => readComparison(directory, a, b, abort.signal),
      comparisonPatch: (comparison: Comparison, view: 'tips' | 'since-base', path: Buffer) => readComparisonPatch(comparison, view, path, abort.signal),
      comparisonDetail: (comparison: Comparison, view: ComparisonView) => readComparisonDetail(comparison, view, abort.signal),
    };
    if (command === 'doctor') {
      if (checkCredentials) process.stdout.write('Checking local credential access; an OS permission/unlock prompt may appear. No network requests.\n');
      const report = await readDoctor(directory, checkCredentials, { signal: abort.signal });
      process.stdout.write(renderDoctor(report, style));
      if (!report.ok) process.exitCode = 1;
    } else if (command === 'pr') {
      const result = await operations.prs();
      process.stdout.write(renderPrCheck(result, style));
      if (!prCheckSucceeded(result)) process.exitCode = 1;
    } else if (command === 'compare') {
      const comparison = await operations.compare(...comparisonNames!);
      process.stdout.write(file !== undefined ? renderPatch(comparison, view as 'tips' | 'since-base', await operations.comparisonPatch(comparison, view as 'tips' | 'since-base', Buffer.from(file)), style) : view ? renderComparisonDetail(comparison, await operations.comparisonDetail(comparison, view), style) : renderComparison(comparison, style));
    } else if (command === 'branches') {
      process.stdout.write(renderBranches(await operations.branches(), style));
    } else if (command === 'branch') {
      process.stdout.write(renderBranchDetails(await operations.branch(branchName!), style));
    } else if (command === 'log') {
      process.stdout.write(renderHistory(await operations.history(), style));
    } else if (command === 'status' || !process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb') {
      process.stdout.write(renderOverview(await operations.overview(), style));
    } else {
      await interactiveSession(createTerminal(abort.signal), operations, abort.signal);
    }
    if (abort.signal.aborted) process.exitCode = 130;
  } catch (error) {
    if (!abort.signal.aborted && !isCancellation(error)) throw error;
    process.exitCode = 130;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(outputStyle(process.stderr).error(`Twiglet: ${safeText(error instanceof Error ? error.message : String(error))}`) + '\n');
  process.exitCode = 1;
});
