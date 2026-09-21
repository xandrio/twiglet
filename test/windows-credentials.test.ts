import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { discoverWindowsBridge, WINDOWS_BRIDGE_SCRIPT } from '../src/credentials/windows.js';
import { credentialCapability, resolveCredential, runCredentialStore, CredentialError } from '../src/credentials/resolve.js';
import type { CredentialContext, StoreRequest } from '../src/credentials/resolve.js';
import { childEnvironment } from '../src/process/environment.js';
import { loadCloudSetup } from '../src/config/user.js';
import { readDoctor } from '../src/core/doctor.js';
import { renderDoctor } from '../src/terminal/doctor.js';
import { repository, temp } from './helpers.js';

const ref = { source: 'windows-credential-manager' as const, target: 'Twiglet/Bitbucket/test é " $value' };
const bridge = { powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  assembly: 'D:\\Tools\\Git\\mingw64\\bin\\gcmcore.dll', cwd: 'C:\\Windows' };
const fake = 'synthetic-windows-test-token';
const context: CredentialContext = { platform: 'win32', env: { SystemRoot: 'C:\\Windows', CUSTOM_PROVIDER_TOKEN: fake, GCM_TRACE_SECRETS: 'true', NODE_OPTIONS: 'unsafe' },
  locateWindowsBridge: async () => bridge };

test('Windows capability probes the bridge without retrieving a credential', async () => {
  let calls = 0;
  const capability = await credentialCapability(ref, { ...context, run: async request => {
    calls++; const payload = JSON.parse(request.input!);
    assert.equal(payload.operation, 'probe'); assert.equal(payload.target, undefined);
    assert.equal(payload.assembly, bridge.assembly);
    assert.equal(request.executable, bridge.powershell);
    assert.deepEqual(request.args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
    assert.equal(request.args[4], WINDOWS_BRIDGE_SCRIPT);
    assert.equal(request.cwd, bridge.cwd);
    assert(!JSON.stringify(request).includes(fake), 'No secret in environment, arguments, or request');
    assert.equal(request.env.GCM_TRACE_SECRETS, undefined); assert.equal(request.env.NODE_OPTIONS, undefined);
    return 'AVAILABLE';
  } });
  assert(capability.available); assert.equal(calls, 1);
  for (const platform of ['linux', 'darwin'] as const) {
    assert(!(await credentialCapability(ref, { platform, locateWindowsBridge: async () => { throw new Error('Must not locate'); } })).available);
  }
  for (const output of ['UNAVAILABLE', 'garbage', 'AVAILABLE\n']) {
    assert(!(await credentialCapability(ref, { ...context, run: async () => output })).available);
  }
});

test('Windows resolution transports target as data, preserves the secret and has no fallback', async () => {
  let calls = 0;
  const resolved = await resolveCredential(ref, { ...context, run: async request => {
    calls++; assert.equal(JSON.parse(request.input!).operation, 'read');
    assert.equal(JSON.parse(request.input!).target, ref.target);
    assert(!request.args.join(' ').includes(ref.target), 'Target cannot inject PowerShell source');
    return 'SECRET\n' + fake;
  } });
  assert.equal(calls, 1); assert(resolved.reveal() === fake, 'Only selected secret resolved');
  assert(!inspect(resolved).includes(fake)); assert(!JSON.stringify(resolved).includes(fake));
  for (const [output, kind] of [['MISSING', 'missing'], ['UNAVAILABLE', 'unavailable'], ['FAILED', 'lookup-failed'],
    ['MISMATCH', 'lookup-failed'], ['SECRET\n', 'missing'], ['SECRET\n' + fake + '\n', 'invalid'], [fake, 'lookup-failed']] as const) {
    await assert.rejects(resolveCredential(ref, { ...context, run: async () => output }), error =>
      error instanceof CredentialError && error.kind === kind && !inspect(error).includes(fake));
  }
  await assert.rejects(resolveCredential(ref, { ...context, locateWindowsBridge: async () => undefined,
    run: async () => { throw new Error('Must not invoke'); } }), /unavailable/);
  await assert.rejects(resolveCredential(ref, { ...context, run: async () => { throw new Error(fake); } }), error =>
    error instanceof CredentialError && !inspect(error).includes(fake));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(resolveCredential(ref, { ...context, signal: abort.signal }), /cancelled/);
});

test('Windows discovery follows the selected Git installation and rejects unsafe or unsupported layouts', async () => {
  const env = { SystemRoot: 'C:\\Windows', PATH: '.;relative;D:\\Tools\\Git\\cmd', PROVIDER_TOKEN: fake };
  const files = new Set([bridge.powershell, 'D:\\Tools\\Git\\cmd\\git.exe', bridge.assembly,
    'D:\\Tools\\Git\\mingw64\\bin\\git-credential-manager.exe']);
  const available = async (filename: string) => files.has(filename);
  const canonical = async (filename: string) => filename;
  const run = async (request: StoreRequest) => {
    assert.equal(request.executable, 'D:\\Tools\\Git\\cmd\\git.exe');
    assert.deepEqual(request.args, ['--exec-path']); assert.equal(request.cwd, 'C:\\Windows');
    assert(!JSON.stringify(request).includes(fake)); return 'D:/Tools/Git/mingw64/libexec/git-core\n';
  };
  assert.deepEqual(await discoverWindowsBridge(env, undefined, run, available, canonical, 'C:\\work\\repo'), bridge);
  assert.equal(await discoverWindowsBridge(env, undefined, run, async () => false, canonical), undefined);
  assert.equal(await discoverWindowsBridge(env, undefined, async () => 'C:/evil/libexec/git-core', available, canonical), undefined);
  assert.equal(await discoverWindowsBridge(env, undefined, run, available,
    async filename => filename === bridge.assembly ? 'C:\\work\\evil.dll' : filename), undefined);
  assert.equal(await discoverWindowsBridge(env, undefined, run, available, canonical, 'D:\\Tools\\Git'), undefined);
  files.delete(bridge.assembly);
  assert.equal(await discoverWindowsBridge(env, undefined, run, available, canonical), undefined);
});

test('store runner sends UTF-8 stdin privately and does not use a shell', async () => {
  const target = 'Twiglet/é/";not-code';
  const output = await runCredentialStore({ executable: process.execPath, args: ['-e',
    `let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(s).target));`],
    input: JSON.stringify({ target }), env: childEnvironment(), cwd: process.cwd() });
  assert.equal(output, target);
});

test('Windows config and doctor show targets but retrieve only on explicit check', async t => {
  const root = await repository(t); const config = path.join(await temp(t), 'config.json');
  const env = { ...context.env, TWIGLET_CONFIG: config };
  const write = (tokenRef: unknown) => writeFile(config, JSON.stringify({ version: 1,
    bitbucketCloud: { email: 'account@example.invalid', tokenRef },
    repositories: [{ path: root, bitbucketCloud: { workspace: 'team', repository: 'repo' } }] }));
  await write(ref);
  assert.deepEqual((await loadCloudSetup(root, env))!.tokenRef, ref);
  const actions: string[] = [];
  const run = async (request: StoreRequest) => {
    const action = JSON.parse(request.input!).operation; actions.push(action);
    return action === 'probe' ? 'AVAILABLE' : 'SECRET\n' + fake;
  };
  const report = await readDoctor(root, false, { ...context, env, run });
  assert(report.ok); assert.deepEqual(actions, ['probe']);
  assert(renderDoctor(report).includes(ref.target)); assert.match(renderDoctor(report), /Credential not resolved/);
  const checked = await readDoctor(root, true, { ...context, env, run });
  assert(checked.ok); assert.deepEqual(actions, ['probe', 'probe', 'read']);
  assert(!renderDoctor(checked).includes(fake));
  const unavailable = await readDoctor(root, true, { ...context, env, run: async () => 'UNAVAILABLE' });
  assert(!unavailable.ok); assert.match(renderDoctor(unavailable), /unavailable/);
  for (const target of ['', ' ', 'name\npassword=value', 'name\x1b', 'name\x85', 'x'.repeat(32768)]) {
    await write({ source: ref.source, target });
    await assert.rejects(loadCloudSetup(root, env), /Invalid/);
  }
  await write({ ...ref, password: fake });
  await assert.rejects(loadCloudSetup(root, env), error => error instanceof Error && !inspect(error).includes(fake));
  assert.match(renderDoctor({ ok: true, diagnostics: [{ level: 'advisory', message: 'Target: a\u202eb' }] }), /a\\u202eb/);
});
