import assert from "node:assert/strict";
import { REQUIRED_HEADLESS_FLAGS } from "../../packages/core/node_modules/pi-claude-code-provider/src/auth.ts";

export async function runFixture() {
  const args = process.argv.slice(2);
  const event = (value: unknown) => console.log(JSON.stringify(value));
  if (args.includes("--version")) console.log("2.1.281");
  else if (args.includes("--help"))
    console.log(REQUIRED_HEADLESS_FLAGS.join(" "));
  else if (args.includes("auth"))
    event({
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      subscriptionType: "max",
    });
  else {
    assert.equal(args[args.indexOf("--tools") + 1], "WebSearch,WebFetch");
    assert.equal(args[args.indexOf("--effort") + 1], "max");
    const input = JSON.parse(await Bun.stdin.text());
    const mode = input.task.problem;
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!);
    event({
      type: "system",
      subtype: "init",
      tools: ["WebSearch", "WebFetch", "StructuredOutput"],
      permissionMode: "dontAsk",
      slash_commands: [],
      skills: [],
      plugins: [],
      apiKeySource: "none",
      mcp_servers: [],
      model: "claude-opus-5-5",
    });
    event({
      type: "assistant",
      message: {
        id: "fixture-message",
        content: [
          {
            type: "tool_use",
            id: "fetch",
            name: "WebFetch",
            input: { url: "https://example.com/paper" },
          },
        ],
        usage: { input_tokens: 11, output_tokens: 2 },
      },
    });
    event({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: mode === "unpaired-tool" ? "unknown" : "fetch",
            is_error: mode === "failed-tool",
            content: mode === "failed-tool" ? "Retrieval failed" : "P holds.",
          },
        ],
      },
    });
    const report = {
      verdict: "PASS",
      report: "Checked",
      correction: null,
      passages: [
        { premise: 0, url: "https://example.com/paper", quote: "P holds." },
      ],
    };
    const value = schema.properties.results
      ? {
          results: input.notes.map((note: { id: string }) => ({
            noteId: note.id,
            result: report,
          })),
        }
      : schema.properties.notes
        ? {
            notes: [
              {
                id: "n1",
                summary: "P holds",
                detailedSummary: "P holds by the cited theorem.",
                text: "P holds. Source: https://example.com/paper, quotation: P holds.",
                support: [],
              },
            ],
            candidate: false,
          }
        : { ...report, premises: ["P holds"] };
    event({
      type: "result",
      subtype: mode === "error" ? "error_during_execution" : "success",
      is_error: mode === "error",
      errors: mode === "error" ? ["Fixture research failed"] : [],
      structured_output: mode === "invalid" ? { wrong: true } : value,
      usage: { input_tokens: 17, cache_read_input_tokens: 3, output_tokens: 7 },
    });
  }
}
