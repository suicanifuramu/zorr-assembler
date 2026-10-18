import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const minutes = Number(process.env.TUNNEL_MINUTES ?? 30);
if (!Number.isFinite(minutes) || minutes <= 0)
  throw new Error("TUNNEL_MINUTES must be positive");
let tunnel;
let timer;
let stopping = false;
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"],
});
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  tunnel?.kill("SIGTERM");
  server.kill("SIGTERM");
  process.exitCode = code;
  console.log("[tunnel] Temporary preview stopped.");
}
server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (tunnel || stopping || !String(chunk).includes("Local:")) return;
  console.log(
    `[tunnel] Expires at ${new Date(Date.now() + minutes * 60_000).toISOString()} (${minutes} minutes)`,
  );
  tunnel = spawn(
    "cloudflared",
    [
      "tunnel",
      "--url",
      `http://127.0.0.1:${port}`,
      "--no-autoupdate",
      "--protocol",
      "http2",
    ],
    { stdio: "inherit" },
  );
  tunnel.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  tunnel.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
  timer = setTimeout(() => stop(), minutes * 60_000);
});
server.on("error", (error) => {
  console.error(error.message);
  stop(1);
});
server.on("exit", (code) => {
  if (!stopping) stop(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => stop());
