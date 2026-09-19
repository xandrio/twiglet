import { runGit } from '../git/run.js';
import { parseDiff } from '../git/diff.js';
import type { FileChange } from '../git/diff.js';
import type { GitRunner } from './discovery.js';
import { RepositoryError } from './types.js';

export interface FilePatch { file: FileChange; before: string; after: string; lines: string[]; kind: 'text' | 'metadata' | 'binary' }

export async function listSnapshotChanges(root: string, before: string, after: string, signal?: AbortSignal, run: GitRunner = runGit): Promise<FileChange[]> {
  const result = await run(root, ['diff', '--raw', '-z', '--no-abbrev', '--no-ext-diff', '--no-textconv', '--no-relative', '--ignore-submodules=none', '--submodule=short', '--no-renames', '--find-renames=50%', '-l1000', before, after, '--'], signal);
  if (result.code !== 0) throw new RepositoryError(result.stderr.trim() || 'Cannot list snapshot changes.');
  return parseDiff(result.stdout);
}

/** Trusted captured object IDs and raw change records, independent of branch identity. */
export async function readSnapshotPatch(root: string, before: string, after: string, file: FileChange, signal?: AbortSignal, run: GitRunner = runGit): Promise<FilePatch> {
  const base = { file, before, after };
  if (file.submodule || file.beforeOid === file.afterOid) return { ...base, kind: 'metadata', lines: [] };
  const options = ['diff', '--output-indicator-new=+', '--output-indicator-old=-', '--output-indicator-context= ', '--patch', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-relative', '--word-diff=none', '--unified=3', '--inter-hunk-context=0', '--diff-algorithm=myers', '--no-indent-heuristic', '--src-prefix=a/', '--dst-prefix=b/', '--submodule=short', '--ignore-submodules=none'];
  const absent = (oid: string) => /^0+$/.test(oid);
  let args: string[];
  if (!absent(file.beforeOid) && !absent(file.afterOid)) {
    // Compare the recorded blobs, never re-detect a rename in a reduced path set.
    args = [...options, file.beforeOid, file.afterOid, '--'];
  } else {
    const name = file.path.toString('utf8');
    if (!Buffer.from(name).equals(file.path)) throw new RepositoryError('Patch unavailable: added/deleted path is not valid UTF-8. Raw path identity is preserved in the file list.');
    args = ['--literal-pathspecs', ...options, before, after, '--', name];
  }
  const result = await run(root, args, signal);
  if (result.code !== 0) throw new RepositoryError(result.stderr.trim() || 'Cannot read file patch.');
  if (result.stdout.length > 1024 * 1024) throw new RepositoryError('Patch unavailable: exceeds the 1 MiB display budget. No partial patch is shown.');
  const text = result.stdout.toString('utf8');
  if (!Buffer.from(text).equals(result.stdout)) throw new RepositoryError('Patch unavailable: content is not valid UTF-8.');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.some(line => line.startsWith('Binary files '))) return { ...base, kind: 'binary', lines: [] };
  const start = lines.findIndex(line => line.startsWith('@@ '));
  return { ...base, kind: start < 0 ? 'metadata' : 'text', lines: start < 0 ? [] : lines.slice(start) };
}
