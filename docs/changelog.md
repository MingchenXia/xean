# Changelog

## 3.2.0 — 2026-10-11

Xean unifies note submissions and worker assignments, inspects campaign databases
in place, and moves to a newer Pi snapshot.

### Compatibility and interfaces

- Start fresh campaigns. Pi document versioning rejects 3.0.0 and 3.1.0
  databases. Keep existing campaigns with their frozen runtimes. This release
  includes no database migration.
- Caller `submit` and Explorer use the same `notes` and `edits` schema. The
  `correct` command is removed. Submit an edit with the note's `id`, expected
  `revision`, and changed fields. Caller import grants, revision checks, and
  atomic publication retain their existing rules.
- Candidate status is a per-note field for new notes and edits. The batch-level
  flag and its last-note convention are removed. Omitting the flag on a new
  note means `false`. Literature findings cannot designate candidates.
- Explorer's `guidance` and Literature's `query` become `assignment` in
  Coordinator work plans and standalone inputs. Codex keeps `assignment`.
  In `inspect` output, `work[].guidance` becomes `work[].assignment`.
  Caller campaign guidance remains unchanged.
- The dedicated `review` command is removed. Use `role review` with a JSON input
  containing `task` and `argument`, then `inspect` to read the assessment.

### Inspection and Pi

- `status`, `inspect`, and `export` read the database through a read-only Pi
  Session, holding a consistent SQLite read transaction without recovering work
  or calling models. Pi rejects writes from inspection callbacks, which 3.1.0
  applied to a disposable copy.
- Initialization creates the notebook catalog in the same commit as campaign
  control.
- Bundled Pi moves to source commit `ea448f454af474f3e2fe9733b331e17b0662f5d6`,
  an unreleased snapshot after 1.1.0. Its scheduler retains ownership metadata
  only while live work needs it and reloads it from storage when needed.
  Existing patches remain, including the separate document tracker cache bound.
- A new Pi Durable patch supplies read-only SQLite storage. It reuses the caller's
  read transaction, checks the schema version without migrating, rejects writes
  and ID allocation, and skips Pi's explicit closing WAL checkpoint.
  [Pi integration](parity.md#pi-integration) records its removal condition.

### Research

- Fix Codex implementation calls rejected with `invalid_json_schema` when output
  fields are optional. Xean now uses Pi's strict-schema conversion and result
  validation.
- Coordinator instructions explain how to repair a checked statement that
  misstates the intended claim: request a mathematical Explorer edit of the
  authoritative note text, then a new correctness check. Correctness checks
  record checked statements.
- The optional native Codex profile in `examples/xean-research.config.toml` sets
  `features.plugins = false` for source checking, literature, and independent
  review while preserving native web search. Implementation workers select their
  profile separately. The [setup instructions](../README.md#run-a-campaign)
  describe how to select the profile.

## 3.1.0 — 2026-10-10

Xean adds an editable notebook, preserves useful work after provider failures,
and moves campaign inspection to the CLI.

### Compatibility and removals

- Start fresh campaigns. The database format is incompatible with 3.0.0.
  Keep existing campaigns with their frozen runtimes.
  This release includes no database migration.
- The Observe web interface and `bun run observe` are removed. Use `xean status`,
  `xean inspect`, `xean inspect --records`, and `xean export` on the campaign host.
- `status`, `init`, `run`, `role`, `review`, `pause`, `resume`, and `cancel` return
  compact status JSON. Use `inspect` for usage, full work history, notes, checks,
  and standalone results. Update scripts that expected those details in status.
- The note `checks` field is now an object keyed by verification stage, replacing
  the array of check records. Verifier corrections update summaries only. Change
  proof text and dependencies through note edits.
- The prompt-evaluation runner is removed. Use the ordinary `role` command with
  a fresh database for each standalone case.

### Notebook and verification

- Explorer can edit notes in place using their stable IDs and expected revisions.
  New notes and edits publish atomically. Mathematical changes invalidate affected
  checks while preserving unaffected checks and dependency references.
- The editable notebook keeps an index summary, detailed summary, and
  authoritative full text for each note.
- Retirement removes a note from routine discovery and direct verification.
  Historical reads and verification of existing dependents remain available.
- Completed assessments, including INCONCLUSIVE results, stay closed for unchanged
  inputs. Coordinator chooses repairs, source retrieval, other work, or idle.
  Relevant new quotations can reopen an eligible INCONCLUSIVE source check.
  Duplicate receipts and unrelated quotations leave it closed.
- Edits may declare `cosmetic: true` for presentation-only text changes. Xean
  trusts this declaration and preserves checks and import trust. Changes to
  dependencies always require verification.
- Acceptance pins a notebook snapshot. The CLI and library export the accepted
  argument from that snapshot.

### Recovery and resource use

- Native Explorer submissions can publish after a terminal provider failure if
  they still validate against the current notebook. The worker retains its failed
  status and error. Cancellation and invalid publications publish no partial work.
- Codex failures expose the provider's error message when available. Output
  capture is bounded.
- Completed role conversations release idle context and provider session resources.
  Each Pi session caches at most 128 document trackers and reloads evicted
  documents from storage. This bounds cached document count, not total memory.

### Pi and development

- Bundled Pi moves from 1.0.4 to an unreleased snapshot after 1.1.0. The exact
  artifacts and retained patches are recorded in
  [Pi provenance](../vendor/pi/provenance.json).
- Xean uses Pi's model catalog, reasoning schema, and native document snapshots.
  Notebook state lives in Pi Documents,
  with references to native verification receipts.
- Retained provider patches preserve error identity and failed-response usage, handle
  fragmented Codex SSE frames, and retain native WebSocket fallback. The
  [Pi integration inventory](parity.md#pi-integration) explains each retained patch.
- Source-package checks now run Pi and role contract tests against the installed
  production dependencies. CLI startup no longer runs duplicate installation scans.
