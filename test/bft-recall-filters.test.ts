/**
 * TASK-199 (house fork) — `gbrain recall --task/--since-block/--until-block`.
 *
 * Recall's hand-rolled flag parser SKIPS unknown flags silently
 * (recall.ts:137), so these flags are parsed explicitly and validated
 * loudly: a bad task id or block height exits 2, and thin-client mode
 * refuses the flags outright — a filter is honored or rejected, never
 * silently dropped. The filter post-filters fact rows by their SOURCE
 * PAGE's BFT frontmatter (facts.source_markdown_slug → pages.frontmatter),
 * after-LIMIT like --grep.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, spyOn } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { runRecall } from '../src/commands/recall.ts';

const PAGE_HI = 'inbox/lane-hi';
const PAGE_LO = 'inbox/lane-lo';

let engine: PGLiteEngine;
const origWrite = process.stdout.write.bind(process.stdout);
let captured = '';

async function insertFactForPage(fact: string, slug: string) {
  await engine.insertFact({ fact, kind: 'fact', entity_slug: 'bft-recall-test', source: 'test' }, { source_id: 'default' });
  await engine.executeRaw(
    `UPDATE facts SET source_markdown_slug = $1 WHERE fact = $2 AND source_id = 'default'`,
    [slug, fact],
  );
}

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();

  await engine.putPage(PAGE_HI, {
    type: 'note',
    title: 'Lane Hi',
    compiled_truth: 'high lane',
    frontmatter: { bft: '0018.06.18 a₿', block_height: 966118, bft_source: 'height', task_ids: ['T-196'] },
  });
  await engine.putPage(PAGE_LO, {
    type: 'note',
    title: 'Lane Lo',
    compiled_truth: 'low lane',
    frontmatter: { bft: '0018.06.10 a₿', block_height: 964950, bft_source: 'height', task_ids: ['K-12'] },
  });

  await insertFactForPage('the relay lane landed clean', PAGE_HI);
  await insertFactForPage('the earlier watch wrapped', PAGE_LO);
  await engine.insertFact({ fact: 'a db-only note with no source page', kind: 'fact', entity_slug: 'bft-recall-test', source: 'test' }, { source_id: 'default' });
});

afterAll(async () => {
  await engine.disconnect();
  process.stdout.write = origWrite;
});

beforeEach(() => {
  captured = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
});

describe('recall BFT filters (TASK-199)', () => {
  test('--task T-196 keeps only facts from pages carrying the id', async () => {
    await runRecall(engine, ['--task', 'T-196', '--json']);
    const payload = JSON.parse(captured) as { facts: Array<{ fact: string }> };
    const texts = payload.facts.map((f) => f.fact);
    expect(texts).toContain('the relay lane landed clean');
    expect(texts).not.toContain('the earlier watch wrapped');
    expect(texts).not.toContain('a db-only note with no source page');
  });

  test('--task normalizes wild forms (task-196, K12)', async () => {
    await runRecall(engine, ['--task', 'task-196', '--json']);
    expect(JSON.parse(captured).facts.map((f: { fact: string }) => f.fact)).toContain('the relay lane landed clean');
    captured = '';
    await runRecall(engine, ['--task', 'K12', '--json']);
    expect(JSON.parse(captured).facts.map((f: { fact: string }) => f.fact)).toContain('the earlier watch wrapped');
  });

  test('--since-block excludes lower heights and unstamped pages', async () => {
    await runRecall(engine, ['--since-block', '966000', '--json']);
    const texts = JSON.parse(captured).facts.map((f: { fact: string }) => f.fact);
    expect(texts).toContain('the relay lane landed clean');
    expect(texts).not.toContain('the earlier watch wrapped');
    expect(texts).not.toContain('a db-only note with no source page');
  });

  test('--until-block excludes higher heights', async () => {
    await runRecall(engine, ['--until-block', '965000', '--json']);
    const texts = JSON.parse(captured).facts.map((f: { fact: string }) => f.fact);
    expect(texts).toContain('the earlier watch wrapped');
    expect(texts).not.toContain('the relay lane landed clean');
  });

  test('invalid --task exits 2 loudly (never silently dropped)', async () => {
    const errSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    try {
      await expect(runRecall(engine, ['--task', 'bogus'])).rejects.toThrow('EXIT:2');
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('malformed --since-block exits 2 loudly', async () => {
    const errSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    try {
      await expect(runRecall(engine, ['--since-block', 'nine-six-six'])).rejects.toThrow('EXIT:2');
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('inverted block window exits 2', async () => {
    const errSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    try {
      await expect(runRecall(engine, ['--since-block', '967000', '--until-block', '966000'])).rejects.toThrow('EXIT:2');
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
