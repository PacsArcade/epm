/**
 * BFT — Bitcoin Federated Time (house fork, TASK-199).
 *
 * Pure parsing + derivation for house BFT stamps and fleet task ids. No DB,
 * no I/O, no wall-clock: a stamp is a MEASUREMENT of a block height, and the
 * only conversion this module performs is height → BFT calendar date (the
 * law's own formula). There is NO height → Gregorian conversion here, ever —
 * derive-or-dash.
 *
 * The calendar (house law, `bft` skill):
 *   144 blocks = 1 day · 28 days = 1 month · 13 months = 1 year (364 days)
 *   day_of_epoch = h // 144
 *   year  = day_of_epoch // 364
 *   doy   = day_of_epoch % 364
 *   month = doy // 28 + 1     (1..13)
 *   day   = doy % 28 + 1      (1..28 — day 29 does not exist, ever)
 *
 * Stamp forms that parse (all observed in the wild across the fleet):
 *   `0018.06.18 a₿`                        — bare stamp
 *   `0018.06.18 a₿ · 03:40 a₿ · ✦ 966,118 · 2026-09-08 22:33 UTC`
 *                                          — Desk form: stamp + BFT time +
 *                                            riding height + UTC wall-clock
 *   `(block 966,120)` / `block 964,950`    — bare height (derives a stamp)
 *   Task ids: T-196, TASK-196, task-196, K12, H71, S52
 *     (normalized to T-NNN / K-NN / H-NN / S-NN)
 *
 * Rejections: `.29` days, month `.14`, anything not matching `00YY.MM.DD a₿`.
 * An invalid stamp is not a stamp — it is skipped, never repaired.
 *
 * Conflict law: when a height rides beside a stamp, the HEIGHT WINS (the
 * stamp is a measurement of the height; a fresher measurement outranks the
 * remembered date). The emitted `bft` is the height-derived date and the
 * disagreement is recorded as `conflict: true` — never silently corrected.
 */

const BLOCKS_PER_DAY = 144;
const DAYS_PER_MONTH = 28;
const DAYS_PER_YEAR = 364; // 13 × 28

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export interface BftStamp {
  /** Normalized `00YY.MM.DD a₿`. When a height rides (or stands alone), this
      is the height-derived date — the height wins. */
  bft: string;
  /** Block height seen beside the stamp (or in a bare `block N` mention). */
  blockHeight?: number;
  /** ISO-8601 UTC wall-clock riding the stamp (Desk form only). */
  utc?: string;
  /** Character offset in the source text. */
  index: number;
  /** True when the stamp text disagreed with its riding height. */
  conflict?: boolean;
}

export interface BftParseResult {
  stamps: BftStamp[];
  /** Sorted unique, normalized: T-NNN / K-NN / H-NN / S-NN. */
  taskIds: string[];
}

/**
 * The law's formula: block height → `00YY.MM.DD a₿`.
 * Month lands 1..13 and day 1..28 BY CONSTRUCTION (the mods bound them);
 * the explicit check is the belt-and-suspenders the law asks for. Throws on
 * a non-integer or negative height — derive-or-dash means no height, no date.
 */
export function bftFromHeight(height: number): string {
  if (!Number.isInteger(height) || height < 0) {
    throw new Error(`bftFromHeight: invalid block height ${height}`);
  }
  const dayOfEpoch = Math.floor(height / BLOCKS_PER_DAY);
  const year = Math.floor(dayOfEpoch / DAYS_PER_YEAR);
  const doy = dayOfEpoch % DAYS_PER_YEAR;
  const month = Math.floor(doy / DAYS_PER_MONTH) + 1;
  const day = (doy % DAYS_PER_MONTH) + 1;
  if (month < 1 || month > 13 || day < 1 || day > 28) {
    throw new Error(`bftFromHeight: formula out of range for height ${height}`);
  }
  return `${pad(year, 4)}.${pad(month, 2)}.${pad(day, 2)} a₿`;
}

/** Strict validator: `00YY.MM.DD a₿` with month 01..13 and day 01..28 only. */
export function isValidBft(s: string): boolean {
  const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2}) a₿$/);
  if (!m) return false;
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return month >= 1 && month <= 13 && day >= 1 && day <= 28;
}

// ─── Task ids ────────────────────────────────────────────────────────

const TASK_T_RE = /\b(?:TASK-?|T-?)(\d{1,4})\b/gi;
const TASK_FLEET_RE = /\b([KHS])-?(\d{1,2})\b/g;

function normalizeTaskMatch(prefix: string, digits: string): string {
  const width = prefix === 'T' ? 3 : 2;
  return `${prefix}-${pad(parseInt(digits, 10), width)}`;
}

/**
 * Normalize one task id to `T-NNN` / `K-NN` / `H-NN` / `S-NN`.
 * Accepts T-196, TASK-196, task-196, K12, k-3, H71, S52. Returns null for
 * anything else — callers must reject, never silently drop.
 */
export function normalizeTaskId(raw: string): string | null {
  const t = raw.trim().match(/^(?:TASK|T)-?(\d{1,4})$/i);
  if (t) return normalizeTaskMatch('T', t[1]);
  const fleet = raw.trim().match(/^([KHS])-?(\d{1,2})$/i);
  if (fleet) return normalizeTaskMatch(fleet[1].toUpperCase(), fleet[2]);
  return null;
}

function collectTaskIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(TASK_T_RE)) {
    ids.add(normalizeTaskMatch('T', m[1]));
  }
  for (const m of text.matchAll(TASK_FLEET_RE)) {
    // Skip the T-prefix ids already collected (TASK_FLEET_RE can't match
    // them — K/H/S only — this guard is for case-folded lookalikes).
    ids.add(normalizeTaskMatch(m[1].toUpperCase(), m[2]));
  }
  const rank = (id: string) => 'HKST'.indexOf(id[0]);
  return [...ids].sort((a, b) => rank(a) - rank(b) || parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10));
}

// ─── Stamp parsing ───────────────────────────────────────────────────

const STAMP_RE = /(\d{4})\.(\d{2})\.(\d{2}) a₿/g;
const RIDE_HEIGHT_RE = /✦\s*(\d[\d,]*)/;
const RIDE_UTC_RE = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*UTC/;
const BARE_BLOCK_RE = /\bblock\s+(\d[\d,]*)/gi;

function parseHeight(raw: string): number | null {
  const n = parseInt(raw.replace(/,/g, ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function rideUtcToIso(date: string, time: string): string | null {
  const ms = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Scan text for house BFT stamps, riding heights/UTCs, bare block mentions,
 * and fleet task ids. Pure and deterministic.
 *
 * Riding-segment scope: a height (`✦ N`) or UTC wall-clock attaches to a
 * stamp only when it appears AFTER the stamp on the same line (the Desk
 * form). Bare `block N` mentions become height-derived stamps of their own
 * unless the same height already rides a stamp.
 */
export function parseBftStamps(text: string): BftParseResult {
  const stamps: BftStamp[] = [];
  const riddenHeights = new Set<number>();

  for (const m of text.matchAll(STAMP_RE)) {
    const raw = m[0];
    const index = m.index ?? 0;
    // Reject `.29` days / month `.14` / anything off the law's calendar.
    if (!isValidBft(raw)) continue;

    // Riding segment: rest of the line after the stamp.
    const lineEnd = text.indexOf('\n', index + raw.length);
    const segment = text.slice(index + raw.length, lineEnd === -1 ? text.length : lineEnd);

    const heightMatch = segment.match(RIDE_HEIGHT_RE);
    const height = heightMatch ? parseHeight(heightMatch[1]) : null;
    const utcMatch = segment.match(RIDE_UTC_RE);
    const utc = utcMatch ? rideUtcToIso(utcMatch[1], utcMatch[2]) : null;

    if (height !== null) {
      riddenHeights.add(height);
      // The height wins; the stamp is checked against it.
      const derived = bftFromHeight(height);
      stamps.push({
        bft: derived,
        blockHeight: height,
        ...(utc ? { utc } : {}),
        index,
        ...(derived !== raw ? { conflict: true } : {}),
      });
    } else {
      stamps.push({ bft: raw, ...(utc ? { utc } : {}), index });
    }
  }

  // Bare block mentions (`block 964,950`, `(block 966,120)`) — the height
  // stands alone and derives its own stamp. Skip heights already riding a
  // stamp so one measurement doesn't double-count.
  for (const m of text.matchAll(BARE_BLOCK_RE)) {
    const height = parseHeight(m[1]);
    if (height === null || riddenHeights.has(height)) continue;
    riddenHeights.add(height);
    stamps.push({ bft: bftFromHeight(height), blockHeight: height, index: m.index ?? 0 });
  }

  stamps.sort((a, b) => a.index - b.index);
  return { stamps, taskIds: collectTaskIds(text) };
}
