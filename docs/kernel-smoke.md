# Kernel verification

The [architecture cleanup](../runs/architecture-cleanup-20260926/verification.json)
passed socket-free typechecking, formatting, and all 112 tests with 1,253
assertions. It delegates browser stream setup to Pi, derives role continuation
from Pi tool results, and removes unused role metadata and redundant input copies.
Live max-reasoning checks exercised the normal Explorer through ChatGPT Pro on
mercury and Explorer/Verifier through Claude Opus 5.5 on saturn. Claude passed the
valid proof and rejected division by zero. All three calls settled and their
campaigns reopened unchanged. Browser notes remain unverified and usage unmeasured.

## Pinned dependency upgrade

The [current Pi upgrade](../runs/pi-upgrade-20260926/verification.json) pins the
five Pi/Chord packages to `2b0a123de98318c2ff8069661721ce0c3794c34e`.
Two clean builds reproduced every tarball with the frozen model catalog, and
independent patch application matched all installed patched files. Socket-free
typechecking, formatting, and 112 tests passed, including rollback and continued
use after `StorageRejected`, fatal uncertain commits, and cancellation accounting.

Live checks used max reasoning throughout. Two concurrent Luna workers completed
four requests with cached WebSocket continuation and reopened without new calls.
Claude Opus 5.5 produced an elementary proof and then passed that proof while
rejecting a division-by-zero proof. ChatGPT Pro completed the normal Explorer on
mercury and published three linked notes through `submit_result`. All campaigns
reopened with unchanged state and records. Browser usage remained unmeasured.

## Previous Session upgrade

The [Session upgrade](../runs/pi-upgrade-5fd446ca/verification.json) pinned Pi/Chord
to `5fd446ca1843682e8da3fec4ceb71c42f56fbace`. Both clean builds reproduced all
five packages, preserving the frozen model catalog. The unchanged AI patch was
independently applied and matched against every installed package file.
Pi Session now owns transaction serialization, preparation, rollback, and
atomic publication. Yean retains detached boundaries and task-cache integration.
The [live smoke](../runs/codex-lb-2026-09-25T03-33-37-690Z/live.json) completed
four max-reasoning calls across two concurrent workers with cached WebSocket
continuation. [Reopening](../runs/codex-lb-2026-09-25T03-33-37-690Z/resume.json)
made zero calls and preserved state and records. Earlier evidence below retains
its original source revisions and settings.

## Earlier pinned-main checkpoint

The September 24, 2026 checkpoint on `saturn` used Fleet's locked Bun `1.3.13`
and Pi/Chord commit `56746909666ba3298d9e144b1e36dbe08470c594`.
Current behavior is specified in the [kernel guide](kernel.md); dependency
ownership and deferred work are recorded in [Pi alignment](pi-alignment.md).
The evidence below describes the source states recorded in its artifacts.
Local run artifacts are ignored by Git.

## Pinned dependency and kernel checks

The historical [rebuild verification](../runs/pi-main-56746909666b/rebuild-verification.json)
reproduced all five `567469` tarballs. The current pin's
[artifact provenance](../vendor/pi/provenance.json) and
[rebuild instructions](../vendor/pi/README.md) describe the newer build.
After a frozen reinstall of the historical checkpoint, the
[installed patch bytes](../runs/pi-cleanup-2026-09-24/patch-verified.json)
matched the intended Git-applied output.

The checkpoint passed socket-free typechecking, formatting, and 86 tests,
including 19 native Pi storage conformance cases. Coverage includes atomic
publication, mid-write rollback, lost commit acknowledgement, SIGKILL recovery,
concurrent scheduling, deadline and call-limit drains, and delayed settlement
during shutdown. Store checks cover draft revocation, detached snapshots,
task/entry rollback, and caller mutation while entry ID allocation yields.
Native provider fixtures cover cached WebSocket deltas, lost-context recovery,
credential and endpoint isolation, session cleanup, and retry listener cleanup.
They substitute transport I/O; the live checks below exercise codex-lb.

Power-loss durability was not tested. The installation receipt assumes
serialized installs and does not attest arbitrary manual `node_modules` edits.

## Live transport and reopening

The [live smoke](../runs/codex-lb-2026-09-24T13-42-14-644Z/live.json)
completed four calls across two concurrent `openai-codex/gpt-5.6-luna` workers
and accepted the result `25`. Each worker made two requests over one WebSocket
connection: one full-context request and one cached delta. Neither worker
reported a WebSocket failure or SSE fallback. The
[separate reopen](../runs/codex-lb-2026-09-24T13-42-14-644Z/resume.json)
made zero calls and preserved state and records.

The [initial pinned-main smoke](../runs/codex-lb-2026-09-24T12-58-42-994Z/)
recorded the same four-call result and unchanged reopen. A
[rational-curves campaign copy](../runs/pi-main-56746909666b/rational-reopen.json)
also reopened unchanged: 452 records, 118 existing calls, and zero new calls.
This is storage-recovery evidence, not a mathematical acceptance claim.

### Historical gateway reconciliation

The September 23 smoke used the published npm Pi `0.87.1` release, low
reasoning, one worker attempt, no configurable Pi retries, a four-call allowance,
and a 45-second deadline. Both turns of each worker were checked. An exact-tag
read-only query of `jupiter:/srv/codex-lb/store.db` matched every persisted usage
count:

| Worker   | Turn | Input tokens | Cached input | Output tokens | Reasoning tokens |
| -------- | ---: | -----------: | -----------: | ------------: | ---------------: |
| Square 3 |    1 |           25 |            0 |             5 |                0 |
| Square 3 |    2 |           41 |            0 |            17 |               10 |
| Square 4 |    1 |           25 |            0 |             5 |                0 |
| Square 4 |    2 |           41 |            0 |             5 |                0 |

All gateway rows reported success: 132 input and 32 output tokens in total.
Reasoning tokens are included in output; this check makes no dollar-billing
claim. A separate process reopened the completed campaign without a credential
or new calls. A fresh deterministic campaign also returned `25` and remained
byte-identical after reopen. Evidence:

- [Live campaign and journal](../runs/codex-lb-2026-09-23T09-49-43-207Z/live.json)
- [Reopened campaign and journal](../runs/codex-lb-2026-09-23T09-49-43-207Z/resume.json)
- [Gateway rows, checks, source hashes, and counts](../runs/codex-lb-2026-09-23T09-49-43-207Z/verified.json)

## Memory measurements, September 24

The rational-curves run on `jupiter` had an observed cgroup peak of 196.3 MiB
against its 2 GiB limit, with zero recorded OOM events, swap use, or CPU quota
throttling. The
[resource observation](../runs/rational-curves-characteristic-zero-offline-2026-09-24/memory-2026-09-24T09-12-29-326Z.summary.json)
covers the original running revision. These sequential counter reads are not
an atomic snapshot or a trend; the peak covers the cgroup's lifetime since
creation or reset. They do not establish mathematical progress or inference
latency, and cgroup accounting differs from process RSS.

### Provider allocation

Xean reference commit `8a846d3` identified two provider allocation fixes:
JSON repair copies only changed spans, and successful Codex WebSocket requests
avoid an unused full-body JSON encoding. A synthetic 128 KiB tool response
delivered in 256-byte deltas on `saturn` gave:

| Measurement          |    Before |     After |
| -------------------- | --------: | --------: |
| Parser elapsed time  |    6.33 s |    0.52 s |
| Peak sampled JS heap |  56.4 MiB |   1.7 MiB |
| Peak sampled RSS     | 138.3 MiB | 113.6 MiB |

The [before](../runs/memory-audit-2026-09-24/before.json) and
[after](../runs/memory-audit-2026-09-24/after.json) observations retain exact
bytes and the sampling method. Final arguments matched. These observations
measure transient parser allocation, not a production memory bound.
The [JSON-repair comparison](../runs/memory-audit-2026-09-24/repair-equivalence.json)
covered 87,423 cases; the
[serialization probe](../runs/memory-audit-2026-09-24/websocket-serialization.json)
checked full and delta wire frames. The
[live smoke](../runs/codex-lb-2026-09-24T09-19-57-123Z/)
completed four calls and reopened unchanged with zero new calls.

### Retained payloads and export

Probes against a copy of the paused rational-curves campaign measured:

| Measurement                              |           Before |           After |
| ---------------------------------------- | ---------------: | --------------: |
| Encoded records retained for status      | 18,652,580 bytes |    61,444 bytes |
| Encoded resident task payloads           |  3,987,179 bytes | 2,272,962 bytes |
| Export/reopen peak process RSS on saturn |        404.7 MiB |       307.8 MiB |

The [status](../runs/memory-followup-2026-09-24/status.json),
[resident payload](../runs/memory-followup-2026-09-24/resident.json), and
[finalization](../runs/memory-followup-2026-09-24/finalization.json) probes retain
their methods. Encoded sizes measure payloads, not process heap or RSS; Pi still
retains full durable records. Status still reads and decodes every journal row.

The export comparison used separate `saturn` processes with the same core code
and paused campaign copy; only the runner script differed. Both reopened at
118 recorded calls with zero provider requests, unchanged state, matching
journal fingerprints, and byte-identical export. These are individual
observations, not production memory bounds. Later pinned-main adoption and
ownership cleanup have no separate measured memory-reduction claim.
