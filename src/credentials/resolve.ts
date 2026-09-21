import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { childEnvironment } from '../process/environment.js';
import { Secret } from './secret.js';
import { windowsCapability, readWindowsCredential } from './windows.js';
import type { WindowsBridge } from './windows.js';

export type CredentialReference =
  | { source: 'env'; name: string }
  | { source: 'macos-keychain'; service: string; account: string }
  | { source: 'windows-credential-manager'; target: string }
  | { source: 'linux-secret-service'; account: string };
export type CredentialFailure = 'missing' | 'unavailable' | 'lookup-failed' | 'invalid' | 'cancelled' | 'timeout';
export class CredentialError extends Error {
  constructor(public readonly kind: CredentialFailure) {
    super(({ missing: 'Configured credential is missing.', unavailable: 'Configured credential source is unavailable on this machine.',
      'lookup-failed': 'Credential lookup failed or access was denied.', invalid: 'Configured credential has an invalid value.',
      cancelled: 'Credential lookup cancelled.', timeout: 'Credential lookup timed out.' })[kind]);
  }
}
export interface StoreRequest { executable: string; args: string[]; env: NodeJS.ProcessEnv; signal?: AbortSignal | undefined; input?: string; cwd?: string }
export type StoreRunner = (request: StoreRequest) => Promise<string>;
export interface CredentialContext {
  env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; signal?: AbortSignal | undefined;
  available?: (executable: string) => Promise<boolean>; run?: StoreRunner;
  locateWindowsBridge?: (env: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<WindowsBridge | undefined>;
}

async function executableAvailable(executable: string): Promise<boolean> {
  try { await access(executable, constants.X_OK); return (await stat(executable)).isFile(); } catch { return false; }
}

export async function credentialCapability(ref: CredentialReference, context: CredentialContext = {}): Promise<{ available: boolean; executable?: string; reason?: string }> {
  const platform = context.platform ?? process.platform;
  if (ref.source === 'env') return { available: true };
  if (ref.source === 'windows-credential-manager') return windowsCapability(context);
  // Fixed system locations: never execute a helper from the inspected repository or PATH.
  const candidates = ref.source === 'macos-keychain' && platform === 'darwin' ? ['/usr/bin/security']
    : ref.source === 'linux-secret-service' && platform === 'linux' ? ['/usr/bin/secret-tool', '/bin/secret-tool'] : [];
  for (const executable of candidates) if (await (context.available ?? executableAvailable)(executable)) return { available: true, executable };
  return { available: false };
}

/** Secret stdout is private to the resolver; neither stdout nor stderr enters errors. */
export const runCredentialStore: StoreRunner = request => new Promise((resolve, reject) => {
  if (request.signal?.aborted) { reject(new CredentialError('cancelled')); return; }
  const child = spawn(request.executable, request.args, { env: request.env, shell: false,
    ...(request.cwd ? { cwd: request.cwd } : {}),
    windowsHide: true, stdio: [request.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  const chunks: Buffer[] = []; let size = 0; let failure: CredentialError | undefined;
  const stop = (kind: CredentialFailure) => { failure ??= new CredentialError(kind); child.kill('SIGKILL'); };
  const abort = () => stop('cancelled');
  request.signal?.addEventListener('abort', abort, { once: true });
  if (request.signal?.aborted) abort();
  const timer = setTimeout(() => stop('timeout'), 15_000);
  child.stdin?.on('error', () => stop('lookup-failed'));
  child.stdin?.end(request.input);
  child.stdout!.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 16 * 1024) stop('invalid'); else chunks.push(chunk); });
  child.stderr!.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 16 * 1024) stop('invalid'); });
  child.on('error', () => { failure ??= new CredentialError('lookup-failed'); });
  child.on('close', code => {
    clearTimeout(timer); request.signal?.removeEventListener('abort', abort);
    if (failure) { reject(failure); return; }
    if (code !== 0) { reject(new CredentialError('lookup-failed')); return; }
    try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { reject(new CredentialError('invalid')); }
  });
});

export function environmentValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== 'win32') return env[name];
  return Object.entries(env).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];
}

export async function resolveCredential(ref: CredentialReference, context: CredentialContext = {}): Promise<Secret> {
  if (context.signal?.aborted) throw new CredentialError('cancelled');
  const env = context.env ?? process.env; const platform = context.platform ?? process.platform;
  let value: string | undefined;
  if (ref.source === 'env') value = environmentValue(env, ref.name, platform);
  else if (ref.source === 'windows-credential-manager') value = await readWindowsCredential(ref.target, context);
  else {
    try {
      const capability = await credentialCapability(ref, context);
      if (!capability.executable) throw new CredentialError('unavailable');
      const args = ref.source === 'macos-keychain'
        ? ['find-generic-password', '-s', ref.service, '-a', ref.account, '-w']
        : ['lookup', 'application', 'twiglet', 'account', ref.account];
      value = await (context.run ?? runCredentialStore)({ executable: capability.executable, args,
        env: childEnvironment(env, platform, 'credential'), signal: context.signal });
      // Utilities append one newline; do not trim actual credential characters.
      value = value.replace(/\r?\n$/, '');
    } catch (error) {
      if (context.signal?.aborted) throw new CredentialError('cancelled');
      if (error instanceof CredentialError) throw new CredentialError(error.kind);
      throw new CredentialError('lookup-failed');
    }
  }
  if (!value) throw new CredentialError('missing');
  if (Buffer.byteLength(value) > 16 * 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new CredentialError('invalid');
  return new Secret(value);
}
