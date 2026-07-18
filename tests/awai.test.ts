import { describe, expect, it } from 'vitest';
import { parseAwaiBootstrap, type AwaiGlobals } from '../src/scraper/awai.js';
import type { Combo } from '../src/scraper/types.js';

const comboFir: Combo = {
  origin: 'HKG',
  dest: 'ORD',
  cabin: 'fir',
  range: { start: '2026-11-28', end: '2026-11-28' },
  adults: 1,
};

/** Minimal slice of the saved CX HKG→ORD First results page (all waitlist / 0 award seats). */
function hkgOrdFirstWaitlistGlobals(): AwaiGlobals {
  return {
    isAwai: true,
    milesInfoMap: {
      'HKG:ORD_CX_STD_FIR': '0_0',
      'HKG:DOH:ORD_QR:QR_STD_FIR': '0_6,0_15',
      'HKG:NRT:ORD_JL:JL_STD_FIR': '0_1',
    },
    bounds: [
      {
        searchDestination: {
          originLocation: 'A_HKG',
          destinationLocation: 'A_ORD',
          originDate: Date.UTC(2026, 10, 28),
        },
        flights: [
          {
            // UI: 未有提供兌換座位 / 候補 — but R:"9" used to false-positive as open First.
            bookable: true,
            flightIdString: 'HKG:ORD_CX_STD_FIR',
            segments: [
              {
                originLocation: 'A_HKG',
                destinationLocation: 'A_ORD',
                destinationDate: Date.UTC(2026, 10, 28, 18, 0),
                flightIdentifier: {
                  marketingAirline: 'CX',
                  flightNumber: '806',
                  originDate: Date.UTC(2026, 10, 28, 11, 0),
                },
                cabins: {
                  R: { status: '9' },
                  B: { status: 'C' },
                  N: { status: '4' },
                },
              },
            ],
          },
          {
            bookable: true,
            flightIdString: 'HKG:DOH:ORD_QR:QR_STD_FIR',
            segments: [
              {
                originLocation: 'A_HKG',
                destinationLocation: 'A_DOH',
                destinationDate: Date.UTC(2026, 10, 28, 20, 0),
                flightIdentifier: {
                  marketingAirline: 'QR',
                  flightNumber: '817',
                  originDate: Date.UTC(2026, 10, 28, 10, 0),
                },
                cabins: {
                  B: { status: 'N' },
                  E: { status: '1' },
                  F: { status: 'N' },
                },
              },
              {
                originLocation: 'A_DOH',
                destinationLocation: 'A_ORD',
                destinationDate: Date.UTC(2026, 10, 29, 8, 0),
                flightIdentifier: {
                  marketingAirline: 'QR',
                  flightNumber: '725',
                  originDate: Date.UTC(2026, 10, 28, 22, 0),
                },
                cabins: {
                  B: { status: 'N' },
                  E: { status: '1' },
                },
              },
            ],
          },
          {
            bookable: false,
            flightIdString: 'HKG:NRT:ORD_JL:JL_STD_FIR',
            segments: [
              {
                originLocation: 'A_HKG',
                destinationLocation: 'A_NRT',
                flightIdentifier: {
                  marketingAirline: 'JL',
                  flightNumber: '26',
                  originDate: Date.UTC(2026, 10, 28, 9, 0),
                },
                cabins: { F: { status: 'C' }, B: { status: 'C' } },
              },
            ],
          },
        ],
      },
    ],
    tiersOutbound: [
      {
        tierCode: 'STD',
        cabinMap: [{ cabinType: 'F', miles: 170000, fareFamilyCode: 'FIRSTD' }],
      },
    ],
  };
}

describe('parseAwaiBootstrap cabin status', () => {
  it('does not treat other-cabin digit status as First seats (HKG-ORD waitlist page)', () => {
    const { scrape, flights } = parseAwaiBootstrap(hkgOrdFirstWaitlistGlobals(), comboFir);
    expect(flights).toEqual([]);
    expect(scrape.depart.every(c => !c.available)).toBe(true);
  });

  it('keeps First open when F status is 1-9 and milesInfoMap agrees', () => {
    const raw = hkgOrdFirstWaitlistGlobals();
    raw.milesInfoMap = { 'HKG:ORD_CX_STD_FIR': '2_0' };
    raw.bounds![0].flights = [
      {
        bookable: true,
        flightIdString: 'HKG:ORD_CX_STD_FIR',
        segments: [
          {
            originLocation: 'A_HKG',
            destinationLocation: 'A_ORD',
            destinationDate: Date.UTC(2026, 10, 28, 18, 0),
            flightIdentifier: {
              marketingAirline: 'CX',
              flightNumber: '806',
              originDate: Date.UTC(2026, 10, 28, 11, 0),
            },
            cabins: {
              F: { status: '2' },
              B: { status: 'C' },
              R: { status: '9' },
            },
          },
        ],
      },
    ];
    const { scrape, flights } = parseAwaiBootstrap(raw, comboFir);
    expect(flights).toHaveLength(1);
    expect(flights[0].flightNo).toBe('CX806');
    expect(flights[0].seatsLeft).toBe(2);
    expect(flights[0].full).toBe(false);
    expect(scrape.depart[0]?.available).toBe(true);
  });

  it('closes First when F looks open but milesInfoMap is 0', () => {
    const raw = hkgOrdFirstWaitlistGlobals();
    raw.milesInfoMap = { 'HKG:ORD_CX_STD_FIR': '0_0' };
    raw.bounds![0].flights = [
      {
        bookable: true,
        flightIdString: 'HKG:ORD_CX_STD_FIR',
        segments: [
          {
            originLocation: 'A_HKG',
            destinationLocation: 'A_ORD',
            flightIdentifier: {
              marketingAirline: 'CX',
              flightNumber: '806',
              originDate: Date.UTC(2026, 10, 28, 11, 0),
            },
            cabins: { F: { status: '3' } },
          },
        ],
      },
    ];
    const { flights, scrape } = parseAwaiBootstrap(raw, comboFir);
    expect(flights).toEqual([]);
    expect(scrape.depart[0]?.available).toBe(false);
  });

  it('uses Business cabin letter B/C, not Economy E', () => {
    const raw: AwaiGlobals = {
      isAwai: true,
      bounds: [
        {
          searchDestination: {
            originLocation: 'A_HKG',
            destinationLocation: 'A_NRT',
            originDate: Date.UTC(2026, 7, 1),
          },
          flights: [
            {
              bookable: true,
              flightIdString: 'HKG:NRT_CX_STD_BUS',
              segments: [
                {
                  originLocation: 'A_HKG',
                  destinationLocation: 'A_NRT',
                  flightIdentifier: {
                    marketingAirline: 'CX',
                    flightNumber: '500',
                    originDate: Date.UTC(2026, 7, 1, 10, 0),
                  },
                  cabins: {
                    E: { status: '9' },
                    B: { status: 'C' },
                    F: { status: '1' },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const bus: Combo = { ...comboFir, dest: 'NRT', cabin: 'bus', range: { start: '2026-08-01', end: '2026-08-01' } };
    const { flights } = parseAwaiBootstrap(raw, bus);
    expect(flights).toEqual([]);
  });
});
