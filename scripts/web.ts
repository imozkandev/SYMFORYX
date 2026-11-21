import { createServer } from "node:net";
import { existsSync } from "node:fs";

async function findFreePort(startPort: number): Promise<number> {
  for (let p = startPort; p < startPort + 30; p++) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => {
        srv.close(() => resolve(true));
      });
      srv.listen(p, "127.0.0.1");
    });
    if (ok) return p;
  }
  return startPort;
}

if (!existsSync("apps/web/build/index.html")) {
  console.log("Building SYMFORYX Web UI...");
  const build = Bun.spawnSync(["./node_modules/.bin/vite", "build"], {
    cwd: "apps/web",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0) process.exit(build.exitCode);
}

const port = await findFreePort(Number(process.env.SYMFORYX_PORT || 3000));
const url = `http://127.0.0.1:${port}`;
console.log(`\n  ✦ SYMFORYX Local Web Studio → ${url}\n`);

const serverProc = Bun.spawn([process.execPath, "run", "apps/server/src/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    SYMFORYX_PORT: String(port),
    SYMFORYX_HOST: "127.0.0.1",
  },
});

setTimeout(() => {
  if (process.platform === "darwin") {
    Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
  }
}, 900);

const cleanup = () => {
  serverProc.kill();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
await serverProc.exited;
