/**
 * TASK-199 (house fork) — effective-date.ts: the additive `bft_utc` source.
 *
 * A Desk-form BFT stamp carries a real UTC wall-clock; frontmatter
 * inference stores it as `bft_utc`, and it leads BOTH candidate chains (a
 * measured stamp outranks even the filename-first convention). The usual
 * [1990-01-01, NOW+1y] range gate applies. A bare stamp NEVER becomes a
 * Gregorian date — no height → wall-clock conversion, derive-or-dash.
 */

import { describe, test, expect } from 'bun:test';
import { computeEffectiveDate } from '../src/core/effective-date.ts';

const NOW = new Date('2026-09-12T00:00:00Z');
const STAMP_UTC = '2026-09-08T22:33:00.000Z';

function opts(frontmatter: Record<string, unknown>, slug = 'inbox/lane-report.md') {
  return {
    slug,
    frontmatter,
    filename: 'lane-report',
    updatedAt: NOW,
    createdAt: NOW,
  };
}

describe('bft_utc source (TASK-199)', () => {
  test('bft_utc leads the default chain — beats event_date and date', () => {
    const r = computeEffectiveDate(opts({
      bft_utc: STAMP_UTC,
      event_date: '2026-01-01',
      date: '2026-02-02',
    }));
    expect(r.source).toBe('bft_utc');
    expect(r.date?.toISOString()).toBe('2026-09-08T22:33:00.000Z');
  });

  test('bft_utc leads even the filename-first prefixes (daily/, meetings/)', () => {
    const r = computeEffectiveDate({
      slug: 'daily/2026-09-01-standup',
      frontmatter: { bft_utc: STAMP_UTC },
      filename: '2026-09-01-standup',
      updatedAt: NOW,
      createdAt: NOW,
    });
    expect(r.source).toBe('bft_utc');
  });

  test('out-of-range bft_utc falls through the chain (range gate)', () => {
    const r = computeEffectiveDate(opts({
      bft_utc: '2099-01-01T00:00:00.000Z',
      date: '2026-02-02',
    }));
    expect(r.source).toBe('date');
    expect(r.date?.toISOString()).toBe('2026-02-02T00:00:00.000Z');
  });

  test('garbage bft_utc falls through the chain', () => {
    const r = computeEffectiveDate(opts({ bft_utc: 'not a date', published: '2026-03-03' }));
    expect(r.source).toBe('published');
  });

  test('a bare stamp (bft without bft_utc) keeps the existing chain', () => {
    const r = computeEffectiveDate(opts({ bft: '0018.06.18 a₿', date: '2026-02-02' }));
    expect(r.source).toBe('date');
  });

  test('no frontmatter at all still falls back to updated_at', () => {
    const r = computeEffectiveDate(opts({}));
    expect(r.source).toBe('fallback');
  });
});
