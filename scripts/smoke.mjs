// Exercises the serverless handlers straight from Node, without Vercel.
// Loads credentials from ../.env (the shared 5+ sales QC env file).
//
//   node scripts/smoke.mjs rows
//   node scripts/smoke.mjs product <notion-page-id>
//   node scripts/smoke.mjs run     <notion-page-id>     # spends Anthropic credit
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
for (const p of [join(here, "..", ".env"), join(here, "..", "..", ".env")]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(c) { res.statusCode = c; return res; },
    json(j) { res.body = j; return res; },
    send(s) { res.body = s; return res; },
  };
  return res;
}

const [, , cmd, arg] = process.argv;

const routes = {
  rows: async () => {
    const { default: h } = await import("../api/rows.js");
    const res = fakeRes();
    await h({ method: "GET", query: {}, headers: {} }, res);
    if (res.statusCode !== 200) return res;
    const { rows, counts } = res.body;
    console.log("counts:", counts);
    const ready = rows.filter((r) => r.status === "In progress" && r.ready);
    console.log(`\nIn progress and QC-ready (${ready.length}):`);
    for (const r of ready) console.log(`  ${r.id}  ${r.name}`);
    console.log("\nfirst 5 rows overall:");
    for (const r of rows.slice(0, 5)) console.log(`  [${r.status}] ${fmt(r.date)}  ${r.name}`);
    return { statusCode: 200, body: "(summarised above)" };
  },
  product: async () => {
    const { default: h } = await import("../api/product.js");
    const res = fakeRes();
    await h({ method: "GET", query: { page: arg }, headers: {} }, res);
    return res;
  },
  run: async () => {
    const { default: h } = await import("../api/qc-run.js");
    const res = fakeRes();
    await h({ method: "POST", body: { page: arg }, headers: { host: "localhost:3000", "x-forwarded-proto": "http" } }, res);
    return res;
  },
};

const fmt = (d) => (d ? d : "----------");

if (!routes[cmd]) {
  console.error("usage: node scripts/smoke.mjs rows | product <pageId> | run <pageId>");
  process.exit(1);
}

const res = await routes[cmd]();
console.log("\nHTTP", res.statusCode);
if (typeof res.body === "string") console.log(res.body.slice(0, 3000));
else console.log(JSON.stringify(res.body, null, 2));
