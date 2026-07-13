import type { Combo, CxForm } from './types.js';
import { taskAwardDates } from './types.js';

/** Expand tasks × cabins into one combo per discrete award departure date. */
export function expandCombos(form: CxForm): Combo[] {
  const combos: Combo[] = [];
  for (const task of form.tasks) {
    for (const date of taskAwardDates(task)) {
      for (const cabin of form.cabins) {
        combos.push({
          origin: task.origin,
          dest: task.dest,
          cabin,
          range: { start: date, end: date },
          adults: form.adults,
        });
      }
    }
  }
  return combos;
}
