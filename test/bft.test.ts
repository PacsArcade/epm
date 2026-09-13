/**
 * TASK-199 (house fork) — src/core/bft.ts: house BFT stamps + fleet task ids.
 *
 * The law: a stamp is a MEASUREMENT of a block height. 144 blocks/day,
 * 28 days/month, 13 months/year; days 01–28 (day 29 never exists), months
 * 01–13. A riding height always wins over a remembered stamp; a mismatch is
 * recorded as conflict, never silently corrected. No height → Gregorian
 * conversion anywhere.
 */

import { describe, test, expect } from 'bun:test';
import { bftFromHeight, isValidBft, parseBftStamps, normalizeTaskId } from '../src/core/bft.ts';

describe('bftFromHeight (the law formula)', () => {
  test('block 963,660 → 0018.06.01 a₿ (skill reference anchor)', () => {
    expect(bftFromHeight(963660)).toBe('0018.06.01 a₿');
  });
  test('block 966,118 → 0018.06.18 a₿ (the Desk form anchor)', () => {
    expect(bftFromHeight(966118)).toBe('0018.06.18 a₿');
  });
  test('block 966,758 → 0018.06.22 a₿ (lane claim anchor)', () => {
    expect(bftFromHeight(966758)).toBe('0018.06.22 a₿');
  });
  test('block 0 → 0000.01.01 a₿ (genesis)', () => {
    expect(bftFromHeight(0)).toBe('0000.01.01 a₿');
  });
  test('rejects non-integer and negative heights (derive-or-dash)', () => {
    expect(() => bftFromHeight(-1)).toThrow();
    expect(() => bftFromHeight(1.5)).toThrow();
    expect(() => bftFromHeight(NaN)).toThrow();
  });
});

describe('isValidBft (strict 00YY.MM.DD a₿)', () => {
  test('accepts a lawful stamp', () => {
    expect(isValidBft('0018.06.18 a₿')).toBe(true);
    expect(isValidBft('0018.13.28 a₿')).toBe(true);
  });
  test('rejects day .29 — it does not exist in any month, ever', () => {
    expect(isValidBft('0018.05.29 a₿')).toBe(false);
  });
  test('rejects month .14', () => {
    expect(isValidBft('0018.14.01 a₿')).toBe(false);
  });
  test('rejects month .00 and day .00', () => {
    expect(isValidBft('0018.00.10 a₿')).toBe(false);
    expect(isValidBft('0018.06.00 a₿')).toBe(false);
  });
  test('rejects anything not matching 00YY.MM.DD a₿', () => {
    expect(isValidBft('0018.06.18')).toBe(false);
    expect(isValidBft('18.06.18 a₿')).toBe(false);
    expect(isValidBft('0018.6.18 a₿')).toBe(false);
    expect(isValidBft('0018-06-18 a₿')).toBe(false);
    expect(isValidBft('')).toBe(false);
  });
});

describe('parseBftStamps — the wild forms', () => {
  test('bare stamp', () => {
    const r = parseBftStamps('cut 0018.06.18 a₿ clean');
    expect(r.stamps).toHaveLength(1);
    expect(r.stamps[0].bft).toBe('0018.06.18 a₿');
    expect(r.stamps[0].blockHeight).toBeUndefined();
    expect(r.stamps[0].conflict).toBeUndefined();
  });

  test('Desk form: stamp + BFT time + riding height + UTC', () => {
    const r = parseBftStamps('0018.06.18 a₿ · 03:40 a₿ · ✦ 966,118 · 2026-09-08 22:33 UTC');
    expect(r.stamps).toHaveLength(1);
    const s = r.stamps[0];
    expect(s.blockHeight).toBe(966118);
    expect(s.utc).toBe('2026-09-08T22:33:00.000Z');
    // 966,118 derives exactly 0018.06.18 — a consistent stamp, no conflict.
    expect(s.bft).toBe('0018.06.18 a₿');
    expect(s.conflict).toBeUndefined();
  });

  test('riding height wins on mismatch and records conflict', () => {
    const r = parseBftStamps('0018.06.18 a₿ · 03:40 a₿ · ✦ 967,000 · 2026-09-08 22:33 UTC');
    expect(r.stamps).toHaveLength(1);
    const s = r.stamps[0];
    expect(s.conflict).toBe(true);
    // Height-derived date replaces the remembered one — never silently.
    expect(s.bft).toBe(bftFromHeight(967000));
    expect(s.bft).not.toBe('0018.06.18 a₿');
    expect(s.utc).toBe('2026-09-08T22:33:00.000Z');
  });

  test('bare block forms: (block 966,120) and block 964,950', () => {
    const r = parseBftStamps('merged (block 966,120) after review\nearlier work block 964,950 wrapped');
    expect(r.stamps).toHaveLength(2);
    expect(r.stamps[0].blockHeight).toBe(966120);
    expect(r.stamps[0].bft).toBe(bftFromHeight(966120));
    expect(r.stamps[1].blockHeight).toBe(964950);
    expect(r.stamps[1].bft).toBe(bftFromHeight(964950));
  });

  test('a height riding a stamp is not double-counted as a bare block', () => {
    const r = parseBftStamps('0018.06.18 a₿ · ✦ 966,118\n(block 966,118) again');
    expect(r.stamps).toHaveLength(1);
  });

  test('invalid stamps are rejected, not repaired', () => {
    expect(parseBftStamps('0018.05.29 a₿ never happened').stamps).toHaveLength(0);
    expect(parseBftStamps('0018.14.01 a₿ neither').stamps).toHaveLength(0);
  });

  test('a riding UTC attaches only to the stamp on its own line', () => {
    const r = parseBftStamps('0018.06.18 a₿\nnext line 2026-09-08 22:33 UTC');
    expect(r.stamps[0].utc).toBeUndefined();
  });
});

describe('parseBftStamps — fleet task ids', () => {
  test('T-196 / TASK-196 / task-196 normalize and dedupe to T-196', () => {
    const r = parseBftStamps('T-196 then TASK-196 then task-196');
    expect(r.taskIds).toEqual(['T-196']);
  });
  test('K12 / H71 / S52 normalize with dash and zero-pad', () => {
    const r = parseBftStamps('K12 H71 S52');
    expect(r.taskIds).toEqual(['H-71', 'K-12', 'S-52']);
  });
  test('inbox-name form K10-T185-T188 parses all three', () => {
    const r = parseBftStamps('K10-T185-T188-LANDED-T191-GO');
    expect(r.taskIds).toEqual(['K-10', 'T-185', 'T-188', 'T-191']);
  });
  test('sorted by prefix then number', () => {
    const r = parseBftStamps('T-200 S52 H71 K12 T-042');
    expect(r.taskIds).toEqual(['H-71', 'K-12', 'S-52', 'T-042', 'T-200']);
  });
});

describe('normalizeTaskId (CLI validation)', () => {
  test('accepts every wild form', () => {
    expect(normalizeTaskId('T-196')).toBe('T-196');
    expect(normalizeTaskId('TASK-196')).toBe('T-196');
    expect(normalizeTaskId('task-196')).toBe('T-196');
    expect(normalizeTaskId('T196')).toBe('T-196');
    expect(normalizeTaskId('T-42')).toBe('T-042');
    expect(normalizeTaskId('K12')).toBe('K-12');
    expect(normalizeTaskId('k-3')).toBe('K-03');
    expect(normalizeTaskId('H71')).toBe('H-71');
    expect(normalizeTaskId('S52')).toBe('S-52');
  });
  test('rejects garbage so callers can refuse loudly', () => {
    expect(normalizeTaskId('bogus')).toBeNull();
    expect(normalizeTaskId('T-196A')).toBeNull();
    expect(normalizeTaskId('X12')).toBeNull();
    expect(normalizeTaskId('')).toBeNull();
    expect(normalizeTaskId('966118')).toBeNull();
  });
});
