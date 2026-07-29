// Local dev server — serves the built dashboard and runs the /api handlers
// in-process, so you can use the whole thing without a Vercel login.
//
//   npm run build && node scripts/dev-server.mjs      → http://localhost:5180
//
// Credentials come from ./.env, falling back to ../.env (the shared
// "5+ sales QC" env file). On Vercel the same handlers run unchanged.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");

for (const p of [join(root, ".env"), join(root, "..", ".env")]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT || 5180);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

if (!existsSync(dist)) {
  console.error("dist/ is missing — run `npm run build` first.");
  process.exit(1);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "");
    const file = join(root, "api", `${name}.js`);
    if (!existsSync(file)) return send(res, 404, "text/plain", "No such endpoint");

    const body = await readBody(req);
    const shim = {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
      body,
    };
    const out = { code: 200, headers: {} };
    const resShim = {
      setHeader(k, v) { out.headers[k] = v; },
      status(c) { out.code = c; return resShim; },
      json(j) { send(res, out.code, "application/json", JSON.stringify(j), out.headers); return resShim; },
      send(s) { send(res, out.code, out.headers["Content-Type"] || "text/plain", String(s), out.headers); return resShim; },
    };
    try {
      // Bust the module cache on edit only — keying on Date.now() would also
      // throw away module state (e.g. the /api/rows board cache) every request.
      const mod = await import(`${file}?v=${statSync(file).mtimeMs}`);
      await mod.default(shim, resShim);
    } catch (e) {
      console.error(`[api/${name}]`, e);
      send(res, 500, "application/json", JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  // Static files, with an SPA fallback to index.html.
  const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  let file = join(dist, rel === "/" ? "index.html" : rel);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  send(res, 200, MIME[extname(file)] || "application/octet-stream", readFileSync(file));
}).listen(PORT, () => {
  console.log(`QC dashboard  →  http://localhost:${PORT}`);
  const missing = ["NOTION_API_KEY", "ANTHROPIC_API_KEY", "CLARENDALE_SHOPIFY_CLIENT_ID", "LARK_SHOPIFY_CLIENT_ID"].filter((k) => !process.env[k]);
  if (missing.length) console.log(`⚠️  missing env: ${missing.join(", ")}`);
});

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.method !== "POST") return resolve({});
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}
