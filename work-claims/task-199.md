# WORK CLAIM — TASK-199

- Lane: kimi builder (subagent), worktree `~/dev/worktrees/task-199`
- Branch: `feat/task-199-bft-task-aware`
- Base sha: `a6be012a3bcfac42e279630aedec5cda4a450e29` (v0.50.0.0, `arcade`)
- Claimed: 0018.06.22 a₿ (block 966,758 via mempool.space tip height at claim time)
- Scope: BFT stamps + fleet task ids first-class in page frontmatter; `--task`/`--since-block`/`--until-block` query filters; redacting `~/dev/kimi/bin/brain-mirror.sh`
- OWNS (per brief): NEW `src/core/bft.ts`, `src/core/frontmatter-inference.ts` (additive), `src/core/effective-date.ts` (one source), `src/core/operations.ts` + `ops/search.ts` (filters, read scope), NEW `~/dev/kimi/bin/brain-mirror.sh` (+ fixture), tests, `scripts/module-size-limits.tsv` rows if a ceiling moves
- NOT OWNED: engines (except as the parity law requires — choice recorded in SUMMARY), `migrate.ts`, `import-file.ts` (Seams), MCP surface files
- Laws: engine parity · contract-first · fail-closed trust · no JSON.stringify into ::jsonb · module-size ratchet · derive-or-dash (no height→Gregorian) · no secrets · never push · never touch the live brain
