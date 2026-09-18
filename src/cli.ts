import { readOverview } from './core/repository.js';
import { createTerminal } from './terminal/prompt.js';
import { interactiveSession, isCancellation } from './terminal/session.js';
import { renderOverview, safeText } from './terminal/render.js';

const help = `Twiglet 0.1.0 - a small Git repository companion

Usage: tl [--repo <directory>] [status]
       tl --help
       tl --version

Run tl in a terminal for Repository overview -> Back -> Exit.
Without an interactive terminal, print the overview and exit.
status always prints the overview. --repo defaults to the current directory.
Requires Node 22+ and installed Git. No fetch or repository changes.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let directory = process.cwd();
  let direct = false;
  let information: 'help' | 'version' | undefined;
  let repoSet = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--repo' && !repoSet) {
      if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('--repo requires a directory.');
      directory = args[++i]!;
      repoSet = true;
    } else if (arg === 'status' && !direct) direct = true;
    else if (arg === '--help' || arg === '-h') information = 'help';
    else if (arg === '--version') information = 'version';
    else throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }
  if (information) { process.stdout.write(information === 'help' ? help : '0.1.0\n'); return; }
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const wasRaw = process.stdin.isRaw ?? false;
  try {
    const inspect = () => readOverview(directory, abort.signal);
    if (direct || !process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb') {
      process.stdout.write(renderOverview(await inspect()));
    } else {
      await interactiveSession(createTerminal(abort.signal), inspect, abort.signal);
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
  process.stderr.write(`Twiglet: ${safeText(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
