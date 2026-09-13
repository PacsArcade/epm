/**
 * TASK-199 (house fork) — frontmatter inference emits BFT fields.
 *
 * One additive rule on top of the existing chain: content carrying house
 * stamps / block heights / fleet task ids gains `bft`, `block_height`,
 * `bft_source`, `bft_conflict`, `bft_utc`, `task_ids` (and `date` ONLY when
 * a UTC wall-clock rides the stamp). Existing laws hold: files with
 * frontmatter are skipped; every emitted value is a plain YAML scalar/array
 * (data-only frontmatter at 0.50); no height → Gregorian conversion.
 */

import { describe, test, expect } from 'bun:test';
import {
  inferFrontmatter,
  serializeFrontmatter,
  applyInference,
} from '../src/core/frontmatter-inference.ts';
import { parseMarkdown } from '../src/core/markdown.ts';

const DESK = '# Lane report\n\nCut 0018.06.18 a₿ · 03:40 a₿ · ✦ 966,118 · 2026-09-08 22:33 UTC clean.\n';
const BARE_STAMP = '# Note\n\nWrapped 0018.06.18 a₿ with T-196 aboard.\n';

describe('inferFrontmatter — BFT fields', () => {
  test('Desk form: height wins, UTC rides into date + bft_utc', () => {
    const fm = inferFrontmatter('inbox/lane.md', DESK);
    expect(fm.skipped).toBeUndefined();
    expect(fm.bft).toBe('0018.06.18 a₿');
    expect(fm.block_height).toBe(966118);
    expect(fm.bft_source).toBe('height');
    expect(fm.bft_conflict).toBeUndefined();
    expect(fm.bft_utc).toBe('2026-09-08T22:33:00.000Z');
    expect(fm.date).toBe('2026-09-08T22:33:00.000Z');
  });

  test('bare stamp: source stamp, no height, NO date (derive-or-dash)', () => {
    const fm = inferFrontmatter('inbox/note.md', BARE_STAMP);
    expect(fm.bft).toBe('0018.06.18 a₿');
    expect(fm.bft_source).toBe('stamp');
    expect(fm.block_height).toBeUndefined();
    expect(fm.bft_utc).toBeUndefined();
    expect(fm.date).toBeUndefined();
    expect(fm.task_ids).toEqual(['T-196']);
  });

  test('bare block mention derives the stamp', () => {
    const fm = inferFrontmatter('inbox/note.md', '# Note\n\nmerged (block 966,120)\n');
    expect(fm.bft).toBe('0018.06.18 a₿');
    expect(fm.block_height).toBe(966120);
    expect(fm.bft_source).toBe('height');
  });

  test('conflict: height wins, bft_conflict recorded', () => {
    const fm = inferFrontmatter(
      'inbox/note.md',
      '# Note\n\n0018.06.18 a₿ · 03:40 a₿ · ✦ 967,000 · 2026-09-08 22:33 UTC\n',
    );
    expect(fm.bft).toBe('0018.06.24 a₿');
    expect(fm.bft_conflict).toBe(true);
    expect(fm.bft_source).toBe('height');
  });

  test('max height seen wins across multiple mentions', () => {
    const fm = inferFrontmatter(
      'inbox/note.md',
      '# Note\n\nstarted block 964,950 then landed (block 966,120)\n',
    );
    expect(fm.block_height).toBe(966120);
    expect(fm.bft).toBe('0018.06.18 a₿');
  });

  test('task ids normalize and sort', () => {
    const fm = inferFrontmatter('inbox/note.md', '# Note\n\nT-196 rides with K12, H71, S52 and task-200.\n');
    expect(fm.task_ids).toEqual(['H-71', 'K-12', 'S-52', 'T-196', 'T-200']);
  });

  test('a filename date still applies when no UTC rides', () => {
    const fm = inferFrontmatter('daily/2026-09-08-note.md', BARE_STAMP);
    expect(fm.date).toBe('2026-09-08');
    expect(fm.bft_utc).toBeUndefined();
  });

  test('files with frontmatter stay untouched (existing law)', () => {
    const fm = inferFrontmatter('inbox/note.md', `---\ntitle: Mine\n---\n${DESK}`);
    expect(fm.skipped).toBe(true);
    expect(fm.bft).toBeUndefined();
  });

  test('invalid stamps emit nothing', () => {
    const fm = inferFrontmatter('inbox/note.md', '# Note\n\n0018.05.29 a₿ is not a date.\n');
    expect(fm.bft).toBeUndefined();
    expect(fm.block_height).toBeUndefined();
  });
});

describe('serializeFrontmatter — data-only YAML discipline', () => {
  test('BFT fields serialize as plain scalars/arrays and round-trip', () => {
    const fm = inferFrontmatter('inbox/lane.md', DESK + '\nT-196 K12\n');
    const yaml = serializeFrontmatter(fm);
    expect(yaml).toContain('bft: "0018.06.18 a₿"');
    expect(yaml).toContain('block_height: 966118');
    expect(yaml).toContain('bft_source: height');
    expect(yaml).toContain('bft_utc: "2026-09-08T22:33:00.000Z"');
    expect(yaml).toContain("task_ids: ['K-12', 'T-196']");
    // The whole document must parse under the 0.50 data-only frontmatter reader.
    const parsed = parseMarkdown(yaml + '\nbody\n', 'lane.md');
    expect(parsed.frontmatter.bft).toBe('0018.06.18 a₿');
    expect(parsed.frontmatter.block_height).toBe(966118);
    expect(parsed.frontmatter.bft_source).toBe('height');
    expect(parsed.frontmatter.task_ids).toEqual(['K-12', 'T-196']);
  });

  test('bft_conflict emits only when true', () => {
    const conflict = inferFrontmatter('inbox/note.md', '# N\n\n0018.06.18 a₿ · ✦ 967,000\n');
    expect(serializeFrontmatter(conflict)).toContain('bft_conflict: true');
    const clean = inferFrontmatter('inbox/note.md', BARE_STAMP);
    expect(serializeFrontmatter(clean)).not.toContain('bft_conflict');
  });

  test('applyInference prepends BFT frontmatter for bare files', () => {
    const { content, inferred } = applyInference('inbox/lane.md', DESK);
    expect(inferred.skipped).toBeUndefined();
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('block_height: 966118');
  });
});
