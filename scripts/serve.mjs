import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
try {
  await stat(path.join(root, "index.html"));
} catch {
  throw new Error("dist/ is missing. Run npm run build first.");
}
http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const relative =
        decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const file = path.resolve(root, relative);
      if (
        !file.startsWith(root) ||
        relative.split("/").some((p) => p.startsWith(".")) ||
        relative.startsWith("_")
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      const bytes = await readFile(file);
      response.writeHead(200, {
        "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      response.end(await readFile(path.join(root, "404.html")));
    }
  })
  .listen(port, "0.0.0.0", () =>
    console.log(`Local: http://localhost:${port} (dist/ only)`),
  );
