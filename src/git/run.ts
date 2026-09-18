import { spawn } from 'node:child_process';
import { RepositoryError } from '../core/types.js';

export interface GitResult { code: number; stdout: Buffer; stderr: string }
const MAX_OUTPUT = 16 * 1024 * 1024;

/** No shell, no stdin, no inherited Git redirection/config injection. */
export function runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<GitResult> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat', LC_ALL: 'C',
  });
  return new Promise((resolve, reject) => {
    const child = spawn('git', [
      '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      '-c', 'color.ui=false', ...args,
    ], { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    const stop = (message: string) => {
      failure ??= new RepositoryError(message);
      child.kill();
    };
    const abort = () => stop('Repository inspection cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => stop('Git inspection timed out after 15 seconds.'), 15_000);
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) stop('Git output exceeded the 16 MiB inspection limit.');
      else chunks.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.on('error', (error: NodeJS.ErrnoException) => {
      failure = new RepositoryError(error.code === 'ENOENT'
        ? 'Could not start Git. Check that Git is on PATH and the repository directory exists.'
        : `Could not start Git: ${error.message}`, { cause: error });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}

export async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<Buffer> {
  const result = await runGit(cwd, args, signal);
  if (result.code !== 0) {
    throw new RepositoryError(result.stderr.trim() || `Git ${args[0]} failed (exit ${result.code}).`);
  }
  return result.stdout;
}
