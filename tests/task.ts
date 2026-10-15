import type { Context } from "@earendil-works/chord";
import { defineTask } from "@earendil-works/pi-durable";

/** A real Pi child task; each test controls its work and cancellation barriers. */
export function fixtureTask(
  name: string,
  run: (context: Context) => void | Promise<void>,
  abort?: (context: Context) => void | Promise<void>,
) {
  return defineTask<null, { phase: "run" }, null>({
    name,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      async run(_task, runtime, context) {
        await run(context);
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: null },
          }),
          context,
        );
      },
    },
    async abort(_task, runtime, context) {
      await abort?.(context);
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted" } }),
        context,
      );
    },
  });
}
