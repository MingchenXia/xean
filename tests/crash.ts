import { open } from "../src/host.ts";
import { context, fixture, task, settings } from "./fixture.ts";
const provider = fixture(async (role) => {
  if (role === "coordinator")
    return { work: { kind: "explorer", assignment: "survive" } };
  console.log("ready");
  return new Response(Bun.stdin.stream()).text();
});
const owner = await open(process.argv[2]!, {
  create: { task, settings },
  models: provider.models,
});
await owner.root.waitForIdle(context);
