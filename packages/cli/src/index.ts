#!/usr/bin/env bun
const ca = "/etc/fleet/ca/fleet-lab-root.pem";
if (!process.env.NODE_EXTRA_CA_CERTS && (await Bun.file(ca).exists())) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-install",
      "--no-env-file",
      import.meta.path,
      ...process.argv.slice(2),
    ],
    {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: ca },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  process.exit(await child.exited);
}

// Keep the waiting CA bootstrap parent free of command dependencies.
await import("./commands.ts");
