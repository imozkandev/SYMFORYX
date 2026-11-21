import { createServer } from "node:net";

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

const apiPort = await findFreePort(Number(process.env.SYMFORYX_PORT || 3000));
const webPort = await findFreePort(Number(process.env.SYMFORYX_WEB_PORT || 5173));

console.log(`\n  ✦ SYMFORYX Geliştirme Ortamı başlatılıyor...`);
console.log(`  ✦ API Sunucusu : http://127.0.0.1:${apiPort}`);
console.log(`  ✦ Web Arayüzü  : http://127.0.0.1:${webPort}\n`);

const serverProc = Bun.spawn([process.execPath, "--watch", "apps/server/src/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    SYMFORYX_PORT: String(apiPort),
  },
});

const webProc = Bun.spawn(["./node_modules/.bin/vite", "dev", "--port", String(webPort)], {
  cwd: "apps/web",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    SYMFORYX_API_URL: `http://127.0.0.1:${apiPort}`,
    SYMFORYX_WEB_PORT: String(webPort),
  },
});

const cleanup = () => {
  serverProc.kill();
  webProc.kill();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

await Promise.race([serverProc.exited, webProc.exited]);
cleanup();

