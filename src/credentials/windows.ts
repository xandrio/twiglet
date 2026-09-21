import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { childEnvironment } from '../process/environment.js';
import { CredentialError, environmentValue, runCredentialStore } from './resolve.js';
import type { CredentialContext, StoreRunner } from './resolve.js';

export interface WindowsBridge { powershell: string; assembly: string; cwd: string }

// Fixed program, never interpolated with configuration. The only vault operation
// is Get. Probe exits before constructing a store or enumerating credentials.
export const WINDOWS_BRIDGE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$stage = 'capability'
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.operation -ne 'probe' -and $request.operation -ne 'read') { throw 'Invalid operation' }
  $name = [System.Reflection.AssemblyName]::GetAssemblyName($request.assembly)
  if ($name.Name -ne 'gcmcore' -or $name.Version.Major -ne 2 -or $name.Version.Minor -lt 4 -or $name.Version.Minor -gt 9) { throw 'Unsupported assembly' }
  $assembly = [System.Reflection.Assembly]::LoadFrom($request.assembly)
  $framework = @($assembly.GetCustomAttributesData() | Where-Object { $_.AttributeType.FullName -eq 'System.Runtime.Versioning.TargetFrameworkAttribute' })
  if ($framework.Count -ne 1 -or -not $framework[0].ConstructorArguments[0].Value.StartsWith('.NETFramework,')) { throw 'Unsupported runtime' }
  $storeType = $assembly.GetType('GitCredentialManager.Interop.Windows.WindowsCredentialManager', $true)
  $credentialType = $assembly.GetType('GitCredentialManager.Interop.Windows.WindowsCredential', $true)
  $constructor = $storeType.GetConstructor([type[]]@([string]))
  $get = $storeType.GetMethod('Get', [type[]]@([string], [string]))
  if ($null -eq $constructor -or $null -eq $get -or $get.ReturnType.FullName -ne 'GitCredentialManager.ICredential') { throw 'Unsupported API' }
  foreach ($property in @('TargetName', 'Password')) {
    $info = $credentialType.GetProperty($property)
    if ($null -eq $info -or $info.PropertyType -ne [string]) { throw 'Unsupported result' }
  }
  if ($request.operation -eq 'probe') { [Console]::Out.Write('AVAILABLE'); exit 0 }
  $stage = 'read'
  if ($request.target -isnot [string] -or [string]::IsNullOrWhiteSpace($request.target) -or $request.target.Length -gt 32767 -or $request.target -match '[\x00-\x1f\x7f-\x9f]') { throw 'Invalid target' }
  $store = $constructor.Invoke([object[]]@($null))
  $credential = $get.Invoke($store, [object[]]@($request.target, $null))
  if ($null -eq $credential) { [Console]::Out.Write('MISSING'); exit 0 }
  if ($credential.GetType() -ne $credentialType -or -not [string]::Equals($credential.TargetName, $request.target, [StringComparison]::Ordinal)) {
    [Console]::Out.Write('MISMATCH'); exit 0
  }
  # No PowerShell pipeline/object output: only this private stdout pipe carries the selected secret.
  $password = $credential.Password
  [Console]::Out.Write('SECRET' + [char]10)
  [Console]::Out.Write($password)
} catch {
  if ($stage -eq 'capability') { [Console]::Out.Write('UNAVAILABLE') }
  else { [Console]::Out.Write('FAILED') }
  exit 0
}
`;

const inside = (root: string, candidate: string): boolean => {
  const relative = path.win32.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.win32.isAbsolute(relative);
};
async function isFile(filename: string): Promise<boolean> {
  try { await access(filename); return (await stat(filename)).isFile(); } catch { return false; }
}

/** Package-relative discovery from an explicit PATH Git; no helper config or repository DLL search. */
export async function discoverWindowsBridge(env: NodeJS.ProcessEnv, signal?: AbortSignal,
  run: StoreRunner = runCredentialStore, available = isFile,
  canonical: (filename: string) => Promise<string> = realpath,
  invocationDirectory = process.cwd()): Promise<WindowsBridge | undefined> {
  const systemRoot = environmentValue(env, 'SystemRoot', 'win32');
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) return undefined;
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!await available(powershell)) return undefined;
  const cleanEnv = childEnvironment(env, 'win32', 'credential');
  for (const entry of (environmentValue(env, 'PATH', 'win32') ?? '').split(';')) {
    const directory = entry.replace(/^"(.*)"$/, '$1');
    if (!path.win32.isAbsolute(directory)) continue;
    const candidate = path.win32.join(directory, 'git.exe');
    if (!await available(candidate)) continue;
    const git = await canonical(candidate);
    if (inside(invocationDirectory, git)) return undefined;
    // The first usable PATH Git determines the installation; do not silently use another Git.
    const execPath = (await run({ executable: git, args: ['--exec-path'], env: cleanEnv, cwd: systemRoot, signal })).trim();
    if (!path.win32.isAbsolute(execPath)) return undefined;
    const core = await canonical(execPath);
    if (path.win32.basename(core) !== 'git-core' || path.win32.basename(path.win32.dirname(core)) !== 'libexec') return undefined;
    const architectureRoot = path.win32.resolve(core, '..', '..');
    if (!['mingw64', 'mingw32', 'clangarm64'].includes(path.win32.basename(architectureRoot))) return undefined;
    const installation = path.win32.dirname(architectureRoot);
    if (!inside(installation, git) || inside(invocationDirectory, architectureRoot)) return undefined;
    const packageDirectory = path.win32.join(architectureRoot, 'bin');
    const assemblyFile = path.win32.join(packageDirectory, 'gcmcore.dll');
    if (!await available(assemblyFile) || !await available(path.win32.join(packageDirectory, 'git-credential-manager.exe'))) return undefined;
    const assembly = await canonical(assemblyFile);
    if (!inside(packageDirectory, assembly)) return undefined;
    return { powershell, assembly, cwd: systemRoot };
  }
  return undefined;
}

async function invoke(bridge: WindowsBridge, operation: 'probe' | 'read', context: CredentialContext, target?: string): Promise<string> {
  return (context.run ?? runCredentialStore)({ executable: bridge.powershell,
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_BRIDGE_SCRIPT],
    input: JSON.stringify({ operation, assembly: bridge.assembly, ...(target === undefined ? {} : { target }) }),
    cwd: bridge.cwd, env: childEnvironment(context.env ?? process.env, 'win32', 'credential'), signal: context.signal });
}

async function locate(context: CredentialContext): Promise<WindowsBridge | undefined> {
  if (context.signal?.aborted) throw new CredentialError('cancelled');
  if ((context.platform ?? process.platform) !== 'win32') return undefined;
  const env = context.env ?? process.env;
  return context.locateWindowsBridge ? context.locateWindowsBridge(env, context.signal)
    : discoverWindowsBridge(env, context.signal, context.run ?? runCredentialStore);
}

export async function windowsCapability(context: CredentialContext): Promise<{ available: boolean; reason?: string }> {
  try {
    const bridge = await locate(context);
    if (bridge && await invoke(bridge, 'probe', context) === 'AVAILABLE') return { available: true };
  } catch (error) {
    if (context.signal?.aborted || error instanceof CredentialError && error.kind === 'cancelled') throw new CredentialError('cancelled');
  }
  return { available: false, reason: 'Compatible installed GCM library / Windows PowerShell bridge unavailable or blocked. No fallback attempted.' };
}

export async function readWindowsCredential(target: string, context: CredentialContext): Promise<string> {
  try {
    const bridge = await locate(context);
    if (!bridge) throw new CredentialError('unavailable');
    const output = await invoke(bridge, 'read', context, target);
    if (output === 'MISSING') throw new CredentialError('missing');
    if (output === 'UNAVAILABLE') throw new CredentialError('unavailable');
    if (!output.startsWith('SECRET\n')) throw new CredentialError('lookup-failed');
    return output.slice(7);
  } catch (error) {
    if (context.signal?.aborted) throw new CredentialError('cancelled');
    if (error instanceof CredentialError) throw new CredentialError(error.kind);
    throw new CredentialError('lookup-failed');
  }
}
