import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** This module also runs over SSH. It only reads selected JSON artifacts. */
export async function readArtifacts(directory: string) {
  const read = async (name: string) => {
    const file = join(directory, name);
    const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!info) return undefined;
    return { value: await Bun.file(file).json(), at: info.mtime.toISOString() };
  };
  const observation = await read("observation.json");
  if (observation) return { kind: "snapshot" as const, ...observation };
  const result = await read("result.json");
  if (result) return { kind: "export" as const, ...result };
  const task = await read("task.json");
  if (!task)
    throw new Error("No observation, result, or task file in this run");
  const rounds = (await readdir(directory)).flatMap((name) => {
    const match = /^round-(\d+)\.json$/.exec(name);
    return match ? [Number(match[1])] : [];
  });
  const last = rounds.length
    ? await read(`round-${Math.max(...rounds)}.json`)
    : undefined;
  return {
    kind: "heartbeat" as const,
    value: { task: task.value, rounds: rounds.length, lastRound: last?.value },
    at: last?.at ?? task.at,
  };
}
