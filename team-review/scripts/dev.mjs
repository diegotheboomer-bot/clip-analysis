import { spawnSync, spawn } from "node:child_process";
const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
  stdio: "inherit",
});
if (build.status) process.exit(build.status);
const migrate = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: ".wrangler/logs/dev.log",
    },
  },
);
if (migrate.status) process.exit(migrate.status);
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--ip",
    "0.0.0.0",
    "--port",
    "4173",
    "--inspector-port",
    "0",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: ".wrangler/logs/dev.log",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
