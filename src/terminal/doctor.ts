import type { DoctorReport } from '../core/doctor.js';
import { plain } from './style.js';
import type { Style } from './style.js';

export function renderDoctor(report: DoctorReport, style: Style = plain): string {
  return [style.heading('Twiglet local diagnostics'), ...report.diagnostics.map(row =>
    row.level === 'error' ? style.error(`Error: ${row.message}`)
      : row.level === 'advisory' ? style.muted(`Note: ${row.message}`) : style.good(`OK: ${row.message}`))].join('\n') + '\n';
}
