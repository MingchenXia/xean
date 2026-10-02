# Verification

The [development check](../README.md#development-on-fleet) checks types,
formatting, distribution metadata, dependency hashes, documentation links, and
the offline test suite. Run it on the exact source candidate and Bun runtime
intended for distribution. A passing historical run does not qualify later code.

## Offline checks

The suite exercises atomic publication, failed-decision rollback, uncertain
commits, concurrent readers, ownership exclusion, crash recovery, pause,
cancellation, call-cap draining, call grants, and settlement during shutdown.
Solver checks cover dependency ordering, source-verdict finality, trusted
imports, correction races, blinded reconstruction, and exact-task acceptance.
Provider fixtures exercise Pi's native parsers and tools, WebSocket continuation,
retry classification, browser disconnects, and Codex process cleanup.

The [deterministic example](../examples/deterministic.ts) runs without credentials
or model calls. From the source checkout:

```sh
bun examples/deterministic.ts
bun examples/deterministic.ts
```

Both invocations must return `{"status":"completed","result":25}`. The second
invocation reuses committed work. Use an explicit fresh database path when
qualifying a new candidate.

FULL SQLite synchronization is configured and process-crash recovery is tested.
Power-loss durability has not been tested. Installation receipts fingerprint
dependency inputs, Bun version, operating system, and architecture, but do not
attest arbitrary manual edits inside `node_modules`. Use a clean setup for
distribution qualification.

## Live provider checks

For a provider or execution change, smoke-test the affected path with its actual
runtime, model, credentials, and native configuration. Check results and failure
records, then reopen without credentials and verify that committed work and
records are unchanged. Fixtures establish local behavior, while live smokes
establish that the selected deployment can execute it.

On saturn, from Fleet Infra, the maintained gateway and solver smokes are:

```sh
bin/fleet-nix run .#fleet-run -- ../xean/scripts/codex-lb-smoke.ts codex-lb/xean
bin/fleet-nix run .#fleet-run -- ../xean/scripts/solver-smoke.ts codex-lb/xean
```

The launchers verify dependencies, read the gateway key from OpenBao into memory,
and pass it over stdin to the child runtime with the provisioned lab CA.

The gateway smoke uses Pi Durable conversations to check two concurrent workers,
native usage, cached WebSocket connection reuse and delta requests, and reopening
in another process. Successful execution prints `completed` for both phases.
Its Durable implementation still requires live qualification. The solver smoke
initializes without model calls, then checks the tree edge-count task through
acceptance and unchanged reopening with a forty-call allowance. Both use Luna
at max reasoning. The source-checking Codex path and
subscription providers require separate checks when affected. Their setup is
in the [solver guide](solver.md#configuration-and-functions).

Retain source revision, Bun version, frozen task/settings, campaign, result,
and stderr under ignored `runs/`. The solver launcher saves the accepted argument
as `argument.md` and preserves failed-attempt artifacts. A snapshot left by a
failed assertion is not a successful smoke. Record provider limitations with the
source revision.

Historical provider, benchmark, and memory measurements remain in Git and their
original local run artifacts. Those private artifacts are not part of the source
distribution. Model execution, internal acceptance, independent mathematical
review, and catalog closure remain distinct evidence.

### Codex worker

On 2026-10-01, a frozen Xean source snapshot passed a Codex worker smoke on
saturn with Bun 1.4.2, Codex CLI 0.153.4, and `gpt-5.6-luna` at max reasoning.
A deterministic Coordinator dispatched one Codex worker, then the full built-in
Verifier. Codex used its native `codex-lb` profile, workspace-write sandbox,
and shell to write and run a TypeScript enumerator. It published an ordinary
candidate note proving that the maximum of `3x + 5y`, for nonnegative integers
with `2x + 3y <= 19`, is 31 at `(2, 5)`.

Correctness, self-contained source checking, requirements, and blind
reconstruction passed. The campaign accepted the note after one Codex invocation
and five Pi calls. Both workers completed on their first attempt. A separate
execution of the retained program reproduced the exact JSON result. Reopening
in a second process without a supplied credential preserved the campaign,
records, and database bytes and made no new calls. The accepted argument was
exported separately.

The frozen source passed the full locked check with 121 tests and 1,746
assertions. Lab passed 97 tests and 573 assertions, including its zero-call
CLI integration smoke against that snapshot. The artifact audit matched all
48 recorded hashes of source and dependency inputs. Native Codex recorded a startup
warning for the operator's enabled `context_management` feature and no failed
turn. This qualification covers local computation and ordinary note verification
on the recorded snapshot. It does not qualify later Pi migration changes.

The frozen source, check logs, campaign, native records, program, rerun receipt,
and source manifest are retained under `runs/issue4-codex-smoke/`. The campaign
directory is `frozen/runs/issue4-codex-2026-10-01T21-32-06-092Z/` within that root.

### Pi Durable conversations

The 2026-10-01 migration passed the locked Bun 1.4.2 check: 127 tests and 1,809
assertions. A subsequent focused regression for explicit Coordinator retry passed
alongside the restart fixture (2 tests, 39 assertions). Lab passed 97 tests and
573 assertions plus its zero-call CLI integration. Independent extraction and
patch application matched all 1,226 installed Pi files.

A live `openai-codex/gpt-5.6-luna` Explorer at max reasoning used exactly three
calls: a full note read, a private intermediate submission, and a final submission
after continuation. Pi retained three completed generations and three completed
tool tasks. The full note and both submissions survived unchanged. A second
process reopened the completed campaign without credentials, made zero calls,
and preserved campaign, transcript, task records, and database bytes.

This smoke qualified execution and persistence; it did not run mathematical
verification. Offline fixtures cover interrupted private resumption, frozen
input, consumed allowances, logical retry, large untruncated note reads,
call-cap draining, cancellation, and one atomic shared publication. Deferred
model polling is rejected because it bypasses call accounting.

Source hashes, native records, and qualification receipts are retained in
`runs/pi-durable-2026-10-01T21-53-42-358Z/`.

### Pi upgrade qualification

Pi 1.0.0 revision `a13d35a742c6` passed the locked Bun 1.4.2 checks on 2026-10-01:
119 tests and 1,657 assertions. Lab passed 97 tests and 573 assertions, plus
its zero-call CLI integration smoke against the Xean snapshot checked for that
upgrade. All five artifacts matched across two clean builds using the previous
frozen model catalog, and all 17 installed patched files matched independent
extraction and patch application. The checks cover direct native telemetry, model and tool
execution, atomic publication, cancellation, accounting, and read-only inspection.
No live provider calls were made for this upgrade. The receipts below qualify
their recorded revisions.

Pi revision `8ce69e9d2b17` passed the locked Bun 1.4.2 checks on 2026-10-01:
109 tests and 1,507 assertions. All five artifacts matched across two clean
builds using the previous frozen model catalog, and all 16 installed patched
files matched independent extraction and patch application. The checks cover
extension task registration, atomic publication, pause and close accounting,
read-only SQLite, provider recovery, JSON-error retry classification, and CRLF
framing.

Source `6a9510e477ce` exercised Pi `8ce69e9d2b17` on Jupiter under Nomad on 2026-10-01,
using Bun 1.4.2, Codex CLI 0.153.4, and `gpt-6-astra` at max reasoning.
Four Pi role calls and one Codex source invocation settled successfully. Two
auxiliary notes received fresh PASS judgments for correctness, sources, and
blind reconstruction, with three supporting notes supplied as trusted imports.
The payload audit confirmed identical canonical premise strings across stages
and no additional model calls when reusing completed source and reconstruction
checks. Nomad recorded exit 0 without restarts, and the audit matched 36 runtime
source files to the frozen image. Evidence is under
`runs/canonical-premise-smoke/`.

This smoke qualifies the changed verification data flow for those notes. The
complete mathematical task was outside its scope. The source qualification below
also checks gateway continuation on this pin. Native Anthropic tool use retains
the earlier pin's qualification and has not been rerun on this pin.

Pi revision `d4d74eb19be9` passed the locked Bun 1.4.2 checks on 2026-09-30:
108 tests and 1,494 assertions. All five artifacts matched across two clean
builds, and all 16 patched installed files matched fresh patch application.

The gateway smoke completed four Luna/max calls across two concurrent workers,
including cached WebSocket continuation, then reopened without another call.
Native Anthropic completed two Opus 5.5/max subscription requests, preserving
the exact tool result, measured usage, records, and database bytes across reopens.
These checks qualify transport and lifecycle behavior, not a full mathematical
solver campaign. Source hashes and receipts are under
`runs/pi-upgrade-20260930-d4d74eb/` and
`runs/codex-lb-2026-09-30T21-11-45-790Z/`.

### Lab lifecycle qualification

On 2026-10-01, Xean `d76728f` and Lab `abf3f13` completed two supervised
campaigns on Jupiter with identical task, settings, and source, using direct
and inductive guidance. One campaign received SIGINT after its first durable
note; the other was paused through the active owner. Both resumed in a second
Nomad generation, retained notes and frozen inputs, and reached acceptance.
They recorded 16 and 11 calls respectively. Observe inspection and accepted
argument exports passed. Independent review packets were created separately.

The 26 measured gateway requests totalled $0.0215228. One cancelled request had
unknown usage and price, so this is a subtotal. Lab `6127523` subsequently fixed
Linux RSS units and passed image qualification with zero provider calls.
Original resource artifacts retain their inflated child RSS fields; measured
cgroup allocation peaks were about 257 MB and 255 MB, with no OOM kills.
Receipts are in `jupiter:/srv/xean-lab/deployments/issue6-20261001/` and campaigns
in `jupiter:/srv/xean-lab/runs/issue6-20261001/`. These receipts qualify their
recorded source revisions, not every later change.

### Source distribution qualification

On 2026-10-01, clean archives of Xean `bb053d1` and Lab `1696814` passed on
macOS ARM64 and Linux x64 with Fleet's locked Bun 1.4.2. Xean passed 113 tests
and 1,509 assertions. Lab passed 93 tests and 524 assertions, plus the shared
zero-call CLI integration smoke. CLI help/version, README initialization/status,
and deterministic completion and reopening also passed. The clean macOS check
exposed a source-path alias bug in Lab, fixed by resolving `XEAN_SOURCE` before
Nix filters the source tree.

The Git archive SHA-256 checksums are:

| Source         | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| Xean `bb053d1` | `70f647736e0ec6e94f905c1bafafe51f9afb89bc7f06bf542310bdd575b1ea0d` |
| Lab `1696814`  | `fbe80f8f7301ba05c6bff458dbe7c3ef8ea2634f288a837667a00ac85ecb07c8` |

A supervised Jupiter job exercised these sources in the retained worker image
with Bun 1.4.2 and Codex CLI 0.153.4. The shared integration smoke passed, then
four Luna/max gateway calls completed across two concurrent workers with cached
WebSocket continuation. Reopening supplied no provider key and made no
additional calls. The process still inherited the gateway environment variable.
Two independent Codex reviews of the earlier accepted Lab packets returned
PASS, using one admitted Luna/max invocation each. The original campaigns and
packet bytes remained unchanged. These reviews qualify the recorded review path
and the exact elementary task, with no external sources required.

Gateway accounting measured eight successful requests, including Codex's
internal requests, at $0.0080742 API-equivalent cost. Observe rendered both
completed campaigns and their separate PASS receipts using public reports from
the original runtime and the snapshot API checked in that qualification.
Browser screenshots are under `output/playwright/issue6/`.

The earlier receipts establish live guidance, pause, interruption, and resume at
their recorded revisions. Checks on those source archives cover the later
integration, observation, transport, and review changes. This qualification used
mounted source archives in a retained image. It did not replace the production
coordinator or upgrade existing campaigns. Historical subscription-provider
receipts retain their original scope.

Receipts and archives are under `runs/issue6-8-qualification-20261001/`, with
live evidence at
`jupiter:/srv/xean-lab/runs/_xean/issue68-qualification-20261001-r02/`.
The preceding `r01` attempt failed during dependency installation before any
model calls. The new attempt moved Bun's install cache from bounded scratch
space to its mounted run directory.

### ChatGPT Web

Source `994dc7f` passed the production Responses smoke on 2026-09-30 using
`codex-chatgpt-web` v6.1.1 at upstream commit
`a13cd09950969f43e3b7e25c71fa43efaf5446c5`, the local answer-source patch, and
Fleet's pinned portable Bun 1.4.2. The authenticated production browser and
native daemon ran on mercury. Xean connected through an SSH loopback forward.

Three Pro requests completed in about 101 seconds: a two-response generic Pi
tool round trip and one built-in Explorer submission. The tool returned a random
nonce, a newline, and mathematical text whose backslashes survived exactly.
Explorer published an unverified candidate proof note. Both campaigns retained
identical records and database bytes after read-only and credentialless owning
reopens. The smoke made no retries and did not establish mathematical acceptance.

The deployed HTTP bridge reports opaque Responses IDs and no explicit served-model
identity or measured usage. Xean preserves those unknowns. Long responses,
concurrent browser use, login expiry, subscription exhaustion, and stopping remote
generation were not exercised by this smoke. Cancellation, invalid envelopes,
and no-replay recovery also have deterministic fixture coverage.
Private artifacts are in `runs/issue2-responses-live-20260930/`.

### Native Anthropic

On 2026-09-30, Pi's native Anthropic provider passed a two-request subscription
smoke on saturn with Fleet Bun 1.4.2 and `claude-opus-5-5` at `max` reasoning.
Both requests used bearer OAuth without an API key and returned HTTP 200. A Pi
tool returned a random nonce, newline, and LaTeX, preserved exactly by the next
response. Native terminal events attested the model, and measured token usage
was retained. No retry occurred. Read-only and completed owning reopens preserved
records and database bytes without another request.

The [settings example](../examples/claude-settings.json) uses this native provider.
Private evidence is under `runs/native-anthropic-20260930/`. Credentials were
supplied in memory and checked absent from saved artifacts. OAuth refresh,
large contexts, quota exhaustion, and mathematical acceptance were not exercised
by this transport smoke. Pi's API-rate cost estimates are not subscription bills.

### Historical Claude Code

On 2026-09-30, the now-removed CLI-backed provider passed on saturn with Claude
Code 2.1.280, Fleet Bun 1.4.2, and `claude-opus-5-5` at `max` reasoning.

An algebra campaign reached acceptance after 11 recorded calls, including one
Explorer interrupted after native initialization. Reopening recovered that
worker. Explorer read a full imported note before submitting its proof, and
correctness, requirements, and blind reconstruction passed. The completed
campaign reopened with identical records and database bytes.

Private artifacts, source hashes, and the smoke script are under
`runs/issue1-claude-20260930/`, including historical checks of the removed Claude
research backend. Native model, usage, cleanup, and reopening records passed
independent artifact review. Anthropic API credential routing and failure paths
have deterministic coverage. This smoke used the Claude subscription, not the
Anthropic API, and did not exercise login expiry or quota exhaustion.
