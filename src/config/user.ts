import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface CloudMapping { workspace: string; repository: string }
export interface CloudSetup { mapping: CloudMapping; email: string; token: string }
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

/** Read only for an explicitly requested online operation. Never include values in errors. */
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
  const auth = object(config.bitbucketCloud, ['emailEnv', 'tokenEnv'], 'bitbucketCloud');
  const emailEnv = string(auth.emailEnv, 'bitbucketCloud.emailEnv');
  const tokenEnv = string(auth.tokenEnv, 'bitbucketCloud.tokenEnv');
  if (![emailEnv, tokenEnv].every(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new ConfigurationError('Credential references must be environment-variable names.');
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
  const email = env[emailEnv]; const token = env[tokenEnv];
  if (!email || !token) throw new ConfigurationError('Missing credentials: set the environment variables referenced by bitbucketCloud.emailEnv and tokenEnv.');
  if (/[\r\n:]/.test(email) || /[\r\n]/.test(token)) throw new ConfigurationError('Invalid credential environment values.');
  return { mapping, email, token };
}
