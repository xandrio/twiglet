import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { CredentialReference } from '../credentials/resolve.js';
import { environmentValue } from '../credentials/resolve.js';
import { reservedCredentialName } from '../process/environment.js';

export interface CloudMapping { workspace: string; repository: string }
export interface CloudSetup {
  mapping: CloudMapping; identity: { email: string } | { emailEnv: string };
  tokenRef: CredentialReference; sensitiveEnv: string[];
}
export class ConfigurationError extends Error {}

export function configPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = homedir()): string {
  return env.TWIGLET_CONFIG || (platform === 'win32'
    ? path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Twiglet', 'config.json')
    : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'twiglet', 'config.json'));
}

function object(value: unknown, keys: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new ConfigurationError(`Invalid configuration at ${field}: expected an object with documented fields only.`);
  }
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.length || /[\x00-\x1f\x7f]/.test(value)) throw new ConfigurationError(`Invalid configuration at ${field}.`);
  return value;
}
const identity = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;

function envReference(value: unknown, field: string): string {
  const name = string(value, field);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || reservedCredentialName(name)) {
    throw new ConfigurationError('Credential/identity references must name dedicated environment variables, not execution or session settings.');
  }
  return name;
}

function credentialReference(value: unknown): CredentialReference {
  const ref = object(value, ['source', 'name', 'service', 'account', 'target'], 'bitbucketCloud.tokenRef');
  if (ref.source === 'windows-credential-manager') {
    object(value, ['source', 'target'], 'bitbucketCloud.tokenRef');
    const target = string(ref.target, 'bitbucketCloud.tokenRef.target');
    if (!target.trim() || target.length > 32767 || /[\x80-\x9f]/.test(target)) throw new ConfigurationError('Invalid Windows credential target.');
    return { source: ref.source, target };
  }
  if (ref.source === 'env') {
    object(value, ['source', 'name'], 'bitbucketCloud.tokenRef');
    return { source: 'env', name: envReference(ref.name, 'bitbucketCloud.tokenRef.name') };
  }
  if (ref.source === 'macos-keychain' || ref.source === 'linux-secret-service') {
    object(value, ref.source === 'macos-keychain' ? ['source', 'service', 'account'] : ['source', 'account'], 'bitbucketCloud.tokenRef');
    const account = string(ref.account, 'bitbucketCloud.tokenRef.account');
    if (account.length > 256) throw new ConfigurationError('Credential selector is too long.');
    if (ref.source === 'linux-secret-service') return { source: ref.source, account };
    const service = string(ref.service, 'bitbucketCloud.tokenRef.service');
    if (service.length > 256) throw new ConfigurationError('Credential selector is too long.');
    return { source: ref.source, service, account };
  }
  throw new ConfigurationError('Unsupported credential source.');
}

export function resolveCloudEmail(setup: CloudSetup, env: NodeJS.ProcessEnv = process.env): string {
  const email = 'email' in setup.identity ? setup.identity.email : environmentValue(env, setup.identity.emailEnv);
  if (!email || /[\x00-\x1f\x7f:]/.test(email)) throw new ConfigurationError('Missing or invalid Bitbucket email identity.');
  return email;
}

/** Read only for explicit provider setup or doctor. Does not resolve credentials. */
export async function loadCloudSetup(root: string, env: NodeJS.ProcessEnv = process.env): Promise<CloudSetup | undefined> {
  let text: string;
  try {
    const filename = configPath(env);
    if ((await stat(filename)).size > 256 * 1024) throw new ConfigurationError('Configuration exceeds 256 KiB.');
    text = await readFile(filename, 'utf8');
    if (Buffer.byteLength(text) > 256 * 1024) throw new ConfigurationError('Configuration exceeds 256 KiB.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError('Cannot read user configuration.');
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new ConfigurationError('User configuration is not valid JSON.'); }
  const config = object(json, ['version', 'bitbucketCloud', 'repositories'], 'root');
  if (config.version !== 1) throw new ConfigurationError('Unsupported configuration version; expected 1.');
  const auth = object(config.bitbucketCloud, ['email', 'emailEnv', 'tokenEnv', 'tokenRef'], 'bitbucketCloud');
  if (('email' in auth) === ('emailEnv' in auth) || ('tokenEnv' in auth) === ('tokenRef' in auth)) {
    throw new ConfigurationError('Configure exactly one email/emailEnv and one tokenRef/tokenEnv.');
  }
  const account = 'email' in auth ? { email: string(auth.email, 'bitbucketCloud.email') }
    : { emailEnv: envReference(auth.emailEnv, 'bitbucketCloud.emailEnv') };
  if ('email' in account && account.email.includes(':')) throw new ConfigurationError('Invalid Bitbucket email identity.');
  const tokenRef: CredentialReference = 'tokenEnv' in auth
    ? { source: 'env', name: envReference(auth.tokenEnv, 'bitbucketCloud.tokenEnv') } : credentialReference(auth.tokenRef);
  const sensitiveEnv = [...('emailEnv' in account ? [account.emailEnv] : []), ...(tokenRef.source === 'env' ? [tokenRef.name] : [])];
  if (!Array.isArray(config.repositories)) throw new ConfigurationError('repositories must be an array.');
  const actual = identity(await realpath(root));
  const seen = new Set<string>();
  let mapping: CloudMapping | undefined;
  for (const [index, value] of config.repositories.entries()) {
    const field = `repositories[${index}]`;
    const row = object(value, ['path', 'bitbucketCloud'], field);
    const local = string(row.path, `${field}.path`);
    if (!path.isAbsolute(local)) throw new ConfigurationError(`${field}.path must be absolute.`);
    const cloud = object(row.bitbucketCloud, ['workspace', 'repository'], `${field}.bitbucketCloud`);
    const workspace = string(cloud.workspace, `${field}.bitbucketCloud.workspace`);
    const repository = string(cloud.repository, `${field}.bitbucketCloud.repository`);
    if (![workspace, repository].every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new ConfigurationError(`${field}.bitbucketCloud requires workspace/repository slugs.`);
    let canonical: string;
    try { canonical = identity(await realpath(local)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ConfigurationError(`Cannot resolve ${field}.path.`);
      canonical = identity(path.normalize(local));
    }
    if (seen.has(canonical)) throw new ConfigurationError('Duplicate repository mappings.');
    seen.add(canonical);
    if (canonical === actual) mapping = { workspace, repository };
  }
  if (!mapping) return undefined;
  return { mapping, identity: account, tokenRef, sensitiveEnv };
}
