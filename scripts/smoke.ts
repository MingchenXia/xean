import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyInstall } from "./dependencies.ts";

/** Saturn smoke bootstrap; credentials remain in memory and go to child stdin. */
export async function smokeSetup(name: string) {
  const secretPath = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !secretPath ||
    !/^codex-lb\/[a-zA-Z0-9_.-]+$/.test(secretPath)
  )
    throw new Error(`Usage: scripts/${name}-smoke.ts codex-lb/KEY_NAME`);
  const root = resolve(import.meta.dir, "..");
  await verifyInstall(root);
  const ca = "/etc/fleet/ca/fleet-lab-root.pem";
  const reader =
    "/usr/local/share/fleet-infra/apps/openbao/bin/fleet-secret.ts";
  await Promise.all([access(ca), access(reader)]);
  // fleet-run clears NODE_* on entry. Set the CA for the same locked Bun child.
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: ca };
  const bun = [process.execPath, "--no-install", "--no-env-file"];
  const secret = Bun.spawnSync(
    [...bun, reader, "get", secretPath, "--field=key"],
    { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  if (secret.exitCode !== 0) throw new Error("OpenBao field read failed");
  const credential = secret.stdout;
  if (!credential.toString().trim())
    throw new Error("OpenBao returned an empty credential");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = resolve(root, "runs", `${name}-${runId}`);
  await mkdir(directory, { recursive: true });
  return { root, bun, env, credential, runId, directory };
}
