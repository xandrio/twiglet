import { AsyncLocalStorage } from 'node:async_hooks';

// Deliberate execution context, not an inherited application environment. Keep
// HOME/XDG so installed Git continues to read the user's normal configuration.
const common = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME',
  'XDG_CONFIG_HOME', 'XDG_CONFIG_DIRS', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_DATA_DIRS',
  'LANG', 'LANGUAGE', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID']);
const windows = new Set(['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'USERNAME', 'USERDOMAIN']);
const session = new Set(['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'DISPLAY',
  'WAYLAND_DISPLAY', 'XAUTHORITY']);
const exclusions = new AsyncLocalStorage<ReadonlySet<string>>();
const normalized = (name: string) => name.toUpperCase();

export function reservedCredentialName(name: string): boolean {
  const key = normalized(name);
  return common.has(key) || windows.has(key) || session.has(key) || /^LC_[A-Z_]+$/.test(key)
    || /^(GIT_|NODE_|LD_|DYLD_)/.test(key) || key === 'TWIGLET_CONFIG';
}

export function withCredentialEnvironment<T>(names: readonly string[], operation: () => T): T {
  return exclusions.run(new Set([...(exclusions.getStore() ?? []), ...names.map(normalized)]), operation);
}

export function childEnvironment(env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform, purpose: 'git' | 'credential' = 'git',
  sensitive: readonly string[] = []): NodeJS.ProcessEnv {
  const excluded = new Set([...(exclusions.getStore() ?? []), ...sensitive.map(normalized)]);
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    const key = normalized(name);
    if (value === undefined || excluded.has(key)) continue;
    if (common.has(key) || /^LC_[A-Z_]+$/.test(key) || (platform === 'win32' && windows.has(key))
      || (purpose === 'credential' && platform !== 'win32' && session.has(key))) result[name] = value;
  }
  return result;
}
