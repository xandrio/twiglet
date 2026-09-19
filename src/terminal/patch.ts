import type { Comparison } from '../core/comparison.js';
import type { FilePatch } from '../core/changes.js';
import { displayPath, safeText } from './render.js';
import { plain } from './style.js';
import type { Style } from './style.js';

export function renderPatch(comparison: Comparison, view: 'tips' | 'since-base', patch: FilePatch, style: Style = plain, page?: number): string {
  const { file } = patch;
  const lines = [style.heading(view === 'tips' ? 'File patch: A tip → B tip' : 'File patch: merge base → B tip'),
    `A (reference): ${style.ref(safeText(comparison.a.ref))} ${style.hash(comparison.a.oid)}`,
    `B (inspected): ${style.ref(safeText(comparison.b.ref))} ${style.hash(comparison.b.oid)}`,
    `Before: ${style.hash(patch.before)}`, `After: ${style.hash(patch.after)}`,
    `File: ${file.status} ${file.originalPath ? displayPath(file.originalPath) + ' -> ' : ''}${displayPath(file.path)}`,
    `Modes: ${file.beforeMode} → ${file.afterMode}`,
    `Objects: ${style.hash(file.beforeOid)} → ${style.hash(file.afterOid)}`];
  if (file.similarity !== undefined) lines.push(style.muted(`Rename similarity: ${file.similarity}%`));
  lines.push(style.muted('Committed snapshots only; inspection output, not an apply-ready patch.'), '');
  if (patch.kind === 'binary') lines.push('Binary content differs; no binary payload is displayed.');
  else if (patch.kind === 'metadata') lines.push(file.submodule ? 'Submodule pointer/type change; submodule contents are not inspected.' : 'Metadata-only change; no content hunks.');
  else {
    const start = page === undefined ? 0 : page * 80;
    for (const line of patch.lines.slice(start, page === undefined ? undefined : start + 80)) {
      const text = safeText(line);
      lines.push(line.startsWith('@@ ') ? style.ref(text) : line.startsWith('+') ? style.good(text) : line.startsWith('-') ? style.warning(text) : text);
    }
    if (page !== undefined) lines.push('', style.muted(`Patch lines ${start + 1}–${Math.min(start + 80, patch.lines.length)} of ${patch.lines.length}.`));
  }
  return lines.join('\n') + '\n';
}
