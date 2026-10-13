import { expect, test } from "bun:test";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { open, readReport } from "../src/index.ts";
import { ExternalLog, ExternalRequest } from "../src/roles/backend.ts";
import { RoleFailure } from "../src/roles/types.ts";
import {
  claude,
  claudeCall,
  claudeTranscript,
} from "../src/plugins/role-backends/claude.ts";
import { codexCall } from "../src/plugins/role-backends/codex.ts";
import { explorationSchema } from "../src/math/contracts.ts";
import { temporaryDirectory } from "./directory.ts";
import { context, noteResult, settings, task } from "./fixture.ts";

const success = {
  type: "result",
  subtype: "success",
  is_error: false,
  structured_output: noteResult,
  usage: { input_tokens: 41, output_tokens: 9, cache_read_input_tokens: 23 },
  total_cost_usd: 0.001,
};

async function command(source: string) {
  const workspace = await temporaryDirectory("optional-cli-");
  const executable = join(workspace, "fixture");
  await writeFile(executable, `#!${process.execPath}\n${source}\n`);
  await chmod(executable, 0o700);
  return { model: "fixture", command: executable, workspace };
}

test("Claude uses native schema/stdin and journals structured output, usage, and provider identity", async () => {
  const options = await command(`
    const args = process.argv.slice(2);
    const parameter = flag => args[args.indexOf(flag) + 1];
    if (parameter('--output-format') !== 'json' || !args.includes('--no-session-persistence')) throw new Error('Wrong CLI mode');
    const schema = JSON.parse(parameter('--json-schema'));
    if (!schema.properties.notes) throw new Error('Missing output schema');
    const input = await Bun.stdin.json();
    if (!input.task || !input.assignment || require('node:fs').realpathSync(input.workspace) !== process.cwd()) throw new Error('Missing frozen task');
    process.stdout.write(${JSON.stringify(JSON.stringify(success))});
  `);
  const owner = await open(join(options.workspace, "campaign.sqlite"), {
    create: {
      task,
      settings,
      mode: {
        role: "implementation",
        input: { notes: [], assignment: "Prove reflexivity" },
      },
    },
    roles: claude({ implementation: options }),
  });
  try {
    await owner.root.waitForIdle(context);
    const report = await owner.root.commit(
      (tx) => readReport(tx, owner.root.id, { records: true }),
      context,
    );
    expect(report.status).toMatchObject({ status: "completed" });
    const request = report.records!.find(ExternalRequest.is)!.data;
    expect(request).toMatchObject({
      provider: "claude-cli",
      api: "claude-print",
      model: "fixture",
    });
    const log = report.records!.find(ExternalLog.is)!.data;
    expect(log).toMatchObject({
      operationId: request.operationId,
      exitCode: 0,
      usage: { ...success.usage, cost_usd: 0.001 },
    });
  } finally {
    await owner.close();
  }
});

test("completed plugin calls reuse Pi results; recovery rejects another adapter or changed configuration", async () => {
  const options = await command(
    `process.stdout.write(${JSON.stringify(JSON.stringify(success))});`,
  );
  const owner = await open(join(options.workspace, "campaign.sqlite"), {
    create: {
      task,
      settings,
      mode: {
        role: "implementation",
        input: { notes: [], assignment: "Prove reflexivity" },
      },
    },
    roles: () => ({
      async implementation(input, runtime, context) {
        const call = claudeCall(options);
        const args = [
          "worker",
          explorationSchema,
          "Exact task",
          input,
          runtime,
          context,
        ] as const;
        const first = await call(...args);
        const original = structuredClone(first);
        first.value.notes[0]!.text = "Changed caller copy";
        expect(await call(...args)).toEqual(original);
        // Property order is not configuration identity.
        expect(
          await claudeCall({
            workspace: options.workspace,
            command: options.command,
            model: options.model,
          })(...args),
        ).toEqual(original);
        await expect(
          claudeCall({ ...options, model: "changed" })(...args),
        ).rejects.toThrow("configuration changed");
        await expect(codexCall(options)(...args)).rejects.toThrow(
          "configuration changed",
        );
        return { kind: "notes", ...original.value };
      },
    }),
  });
  try {
    await owner.root.waitForIdle(context);
    const report = await owner.root.commit(
      (tx) => readReport(tx, owner.root.id, { records: true }),
      context,
    );
    expect(report.status).toMatchObject({ status: "completed" });
    expect(report.records!.filter(ExternalLog.is)).toHaveLength(1);
    expect(report.records!.filter(ExternalRequest.is)).toHaveLength(1);
  } finally {
    await owner.close();
  }
});

test.each([
  {
    ...success,
    subtype: "error_max_turns",
    is_error: true,
    result: "Turn limit reached",
  },
  {
    ...success,
    subtype: "error_during_execution",
    is_error: true,
    errors: ["Provider unavailable"],
  },
])(
  "Claude failed results retain accounting and fail even with structured output present",
  (event) => {
    const parsed = claudeTranscript(JSON.stringify(event));
    expect(parsed.error).toBeInstanceOf(RoleFailure);
    expect(parsed.value).toBeUndefined();
    expect(parsed.usage).toEqual({ ...success.usage, cost_usd: 0.001 });
  },
);

test.each([
  "",
  "not json",
  JSON.stringify({ type: "assistant" }),
  JSON.stringify({ type: "result", subtype: "success" }),
])("Claude requires a complete native structured result: %j", (output) => {
  const parsed = claudeTranscript(output);
  expect(parsed.error).toBeInstanceOf(Error);
  expect(parsed.value).toBeUndefined();
});
