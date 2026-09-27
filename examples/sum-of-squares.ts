import type { XeanOptions } from "../packages/core/src/index.ts";

/** The deterministic and live examples share the same scheduling and acceptance. */
export const sumOfSquares: Pick<XeanOptions, "coordinator" | "accept"> = {
  coordinator: {
    name: "xean.sum",
    run(signal, view) {
      if (signal.kind === "start") {
        return {
          state: "waiting",
          dispatch: [3, 4].map((input) => ({
            id: `xean.square.${input}`,
            role: "xean.square",
            input,
          })),
        };
      }
      if (!view.work.every((work) => work.status === "completed")) {
        return { state: "waiting" };
      }
      return {
        state: "finished",
        completion: view.work.reduce(
          (sum, work) => sum + Number(work.result),
          0,
        ),
      };
    },
  },
  accept: (candidate, view) =>
    candidate === 25 &&
    view.work.length === 2 &&
    view.work.every((work) => work.status === "completed"),
};
