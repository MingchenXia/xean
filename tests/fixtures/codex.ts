import { spawn } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const directory =
  process.env.XEAN_FIXTURE === "unchanged"
    ? process.env.HOME!
    : dirname(process.argv[1]!);
const args = process.argv.slice(2);
if (args.includes("descendant")) {
  process.on("SIGTERM", () => {});
  await writeFile(join(directory, "descendant.ready"), "ready");
  setInterval(() => {}, 1000);
} else if (args.includes("exec")) {
  const input = JSON.parse(await Bun.stdin.text()) as {
    mode: string;
    assignment?: string;
    task?: { problem: string };
    notes?: { id: string; premises: string[] }[];
  };
  const profile = args.findIndex((arg) => arg === "--profile" || arg === "-p");
  await appendFile(
    join(directory, "invocations.jsonl"),
    JSON.stringify({
      ...input,
      profile: profile < 0 ? null : args[profile + 1],
      reasoning: args.find((arg) => arg.startsWith("model_reasoning_effort=")),
      shell: args.find((arg) => arg.startsWith("features.shell_tool=")),
      webSearch: args.find((arg) => arg.startsWith("web_search=")),
      sandbox: args[args.indexOf("--sandbox") + 1],
      workspace: process.cwd(),
      schema: args[args.indexOf("--output-schema") + 1],
      codexHome: process.env.CODEX_HOME,
      marker: process.env.XEAN_FIXTURE,
      usageTag: process.env.XEAN_CODEX_USAGE_TAG,
    }) + "\n",
  );
  if (args.includes("features.shell_tool=true")) {
    await writeFile("program.ts", "console.log(25);\n");
    await writeFile("output.txt", input.mode ?? input.assignment ?? "");
  }
  const event = (value: unknown) => console.log(JSON.stringify(value));
  if (input.mode === "wait") {
    const child = spawn(
      process.execPath,
      [import.meta.filename, "descendant"],
      {
        stdio: "ignore",
      },
    );
    process.on("SIGTERM", () => process.exit(0));
    while (!(await Bun.file(join(directory, "descendant.ready")).exists()))
      await Bun.sleep(5);
    event({
      type: "turn.completed",
      usage: { input_tokens: 7, output_tokens: 0 },
    });
    await writeFile(
      join(directory, "processes.json"),
      JSON.stringify([process.pid, child.pid]),
    );
    setInterval(() => {}, 1000);
  } else {
    const schema = args[args.indexOf("--output-schema") + 1]!;
    JSON.parse(await readFile(schema, "utf8"));
    const result = input.assignment
      ? JSON.parse(input.assignment)
      : input.notes
        ? {
            results: input.notes
              .map((note) => ({
                noteId: note.id,
                result: {
                  verdict: "PASS",
                  report: "Checked",
                  correction: null,
                  passages: note.premises.map((quote, premise) => ({
                    premise,
                    ...(input.task?.problem.includes(quote)
                      ? { url: "urn:xean:task", quote: input.task.problem }
                      : { url: "https://example.com/paper", quote }),
                  })),
                },
              }))
              .reverse(),
          }
        : { answer: 25 };
    if (input.notes && !input.assignment)
      event({ type: "item.completed", item: { type: "web_search" } });
    event({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: input.mode === "invalid" ? "not JSON" : JSON.stringify(result),
      },
    });
    event({
      type: "turn.completed",
      usage: { input_tokens: 11, cached_input_tokens: 3, output_tokens: 5 },
    });
    if (input.mode === "nonzero") {
      console.error("Fixture failed after reporting usage");
      process.exitCode = 7;
    }
  }
} else {
  throw new Error("Unexpected fixture command");
}
