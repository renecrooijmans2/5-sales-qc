# 5+ sales QC — dashboard

A modular interface on top of the Notion board **“1. USA - Back end”** (the *5+ sales
quality control* database). One unified view across all stores — there is no store
switcher.

The board stays the source of truth: everything the dashboard shows is read from
Notion, and everything the AI concludes is written back to Notion. Close the
browser mid-run and nothing is lost.

---

## What it does

**List view.** Three statuses in the left rail — *Not started*, *In progress*,
*Done* — opening on **In progress**. The table is deliberately plain: status,
date, and the product name distilled from the `Product` URL
(`…/products/sumlor-asymmetric-button-midi-dress-with-pockets-for-summer` →
*Sumlor – Asymmetric Button Midi Dress with Pockets for Summer*).

**“Run all quality controls”** (top right) runs the AI over every product that is
**In progress** *and* where the supplier has delivered at least one of:

| Notion field | |
|---|---|
| `图片 QC ` | factory QC photos |
| `面料 Material ` | the real material |
| `尺码表 Size` | the supplier size chart |

Products still waiting on the supplier are skipped and marked *Awaiting supplier*
in the list. The button shows how many products are eligible, and progresses
`Running 3/12…` while it works, two products at a time (`RUN_CONCURRENCY` at the
top of `QCDashboard.jsx`). A product that has been checked before is checked
again — the run is “everything In progress that is ready”, not “everything new”.

A board of ~600 rows costs Notion seven sequential pages (~10 seconds), so
`/api/rows` caches its answer for 90 seconds and the dashboard patches rows in
place after a run instead of refetching the board. **Refresh** (next to the
search box) forces a fresh read.

**Focus view** (click any row):

* the main product image with all `图片 QC ` photos beside it
* links: competitor (greyed out when empty), Shopify Admin per active store, the
  live page per store, and the Notion page
* the Clarendale / Lark & Clover / Lume Haven product IDs, greyed out
* **CJ price**, **WIIO old**, **WIIO new** side by side, with the **new COG %**
  next to them — WIIO new ÷ current selling price, coloured
  **green under 28%**, **orange 28–29.9%**, **red 30%+**. CJ and WIIO old stay
  grey; whichever of *CJ price* and *WIIO new* is cheaper is highlighted blue.
* the **AI recommendation**, the supplier fields, and the listing-action tags

---

## The four quality controls

Two AI passes per product, run in parallel. Both are vision calls — the live
listing photos and the factory QC photos go into the model.

1. **Material** — does the material claimed on the product page match `面料 Material`?
   The house convention of writing look-alike wording (“soft cotton-blend”,
   “vegan leather (PU)”, “linen-look polyester”) is treated as **correct**, exactly
   as specified in the Product listing suite. Only a hard contradiction is flagged —
   e.g. the page says *100% mercerized cotton* while the supplier says *nylon*.
2. **Product images** — do the listing photos match the QC photos on features,
   material texture, size, 2D vs 3D, texture, fit and construction? A little
   marketing is fine; a clear discrepancy is not. Colour differences are never
   flagged — the QC photo shows one random colourway.
3. **Functionality** — do the functions the page promises (pockets, lining,
   built-in support, storage, …) actually appear in the QC photos?
4. **Size chart** — the supplier image from `尺码表 Size` is processed with the house
   **Sizechart prompt** (`prompts/sizechart.md`), then compared against the chart
   that is live on Shopify today. Correct → it says so. Not correct → it names the
   missing sizes and the per-size differences, and produces the corrected HTML.

Each check returns **OK**, **Flagged** or **No data**. The AI says *No data*
rather than guessing when the evidence is missing.

### What lands back in Notion

| Notion property | Written |
|---|---|
| `Listing actions` | a tag per flagged check — *Edit material*, *Edit images*, *Edit functionality*, *Edit sizechart*. Tags set by hand are never removed, and **Discontinue is never set automatically** — killing a product stays a human decision. |
| `AI QC` | one-line verdict + summary |
| `AI QC date` | the run date |
| `Materials check` / `Sizechart check` | ticked when that check came back OK |
| `Updated sizechart` | a link to the corrected chart, when one is needed |
| page body | the full report as a JSON code block (this is what the focus view reads) |

The corrected size chart is served by this app at
`/api/sizechart?page=<notion page id>` — so the link in Notion always shows the
latest version. Add `&raw=1` for the bare HTML to paste into the Shopify metafield.

Tags can also be toggled by hand in the focus view; they sync straight to Notion.

---

## Deploying to Vercel

1. Push this folder to a Git repo and import it in Vercel. It is a plain Vite +
   React app with serverless functions in `api/` — no framework configuration needed.
2. Add the environment variables from **`.env.example`** under
   *Settings → Environment Variables*.
3. Connect the Notion integration to the board: open the **5+ sales quality
   control** page in Notion → `•••` → *Connections* → add the integration whose
   key you used for `NOTION_API_KEY`.

### ⚠️ The QC run needs a Vercel plan with long functions

A single product takes **roughly 60 seconds** (two vision calls over ~10 images).
`api/qc-run.js` therefore declares `maxDuration: 300`. Vercel's **Hobby plan caps
functions at 60 seconds**, which this will exceed — deploy on **Pro** (or higher),
where the declared 300 seconds is honoured.

### Which keys the backend manager needs

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `NOTION_API_KEY` | the Notion integration connected to the QC page |
| `CLARENDALE_SHOPIFY_CLIENT_ID` / `_SECRET` / `_STORE` | the Clarendale custom app (needs `read_products`) |
| `LARK_SHOPIFY_CLIENT_ID` / `_SECRET` / `_STORE` | the Lark & Clover custom app (needs `read_products`) |

Shopify auth uses the **client-credentials grant** — the static `shpat_` tokens
were retired on 1 January 2026.

---

## Running it locally

`vite dev` serves the SPA only and every `/api/*` call would 404, so there is a
small dev server that runs the same handlers in-process:

```bash
npm install
npm run build
node scripts/dev-server.mjs        # http://localhost:5180
```

It reads credentials from `./.env`, falling back to `../.env` (the shared
*5+ sales QC* env file). Add `ANTHROPIC_API_KEY` there to exercise the QC run.

Handy checks that don't need a browser:

```bash
node scripts/smoke.mjs rows                 # board contents + what is QC-ready
node scripts/smoke.mjs product <pageId>     # everything the focus view loads
node scripts/smoke.mjs run <pageId>         # a real QC run (spends API credit)
node scripts/test-pricing.mjs               # the supplier-price parser
```

---

## Files

| | |
|---|---|
| `QCDashboard.jsx` | the whole UI — list view, focus view, run-all orchestration |
| `shared/pricing.js` | supplier-price parsing and the COG bands, used by both sides |
| `api/rows.js` | the board, shaped for the list |
| `api/product.js` | one product: Notion row + Shopify record per store + stored report |
| `api/qc-run.js` | runs the four checks and writes everything back to Notion |
| `api/sizechart.js` | renders the corrected size chart (this is the Notion link target) |
| `api/tags.js` | toggling listing-action tags and status by hand |
| `api/_lib/` | Notion, Shopify and Anthropic clients + the QC prompts (underscore-prefixed so Vercel does not publish them as endpoints) |
| `prompts/sizechart.md` | the house Sizechart prompt — **the source of truth** |
| `api/_lib/sizechart-prompt.js` | generated from it; rerun `node scripts/build-sizechart-prompt.mjs` after editing the prompt |

### Notion properties this expects

Already added to the board: the `Listing actions` options *Edit images, Edit
material, Edit sizechart, Edit functionality, Edit details, Edit price,
Discontinue*, plus the `AI QC` (text) and `AI QC date` (date) properties.

### Model

`claude-opus-5` by default; override with the `QC_MODEL` environment variable.
Budget roughly **$0.30–0.60 per product** per run — two vision calls over about a
dozen images plus the ~11k-token Sizechart prompt.
