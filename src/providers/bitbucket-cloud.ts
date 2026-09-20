import type { CloudSetup } from '../config/user.js';

/** tip preserves the API hash, which may be a 12-character abbreviation. */
export interface PrSide { repository: string | null; branch: string | null; tip: string | null }
export interface CloudPr { id: number; title: string; state: string; url: string; source: PrSide; destination: PrSide; observedAt: string }
export interface PrObservation { prs: CloudPr[]; complete: boolean; observedAt: string; message?: string }
export type ProviderFailure = 'authentication' | 'access' | 'rate-limit' | 'network' | 'invalid-response';
export class ProviderError extends Error { constructor(public kind: ProviderFailure, message: string) { super(message); } }
export type HttpTransport = typeof fetch;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderError('invalid-response', 'Bitbucket returned an invalid response.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw new ProviderError('invalid-response', 'Bitbucket returned an invalid response.');
  return value;
}
function side(value: unknown): PrSide {
  const data = record(value);
  const nullable = (value: unknown, key: string) => value == null ? null : text(record(value)[key]);
  const tip = nullable(data.commit, 'hash');
  if (tip !== null && (![12, 40, 64].includes(tip.length) || /[^0-9a-f]/.test(tip))) throw new ProviderError('invalid-response', 'Bitbucket returned an invalid commit ID.');
  return { repository: nullable(data.repository, 'full_name'), branch: nullable(data.branch, 'name'), tip };
}

/** One bounded, read-only observation. Production origin cannot be configured. */
export async function observePullRequests(setup: CloudSetup, branch: string, signal?: AbortSignal, transport: HttpTransport = fetch): Promise<PrObservation> {
  const repository = `${setup.mapping.workspace}/${setup.mapping.repository}`;
  const endpoint = `/2.0/repositories/${encodeURIComponent(setup.mapping.workspace)}/${encodeURIComponent(setup.mapping.repository)}/pullrequests`;
  let url = new URL(`https://api.bitbucket.org${endpoint}`);
  url.searchParams.set('q', `source.branch.name = ${JSON.stringify(branch)}`);
  for (const state of ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']) url.searchParams.append('state', state);
  url.searchParams.set('pagelen', '50');
  const authorization = `Basic ${Buffer.from(`${setup.email}:${setup.token}`).toString('base64')}`;
  const redact = (value: string) => [authorization, authorization.slice(6), setup.token, setup.email]
    .reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value);
  const deadline = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const prs: CloudPr[] = [];
  const seenPages = new Set<string>(); const seenPrs = new Set<number>();
  let observedAt = ''; let unresolved = false;
  for (let page = 0; page < 10; page++) {
    if (url.origin !== 'https://api.bitbucket.org' || url.pathname !== endpoint || url.username || url.password || url.hash || seenPages.has(url.href)) {
      throw new ProviderError('invalid-response', 'Bitbucket returned an unsafe or repeated pagination URL.');
    }
    seenPages.add(url.href);
    let response: Response; let data: Record<string, unknown>;
    try {
      requestSignal.throwIfAborted();
      response = await transport(url, { method: 'GET', headers: { Authorization: authorization, Accept: 'application/json' }, redirect: 'error', signal: requestSignal });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new ProviderError('authentication', 'Bitbucket authentication failed. Check API-token credentials.');
        if (response.status === 403 || response.status === 404) throw new ProviderError('access', 'Bitbucket repository is inaccessible or unavailable. Check mapping, permissions and token scopes.');
        if (response.status === 429) throw new ProviderError('rate-limit', 'Bitbucket rate limit reached. Try again later.');
        throw new ProviderError('network', `Bitbucket request failed (HTTP ${response.status}).`);
      }
      if (!response.body) throw new ProviderError('invalid-response', 'Bitbucket returned an empty response.');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          requestSignal.throwIfAborted();
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > 1024 * 1024) throw new ProviderError('invalid-response', 'Bitbucket response exceeds the 1 MiB page limit.');
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      try { data = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { throw new ProviderError('invalid-response', 'Bitbucket returned invalid JSON data.'); }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('network', deadline.aborted ? 'Bitbucket check timed out after 30 seconds.' : 'Bitbucket network request failed.');
    }
    observedAt = new Date().toISOString();
    if (!Array.isArray(data.values) || data.values.length > 50) throw new ProviderError('invalid-response', 'Bitbucket returned an invalid PR page.');
    for (const raw of data.values) {
      const pr = record(raw); const source = side(pr.source); const destination = side(pr.destination);
      if (source.branch === null) { unresolved = true; continue; }
      if (source.branch !== branch) continue;
      if (!source.repository) { unresolved = true; continue; }
      if (source.repository.toLowerCase() !== repository.toLowerCase()) continue;
      if (destination.repository !== null && destination.repository.toLowerCase() !== repository.toLowerCase()) { unresolved = true; continue; }
      if (!Number.isSafeInteger(pr.id) || Number(pr.id) <= 0) throw new ProviderError('invalid-response', 'Bitbucket returned an invalid PR identity.');
      const id = Number(pr.id);
      if (seenPrs.has(id)) { unresolved = true; continue; }
      seenPrs.add(id);
      const html = text(record(record(pr.links).html).href);
      let link: URL;
      try { link = new URL(html); } catch { throw new ProviderError('invalid-response', 'Bitbucket returned an invalid PR URL.'); }
      if (link.origin !== 'https://bitbucket.org' || link.username || link.password) throw new ProviderError('invalid-response', 'Bitbucket returned an invalid PR URL.');
      const cleanSide = (value: PrSide): PrSide => ({ repository: value.repository && redact(value.repository), branch: value.branch && redact(value.branch), tip: value.tip && redact(value.tip) });
      prs.push({ id, title: redact(text(pr.title)), state: redact(text(pr.state)), url: redact(html), source: cleanSide(source), destination: cleanSide(destination), observedAt });
    }
    if (!data.next) return { prs, complete: !unresolved, observedAt, ...(unresolved ? { message: 'Some matching PR identities could not be established; the search is incomplete.' } : {}) };
    try { url = new URL(text(data.next)); } catch { throw new ProviderError('invalid-response', 'Bitbucket returned an invalid pagination URL.'); }
  }
  return { prs, complete: false, observedAt, message: 'Search stopped at the 10-page limit; additional matches may exist.' };
}
