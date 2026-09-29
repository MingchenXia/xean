import { html, render } from "lit-html";
import renderMath from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import type { Run } from "../src/read.ts";

const app = document.querySelector<HTMLElement>("#app")!;
const connection = document.querySelector<HTMLElement>("#connection")!;
let runs: Run[] = [];
let pending = false;
const count = (value: number | undefined) =>
  value === undefined ? "—" : value.toLocaleString();
const problem = (run: Run) =>
  run.snapshot?.task?.problem ?? run.heartbeat?.task.problem ?? run.id;
const state = (run: Run) =>
  run.snapshot?.status.status ?? run.process?.status ?? "Unknown";
const age = (run: Run) => {
  const timestamp =
    run.snapshot?.observedAt ?? run.process?.observedAt ?? run.observedAt;
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(timestamp)) / 1000),
  );
  return `${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`} ago`;
};
const math = (text: string) =>
  html`<div class="math" .textContent=${text}></div>`;
const json = (value: unknown) =>
  html`<pre>${JSON.stringify(value, null, 2)}</pre>`;

function detailView(run: Run) {
  return html`
    <a class="back" href="#">← All runs</a>
    <div class="title">
      <h1>${run.id}</h1>
      <span class="badge">${state(run)}</span>
    </div>
    <p class="muted">
      ${run.kind === "database" ? "Live database snapshot" : run.kind === "snapshot" ? "Published snapshot" : run.kind === "export" ? "Exported result" : "Run heartbeat"},
      ${age(run)}
    </p>
    ${run.error ? html`<p class="error">${run.error}</p>` : ""}
    ${run.snapshot?.status.error ? html`<p class="error">${run.snapshot.status.error}</p>` : ""}
    <section>
      <h2>Problem</h2>
      ${math(problem(run))}${
        run.snapshot?.task
          ? html`<details>
              <summary>Completion criteria</summary>
              ${math(run.snapshot.task.completionCriteria)}
            </details>`
          : ""
      }
    </section>
    <div class="stats">
      <div>
        <span>Rounds</span
        ><strong>${count(run.process?.rounds ?? run.heartbeat?.rounds)}</strong>
      </div>
      <div>
        <span>Recorded calls</span
        ><strong
          >${count(run.snapshot?.status.calls.admitted ?? run.process?.calls)}</strong
        >
      </div>
      <div>
        <span>Notes</span><strong>${count(run.snapshot?.notes.length)}</strong>
      </div>
      <div>
        <span>Accepted</span
        ><strong
          >${count(run.snapshot?.notes.filter((note) => note.accepted).length)}</strong
        >
      </div>
    </div>
    ${
      run.snapshot
        ? html`
            <section>
              <h2>Notes and verification</h2>
              ${
                run.snapshot.notes.length
                  ? run.snapshot.notes.map(
                      (note) =>
                        html` <details class="note">
                          <summary>
                            <span class="badge"
                              >${note.dead ? "Rejected" : note.accepted ? "Accepted" : note.verified ? "Verified" : "Unchecked"}</span
                            >
                            ${note.summary} <code>${note.id}</code>
                          </summary>
                          <p class="muted">
                            ${note.imported ? "Imported" : "Generated"}${note.candidate ? ", candidate" : ""}.
                            Support: ${note.support.join(", ") || "none"}
                          </p>
                          ${math(note.detailedSummary)}
                          <details>
                            <summary>Full note</summary>
                            ${math(note.text)}
                          </details>
                          <details>
                            <summary>Checks</summary>
                            ${json(note.checks)}
                          </details>
                        </details>`,
                    )
                  : html`<p class="muted">
                      No notes committed in this snapshot.
                    </p>`
              }
            </section>
            <section>
              <h2>Workers</h2>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Work</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Attempts</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${run.snapshot.work.map(
                      (work) =>
                        html`<tr>
                          <td>
                            <code>${work.id}</code
                            >${work.error ? html`<pre class="error">${work.error}</pre>` : ""}
                          </td>
                          <td>${work.role}</td>
                          <td>${work.status}</td>
                          <td>${work.attempts}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section>
              <h2>Usage</h2>
              ${
                run.snapshot.usageAvailable
                  ? html`<p>
                        ${run.snapshot.status.calls.settled} settled,
                        ${run.snapshot.status.calls.unsettled} unsettled,
                        ${run.snapshot.status.calls.unknownUsage} with unknown
                        usage.
                      </p>
                      ${run.snapshot.status.calls.byModel.map(
                        (group) =>
                          html`<details>
                            <summary>
                              ${group.model}
                              <span class="muted"
                                >${group.api}, ${group.admitted} calls</span
                              >
                            </summary>
                            ${json(group.reportedUsage)}
                          </details>`,
                      )}
                      <p class="muted">${run.snapshot.status.usageNote}</p>`
                  : html`<p class="muted">
                      Usage was not included in this export.
                    </p>`
              }
            </section>
            ${
              run.snapshot.result === null
                ? ""
                : html`<section>
                    <h2>Campaign result</h2>
                    ${json(run.snapshot.result)}
                  </section>`
            }
          `
        : html`<section>
            <h2>Live activity</h2>
            <p>
              Detailed notes are unavailable in this observation. Process
              status, when available, is shown below.
            </p>
            ${run.process?.active?.map((work) => html`<p><code>${work.id}</code> ${work.role}</p>`)}
          </section>`
    }
    ${
      run.process
        ? html`<section>
            <h2>Process</h2>
            <p>
              ${run.process.status}, observed
              ${new Date(run.process.observedAt).toLocaleTimeString()}
            </p>
            <details>
              <summary>Recent logs</summary>
              <pre>${run.process.log}</pre>
              ${run.process.errorLog ? html`<pre class="error">${run.process.errorLog}</pre>` : ""}
            </details>
          </section>`
        : ""
    }
    <footer>
      <code>${run.source}</code
      ><a
        href=${`/api/runs/${encodeURIComponent(run.id)}`}
        target="_blank"
        rel="noreferrer"
        >View JSON</a
      >
    </footer>
  `;
}
function indexView() {
  return html`
    <div class="title">
      <h1>Runs</h1>
      <span class="muted">${runs.length} configured</span>
    </div>
    <p class="muted">
      Inspect committed work and verification. Refreshes every ten seconds.
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th>Calls</th>
            <th>Notes</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          ${runs.map(
            (item) =>
              html`<tr>
                <td>
                  <a href=${`#${encodeURIComponent(item.id)}`}>${item.id}</a>
                  <p class="excerpt">${problem(item)}</p>
                </td>
                <td>${item.error ? "Unavailable" : state(item)}</td>
                <td>
                  ${count(item.snapshot?.status.calls.admitted ?? item.process?.calls)}
                </td>
                <td>${count(item.snapshot?.notes.length)}</td>
                <td>
                  ${item.kind ?? "Unavailable"}<br /><span class="muted"
                    >${age(item)}</span
                  >
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function draw() {
  let selected: Run | undefined;
  try {
    selected = runs.find(
      (run) => run.id === decodeURIComponent(location.hash.slice(1)),
    );
  } catch {
    /* Unmatched URL stays on the index. */
  }
  render(selected ? detailView(selected) : indexView(), app);
  for (const element of app.querySelectorAll<HTMLElement>(".math"))
    renderMath(element, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
      trust: false,
    });
}

async function refresh() {
  if (pending) return;
  pending = true;
  try {
    const response = await fetch("/api/runs");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    runs = (await response.json()) as Run[];
    draw();
    connection.textContent = `Checked ${new Date().toLocaleTimeString()}. Snapshot ages show when campaign data was observed.`;
  } catch (error) {
    connection.textContent = `Refresh failed: ${error}. Showing the last received data.`;
  } finally {
    pending = false;
  }
}
document
  .querySelector("#refresh")!
  .addEventListener("click", () => void refresh());
window.addEventListener("hashchange", draw);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
setInterval(() => {
  if (!document.hidden) void refresh();
}, 10_000);
void refresh();
