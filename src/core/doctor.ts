import { discover } from './discovery.js';
import { ConfigurationError, loadCloudSetup, resolveCloudEmail } from '../config/user.js';
import { CredentialError, credentialCapability, environmentValue, resolveCredential } from '../credentials/resolve.js';
import type { CredentialContext } from '../credentials/resolve.js';
import { withCredentialEnvironment } from '../process/environment.js';

export interface Diagnostic { level: 'ok' | 'advisory' | 'error'; message: string }
export interface DoctorReport { ok: boolean; diagnostics: Diagnostic[] }

/** Local only: no provider imports, HTTP, store writes, or automatic resolution. */
export async function readDoctor(directory: string, checkCredentials = false, context: CredentialContext = {}): Promise<DoctorReport> {
  const diagnostics: Diagnostic[] = [];
  const add = (level: Diagnostic['level'], message: string) => diagnostics.push({ level, message });
  const env = context.env ?? process.env;
  add('ok', 'Child processes use restricted environments; provider credential variables are excluded.');
  try {
    const { root } = await discover(directory, context.signal);
    const setup = await loadCloudSetup(root, env);
    if (!setup) add('advisory', 'Bitbucket Cloud: not configured for this worktree. Offline Git use needs no provider setup.');
    else {
      add('ok', 'Configuration schema accepted; literal credential fields are prohibited.');
      add('ok', 'Bitbucket Cloud: credential reference configured.');
      resolveCloudEmail(setup, env);
      add('ok', 'Bitbucket email identity available.');
      const ref = setup.tokenRef;
      add('advisory', `Credential source: ${ref.source}.`);
      if (ref.source === 'windows-credential-manager') {
        add('advisory', `Expected target: ${ref.target}`);
        add('advisory', 'Windows Credential Manager uses an optional installed GCM library bridge. Capability does not imply vault access.');
      }
      if (ref.source === 'env') {
        add('advisory', 'Environment credentials suit CI, headless use, and temporary sessions. OS storage is recommended for persistent desktop use where supported.');
        add(environmentValue(env, ref.name, context.platform) ? 'ok' : 'error', environmentValue(env, ref.name, context.platform)
          ? 'Referenced environment variable is present; value not displayed.' : 'Referenced credential environment variable is missing or empty.');
      }
      const capability = await credentialCapability(ref, context);
      add(capability.available ? 'ok' : 'error', capability.available ? 'Credential adapter available; store access and credential validity are not implied.' : capability.reason ?? 'Configured credential adapter is unavailable on this machine. No fallback attempted.');
      if (checkCredentials) {
        await withCredentialEnvironment(setup.sensitiveEnv, () => resolveCredential(ref, context));
        add('ok', 'Credential successfully resolved locally. Bitbucket authentication was not tested.');
      } else add('advisory', 'Credential not resolved. Use doctor --check-credentials to check local access; OS prompts may appear.');
    }
  } catch (error) {
    if (context.signal?.aborted) throw new CredentialError('cancelled');
    add('error', error instanceof ConfigurationError || error instanceof CredentialError ? error.message : 'Unable to inspect local repository or credential capability.');
  }
  add('ok', 'No provider/network requests performed.');
  return { ok: !diagnostics.some(row => row.level === 'error'), diagnostics };
}
