/**
 * TASK-199 (house fork) — --task / --since-block / --until-block filters.
 *
 * Engine-parity law: the predicates live in ONE shared builder
 * (search/sql-ranking.ts buildBftTaskFilter) consumed by BOTH engines at
 * every search site (keyword, titles, keyword-chunks, vector, CJK
 * fallback), so the PGLite runs below pin the exact SQL Postgres runs.
 * The DATABASE_URL-gated engine-parity e2e covers the Postgres twin.
 *
 * Serial: mutates OPENAI_API_KEY to force the keyword-only path.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { hybridSearch } from '../src/core/search/hybrid.ts';
import { dispatchToolCall } from '../src/mcp/dispatch.ts';

const PAGE_T196 = 'inbox/lane-t196';
const PAGE_K12 = 'inbox/lane-k12';
const PAGE_PLAIN = 'inbox/lane-plain';
const PAGE_BADHEIGHT = 'inbox/lane-badheight';

async function seed(engine: PGLiteEngine) {
  await engine.putPage(PAGE_T196, {
    type: 'note',
    title: 'Lane T196',
    compiled_truth: 'Widget ledger notes for the fleet relay lane.',
    frontmatter: { bft: '0018.06.18 a₿', block_height: 966118, bft_source: 'height', task_ids: ['T-196', 'K-12'] },
  });
  await engine.putPage(PAGE_K12, {
    type: 'note',
    title: 'Lane K12',
    compiled_truth: 'Widget ledger notes from the earlier watch.',
    frontmatter: { bft: '0018.06.10 a₿', block_height: 964950, bft_source: 'height', task_ids: ['S-52'] },
  });
  await engine.putPage(PAGE_PLAIN, {
    type: 'note',
    title: 'Lane Plain',
    compiled_truth: 'Widget ledger notes with no stamps at all.',
  });
  await engine.putPage(PAGE_BADHEIGHT, {
    type: 'note',
    title: 'Lane Badheight',
    compiled_truth: 'Widget ledger notes with a hand-authored broken height.',
    frontmatter: { block_height: 'not-a-height' },
  });
  for (const slug of [PAGE_T196, PAGE_K12, PAGE_PLAIN, PAGE_BADHEIGHT]) {
    const text =
      slug === PAGE_T196 ? 'Widget ledger notes for the fleet relay lane.'
      : slug === PAGE_K12 ? 'Widget ledger notes from the earlier watch.'
      : slug === PAGE_PLAIN ? 'Widget ledger notes with no stamps at all.'
      : 'Widget ledger notes with a hand-authored broken height.';
    await engine.upsertChunks(slug, [{ chunk_index: 0, chunk_text: text, chunk_source: 'compiled_truth' }]);
  }
}

describe('BFT / task-id filters (TASK-199)', () => {
  let engine: PGLiteEngine;
  const savedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    delete process.env.OPENAI_API_KEY; // keyword-only path, no embedding calls
    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();
    await seed(engine);
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    await engine.disconnect();
  });

  test('taskId filters to pages whose task_ids contain it (keyword arm)', async () => {
    const out = await hybridSearch(engine, 'widget ledger', { taskId: 'T-196' });
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain(PAGE_T196);
    expect(slugs).not.toContain(PAGE_K12);
    expect(slugs).not.toContain(PAGE_PLAIN);
  });

  test('sinceBlock excludes lower heights and unstamped pages', async () => {
    const out = await hybridSearch(engine, 'widget ledger', { sinceBlock: 966000 });
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain(PAGE_T196);
    expect(slugs).not.toContain(PAGE_K12);
    expect(slugs).not.toContain(PAGE_PLAIN);
  });

  test('untilBlock excludes higher heights', async () => {
    const out = await hybridSearch(engine, 'widget ledger', { untilBlock: 965000 });
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain(PAGE_K12);
    expect(slugs).not.toContain(PAGE_T196);
  });

  test('a hand-authored non-numeric block_height cannot break the cast', async () => {
    const out = await hybridSearch(engine, 'widget ledger', { sinceBlock: 1 });
    const slugs = out.map((r) => r.slug);
    expect(slugs).not.toContain(PAGE_BADHEIGHT);
  });

  test('block window combines both bounds', async () => {
    const out = await hybridSearch(engine, 'widget ledger', { sinceBlock: 964000, untilBlock: 965000 });
    const slugs = out.map((r) => r.slug);
    expect(slugs).toEqual([PAGE_K12]);
  });

  test('title arm honors the same filters (page grain)', async () => {
    const out = await engine.searchTitles('Lane', { taskId: 'S-52' });
    expect(out.map((r) => r.slug)).toEqual([PAGE_K12]);
  });

  test('control: no filter returns the stamped pages too', async () => {
    const out = await hybridSearch(engine, 'widget ledger', {});
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain(PAGE_T196);
    expect(slugs).toContain(PAGE_K12);
    expect(slugs).toContain(PAGE_PLAIN);
  });

  test('getBftMetaByRefs: batched read, composite keys, tolerant parse', async () => {
    const meta = await engine.getBftMetaByRefs([
      { slug: PAGE_T196, source_id: 'default' },
      { slug: PAGE_BADHEIGHT, source_id: 'default' },
      { slug: PAGE_PLAIN, source_id: 'default' },
    ]);
    expect(meta.get(`default::${PAGE_T196}`)).toEqual({ blockHeight: 966118, taskIds: ['T-196', 'K-12'] });
    expect(meta.get(`default::${PAGE_BADHEIGHT}`)).toEqual({ blockHeight: null, taskIds: [] });
    expect(meta.has(`default::${PAGE_PLAIN}`)).toBe(false);
  });

  test('query op: --task honored end-to-end, block_height stamped', async () => {
    const result = await dispatchToolCall(engine, 'query', { query: 'widget ledger', task: 'T-196' }, {
      remote: false,
      sourceId: 'default',
    });
    expect(result.isError).toBeFalsy();
    const rows = JSON.parse(result.content[0].text) as Array<{ slug: string; block_height?: number }>;
    const slugs = rows.map((r) => r.slug);
    expect(slugs).toContain(PAGE_T196);
    expect(slugs).not.toContain(PAGE_K12);
    expect(rows.find((r) => r.slug === PAGE_T196)?.block_height).toBe(966118);
  });

  test('query op: invalid task id is rejected, never silently dropped', async () => {
    const result = await dispatchToolCall(engine, 'query', { query: 'widget ledger', task: 'bogus' }, {
      remote: false,
      sourceId: 'default',
    });
    expect(result.isError).toBeTruthy();
  });

  test('query op: inverted block window is rejected', async () => {
    const result = await dispatchToolCall(engine, 'query', { query: 'widget ledger', since_block: 967000, until_block: 966000 }, {
      remote: false,
      sourceId: 'default',
    });
    expect(result.isError).toBeTruthy();
  });
});
