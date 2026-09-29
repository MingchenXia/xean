import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** This module also runs over SSH. It only reads selected JSON artifacts. */
export async function readArtifacts(directory: string) {
  const find = async (name: string) => {
    const file = join(directory, name);
    const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!info) return undefined;
    return {
      file: Bun.file(file),
      modified: info.mtimeMs,
      at: info.mtime.toISOString(),
    };
  };
  const [observation, result] = await Promise.all([
    find("observation.json"),
    find("result.json"),
  ]);
  const useObservation =
    observation && (!result || observation.modified >= result.modified);
  const latest = useObservation ? observation : result;
  if (latest)
    return {
      kind: useObservation ? ("snapshot" as const) : ("export" as const),
      value: await latest.file.json(),
      at: latest.at,
    };
  const task = await find("task.json");
  if (!task)
    throw new Error("No observation, result, or task file in this run");
  const rounds = (await readdir(directory)).flatMap((name) => {
    const match = /^round-(\d+)\.json$/.exec(name);
    return match ? [Number(match[1])] : [];
  });
  const last = rounds.length
    ? await find(`round-${Math.max(...rounds)}.json`)
    : undefined;
  return {
    kind: "heartbeat" as const,
    value: {
      task: await task.file.json(),
      rounds: rounds.length,
      lastRound: await last?.file.json(),
    },
    at: last?.at ?? task.at,
  };
}
