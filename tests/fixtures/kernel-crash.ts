import { appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Xean } from "../../packages/core/src/index.ts";
import { openXeanStorage } from "../../packages/core/src/storage.ts";

const argument = process.argv[2];
const mode = process.argv[3];
if (!argument || !["seed", "recover"].includes(mode ?? ""))
  throw new Error("Usage: kernel-crash.ts <directory> <seed|recover>");
const directory = resolve(argument);
const engine = await Xean.open(
  await openXeanStorage(join(directory, "campaign.sqlite")),
  {
    task: { statement: "Exact P" },
    limits: { concurrency: 1, attempts: 2 },
    roles: [
      {
        name: "worker",
        async run(input) {
          await appendFile(
            join(directory, "invocations.jsonl"),
            JSON.stringify(input) + "\n",
          );
          if (mode === "seed" && input === "interrupted") {
            const blocked = new Promise<void>((done, reject) => {
              process.stdin.once("data", () => done());
              process.stdin.once("error", reject);
              process.stdin.resume();
            });
            console.log("ready");
            await blocked;
          }
          return input;
        },
      },
    ],
    coordinator: {
      name: "crash fixture",
      async run(signal, view) {
        return {
          state: view.work
            .filter((work) => work.status === "completed")
            .map((work) => work.id),
          ...(signal.kind === "start"
            ? {
                dispatch: [
                  { id: "committed", role: "worker", input: "committed" },
                  { id: "interrupted", role: "worker", input: "interrupted" },
                ],
              }
            : {}),
        };
      },
    },
  },
);
try {
  console.log(JSON.stringify(await engine.run()));
} finally {
  await engine.close();
}
