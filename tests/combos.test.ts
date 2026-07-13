import { describe, expect, it } from 'vitest';
import { expandCombos } from '../src/scraper/combos.js';
import { makeCxTask, type CxForm } from '../src/scraper/types.js';

const base: CxForm = {
  autoLogin: true,
  countryCode: '852',
  mobile: '66849591',
  password: 'x',
  tasks: [
    makeCxTask({ id: 'a', origin: 'HKG', dest: 'NRT', range: { start: '2026-07-01', end: '2026-07-01' }, dates: ['2026-07-01'] }),
    makeCxTask({ id: 'b', origin: 'HKG', dest: 'LHR', range: { start: '2026-07-01', end: '2026-07-01' }, dates: ['2026-07-01'] }),
  ],
  cabins: ['bus', 'fir'],
  adults: 1,
  intervalMin: 30,
};

describe('expandCombos', () => {
  it('produces task date × cabin combinations', () => {
    const combos = expandCombos(base);
    expect(combos).toHaveLength(4);
    expect(combos[0]).toEqual({
      origin: 'HKG',
      dest: 'NRT',
      cabin: 'bus',
      range: { start: '2026-07-01', end: '2026-07-01' },
      adults: 1,
    });
    expect(combos[3]).toMatchObject({ dest: 'LHR', cabin: 'fir' });
  });

  it('expands multiple award dates on one task', () => {
    const form: CxForm = {
      ...base,
      tasks: [
        makeCxTask({
          id: '1',
          origin: 'HKG',
          dest: 'NRT',
          range: { start: '2026-07-01', end: '2026-07-15' },
          dates: ['2026-07-01', '2026-07-15'],
        }),
      ],
      cabins: ['eco'],
    };
    const combos = expandCombos(form);
    expect(combos).toHaveLength(2);
    expect(combos[0].range).toEqual({ start: '2026-07-01', end: '2026-07-01' });
    expect(combos[1].range).toEqual({ start: '2026-07-15', end: '2026-07-15' });
  });
});
