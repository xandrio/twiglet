import type { DoctorReport } from '../core/doctor.js';
import { plain } from './style.js';
import type { Style } from './style.js';
import { safeText } from './render.js';

export function renderDoctor(report: DoctorReport, style: Style = plain): string {
  return [style.heading('Twiglet local diagnostics'), ...report.diagnostics.map(row =>
    row.level === 'error' ? style.error(`Error: ${safeText(row.message)}`)
      : row.level === 'advisory' ? style.muted(`Note: ${safeText(row.message)}`) : style.good(`OK: ${safeText(row.message)}`))].join('\n') + '\n';
}
