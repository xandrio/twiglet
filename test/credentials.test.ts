import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect, stripVTControlCharacters } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Secret } from '../src/credentials/secret.js';
import { CredentialError, credentialCapability, resolveCredential, runCredentialStore } from '../src/credentials/resolve.js';
import { childEnvironment, reservedCredentialName, withCredentialEnvironment } from '../src/process/environment.js';
import { loadCloudSetup, resolveCloudEmail } from '../src/config/user.js';
import { readDoctor } from '../src/core/doctor.js';
import { renderDoctor } from '../src/terminal/doctor.js';
import { createStyle } from '../src/terminal/style.js';
import { repository, temp } from './helpers.js';

const fake = 'synthetic-credential-for-tests';
const envRef = { source: 'env' as const, name: 'CUSTOM_PROVIDER_CREDENTIAL' };
const macRef = { source: 'macos-keychain' as const, service: 'twiglet.bitbucket', account: 'personal' };
const linuxRef = { source: 'linux-secret-service' as const, account: 'personal' };
const safeFailure = (error: unknown) => !inspect(error).includes(fake) && error instanceof CredentialError;

test('secret wrapper resists accidental serialization and env resolution is explicit', async () => {
  const env = { CUSTOM_PROVIDER_CREDENTIAL: fake };
  const secret = await resolveCredential(envRef, { env });
  assert(secret.reveal() === fake, 'Intended credential resolved');
  for (const output of [String(secret), `${secret}`, JSON.stringify({ secret }), inspect(secret), inspect({ secret })]) {
    assert(!output.includes(fake), 'Secret must not appear in serialization');
  }
  assert(new Secret(fake).reveal() === fake, 'Explicit access is required');
  await assert.rejects(resolveCredential(envRef, { env: {} }), /missing/);
  await assert.rejects(resolveCredential(envRef, { env: { CUSTOM_PROVIDER_CREDENTIAL: '' } }), /missing/);
  for (const value of [fake + '\n', fake + '\0', 'x'.repeat(16 * 1024 + 1)]) {
    await assert.rejects(resolveCredential(envRef, { env: { CUSTOM_PROVIDER_CREDENTIAL: value } }), safeFailure);
  }
  assert((await resolveCredential(envRef, { env: { custom_provider_credential: fake }, platform: 'win32' })).reveal() === fake);
  await assert.rejects(resolveCredential(envRef, { env: { custom_provider_credential: fake }, platform: 'linux' }), /missing/);
});

test('OS adapters are optional, explicit, bounded in scope and never fall back', async () => {
  let calls = 0;
  for (const [ref, platform, executable, expectedArgs] of [
    [macRef, 'darwin', '/usr/bin/security', ['find-generic-password', '-s', macRef.service, '-a', macRef.account, '-w']],
    [linuxRef, 'linux', '/usr/bin/secret-tool', ['lookup', 'application', 'twiglet', 'account', linuxRef.account]],
  ] as const) {
    const result = await resolveCredential(ref, { platform, env: { CUSTOM_PROVIDER_CREDENTIAL: fake, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/session', NODE_OPTIONS: 'unsafe' },
      available: async file => file === executable, run: async request => {
        calls++; assert.equal(request.executable, executable); assert.deepEqual(request.args, expectedArgs);
        assert(!JSON.stringify(request).includes(fake), 'No credential inherited or supplied as an argument');
        assert.equal(request.env.NODE_OPTIONS, undefined);
        assert.equal(request.env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/session');
        return fake + '\n';
      } });
    assert(result.reveal() === fake, 'Store value preserved');
    await assert.rejects(resolveCredential(ref, { platform, env: { CUSTOM_PROVIDER_CREDENTIAL: fake }, available: async () => false,
      run: async () => { throw new Error('Must not run'); } }), /unavailable/);
    await assert.rejects(resolveCredential(ref, { platform, env: { CUSTOM_PROVIDER_CREDENTIAL: fake }, available: async () => true,
      run: async () => { throw new Error(fake); } }), safeFailure);
    await assert.rejects(resolveCredential(ref, { platform, available: async () => true, run: async () => fake + '\n\n' }), safeFailure);
  }
  assert.equal(calls, 2);
  assert.equal((await credentialCapability(macRef, { platform: 'win32', available: async () => { throw new Error('No probe'); } })).available, false);
  let probed = false;
  await resolveCredential(envRef, { env: { CUSTOM_PROVIDER_CREDENTIAL: fake }, available: async () => { probed = true; return false; } });
  assert.equal(probed, false);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(resolveCredential(macRef, { signal: abort.signal }), /cancelled/);
});

test('store runner keeps output private on errors, enforces bounds and cancellation', async () => {
  const run = (script: string, signal?: AbortSignal) => runCredentialStore({ executable: process.execPath,
    args: ['-e', script], env: childEnvironment(), signal });
  // Only synthetic values are used; assertions never dump captured secret stdout.
  const output = await run("process.stdout.write('synthetic-credential-for-tests\\n')");
  assert(output === fake + '\n', 'Private output returned only to resolver');
  await assert.rejects(run("process.stderr.write('synthetic-credential-for-tests');process.exit(1)"), safeFailure);
  await assert.rejects(run("process.stdout.write('x'.repeat(20000))"), /invalid/);
  await assert.rejects(run("process.stdout.write(Buffer.from([255]))"), /invalid/);
  const abort = new AbortController();
  const pending = run('setInterval(()=>{},1000)', abort.signal); abort.abort();
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(runCredentialStore({ executable: path.join(process.cwd(), 'nonexistent-store-helper'), args: [], env: {} }), safeFailure);
});

test('store runner deadline kills a stalled helper without exposing output', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = runCredentialStore({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], env: childEnvironment() });
  const assertion = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(15_000);
  await assertion;
});

test('child environment policy preserves execution settings but excludes secrets and injection', async () => {
  const env = { PATH: '/bin', HOME: '/home/user', XDG_CONFIG_HOME: '/config', TMPDIR: '/tmp',
    SSL_CERT_FILE: '/cert.pem', HTTPS_PROXY: 'http://proxy.invalid:8080', NO_PROXY: 'localhost', SSH_AUTH_SOCK: '/agent',
    SystemRoot: 'C:\\Windows', APPDATA: 'C:\\AppData', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/bus',
    CUSTOM_PROVIDER_CREDENTIAL: fake, AnotherProvider: fake, NODE_OPTIONS: '--require unsafe',
    LD_PRELOAD: 'unsafe', DYLD_INSERT_LIBRARIES: 'unsafe', GIT_CONFIG_COUNT: '1', GIT_DIR: 'elsewhere' };
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const child = childEnvironment(env, platform);
    for (const name of ['PATH', 'HOME', 'XDG_CONFIG_HOME', 'TMPDIR', 'SSL_CERT_FILE', 'HTTPS_PROXY', 'NO_PROXY', 'SSH_AUTH_SOCK']) assert.equal(child[name], env[name as keyof typeof env]);
    assert(!JSON.stringify(child).includes(fake), 'Provider credentials excluded');
    for (const name of ['NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'GIT_CONFIG_COUNT', 'GIT_DIR', 'DBUS_SESSION_BUS_ADDRESS']) assert.equal(child[name], undefined);
    assert.equal(child.SystemRoot, platform === 'win32' ? env.SystemRoot : undefined);
  }
  await withCredentialEnvironment(['https_proxy'], async () => {
    await Promise.resolve(); assert.equal(childEnvironment(env).HTTPS_PROXY, undefined);
  });
  assert.equal(childEnvironment(env).HTTPS_PROXY, env.HTTPS_PROXY);
  for (const name of ['Path', 'HOME', 'https_proxy', 'SSH_AUTH_SOCK', 'NODE_OPTIONS', 'TWIGLET_CONFIG']) assert(reservedCredentialName(name));
  assert(!reservedCredentialName('MY_BITBUCKET_API_TOKEN'));
  const probe = spawnSync(process.execPath, ['-e', 'process.exit(Object.keys(process.env).some(k=>/PROVIDER/i.test(k))?1:0)'],
    { env: childEnvironment(env), windowsHide: true });
  assert.equal(probe.status, 0, 'Real child receives no provider variables');
});

test('configuration normalizes legacy/new references without resolving or rewriting secrets', async t => {
  const root = await repository(t); const config = path.join(await temp(t), 'config.json');
  const env = { TWIGLET_CONFIG: config };
  const base = { version: 1, repositories: [{ path: root, bitbucketCloud: { workspace: 'team', repository: 'repo' } }] };
  const write = (auth: unknown) => writeFile(config, JSON.stringify({ ...base, bitbucketCloud: auth }));
  await write({ email: 'account@example.invalid', tokenRef: envRef });
  const setup = (await loadCloudSetup(root, env))!;
  assert.equal(resolveCloudEmail(setup, env), 'account@example.invalid');
  assert.deepEqual(setup.sensitiveEnv, [envRef.name]);
  await write({ emailEnv: 'ACCOUNT_EMAIL', tokenEnv: envRef.name });
  const legacy = (await loadCloudSetup(root, env))!;
  assert.deepEqual(legacy.tokenRef, setup.tokenRef);
  assert.deepEqual(legacy.sensitiveEnv, ['ACCOUNT_EMAIL', envRef.name]);
  for (const ref of [macRef, linuxRef]) {
    await write({ email: 'account@example.invalid', tokenRef: ref });
    assert.deepEqual((await loadCloudSetup(root, env))!.tokenRef, ref);
  }
  for (const auth of [
    { email: 'account@example.invalid', token: fake },
    { email: 'account@example.invalid', tokenRef: { source: 'env', name: envRef.name, value: fake } },
    { email: 'account@example.invalid', emailEnv: 'EMAIL', tokenEnv: 'TOKEN' },
    { email: 'account@example.invalid', tokenEnv: 'TOKEN', tokenRef: envRef },
    { email: 'account@example.invalid', tokenEnv: 'PATH' },
    { email: 'account@example.invalid', tokenRef: { source: 'command', command: fake } },
  ]) {
    await write(auth);
    await assert.rejects(loadCloudSetup(root, env), error => error instanceof Error && !inspect(error).includes(fake));
  }
});

test('doctor distinguishes configuration, adapter capability and explicit local resolution', async t => {
  const root = await repository(t); const config = path.join(await temp(t), 'config.json');
  const env = { TWIGLET_CONFIG: config, CUSTOM_PROVIDER_CREDENTIAL: fake };
  const write = (tokenRef: unknown) => writeFile(config, JSON.stringify({ version: 1,
    bitbucketCloud: { email: 'account@example.invalid', tokenRef },
    repositories: [{ path: root, bitbucketCloud: { workspace: 'team', repository: 'repo' } }] }));
  assert((await readDoctor(root, false, { env })).ok);
  await write(envRef);
  const report = await readDoctor(root, false, { env, platform: 'win32' });
  const output = renderDoctor(report);
  assert(report.ok); assert.match(output, /reference configured/); assert.match(output, /adapter available/);
  assert.match(output, /Credential not resolved/);
  assert(!output.includes(fake));
  assert.equal(stripVTControlCharacters(renderDoctor(report, createStyle(true))), output);
  const checked = await readDoctor(root, true, { env });
  assert(checked.ok); assert.match(renderDoctor(checked), /successfully resolved locally/);
  assert(!(await readDoctor(root, true, { env: { TWIGLET_CONFIG: config } })).ok);
  await write(macRef); let calls = 0;
  const context = { env, platform: 'darwin' as const, available: async () => true, run: async () => { calls++; return fake + '\n'; } };
  assert((await readDoctor(root, false, context)).ok); assert.equal(calls, 0);
  assert((await readDoctor(root, true, context)).ok); assert.equal(calls, 1);
  const unavailable = await readDoctor(root, true, { ...context, available: async () => false });
  assert(!unavailable.ok); assert.equal(calls, 1); assert(!renderDoctor(unavailable).includes(fake));
});
