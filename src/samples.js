/*
 * PRism — sample diffs
 * ---------------------------------------------------------------------------
 * Curated, realistic diffs so anyone can see the radar work in one click.
 * Each is a real unified diff the parser handles as-is.
 */
(function (root) {
  "use strict";

  var SAMPLES = [
    {
      id: "leaked-secret",
      label: "Leaked credentials",
      note: "The one every scanner should catch",
      diff:
"diff --git a/config/settings.py b/config/settings.py\n" +
"index 8f2a1c0..b3d9e77 100644\n" +
"--- a/config/settings.py\n" +
"+++ b/config/settings.py\n" +
"@@ -10,4 +10,8 @@ import os\n" +
" \n" +
"-DEBUG = False\n" +
"+DEBUG = True\n" +
" \n" +
"+STRIPE_SECRET = \"sk_live_51KdJ2xQwErTyUiOpAsDfGhup\"\n" +
"+AWS_ACCESS_KEY_ID = \"AKIA5FAKE0KEY1234567\"\n" +
"+DATABASE_PASSWORD = \"prod_p@ssw0rd_do_not_share\"\n" +
"+\n" +
" ALLOWED_HOSTS = [\"*\"]\n" +
"diff --git a/.env b/.env\n" +
"new file mode 100644\n" +
"index 0000000..a1b2c3d\n" +
"--- /dev/null\n" +
"+++ b/.env\n" +
"@@ -0,0 +1,2 @@\n" +
"+GITHUB_TOKEN=ghp_ab12CD34ef56GH78ij90KL12mn34OP56qr78\n" +
"+SESSION_SECRET=hunter2hunter2hunter2\n"
    },
    {
      id: "risky-security",
      label: "Risky feature",
      note: "Ships, but with sharp edges",
      diff:
"diff --git a/src/api/search.js b/src/api/search.js\n" +
"index 1122334..5566778 100644\n" +
"--- a/src/api/search.js\n" +
"+++ b/src/api/search.js\n" +
"@@ -3,10 +3,21 @@ const db = require('./db');\n" +
" \n" +
" async function search(req, res) {\n" +
"-  const rows = await db.query('SELECT * FROM items WHERE name = $1', [req.query.q]);\n" +
"+  const rows = await db.query(\"SELECT * FROM items WHERE name = '\" + req.query.q + \"'\");\n" +
"   res.setHeader('Access-Control-Allow-Origin', '*');\n" +
"-  res.json(rows);\n" +
"+  document.getElementById('out').innerHTML = render(rows);\n" +
"+  res.json(rows);\n" +
" }\n" +
"+\n" +
"+function preview(tpl, ctx) {\n" +
"+  // TODO: sanitize before shipping\n" +
"+  return eval('`' + tpl + '`');\n" +
"+}\n" +
"+\n" +
"+console.log('search debug', req.query);\n" +
"diff --git a/src/http/client.py b/src/http/client.py\n" +
"index aa00bb1..cc22dd3 100644\n" +
"--- a/src/http/client.py\n" +
"+++ b/src/http/client.py\n" +
"@@ -1,5 +1,7 @@\n" +
" import requests\n" +
" \n" +
"-def fetch(url):\n" +
"-    return requests.get(url, timeout=5)\n" +
"+def fetch(url):\n" +
"+    return requests.get(url, timeout=5, verify=False)\n"
    },
    {
      id: "dropped-tests",
      label: "Feature, tests dropped",
      note: "New logic, safety net removed",
      diff:
"diff --git a/src/pricing.ts b/src/pricing.ts\n" +
"index 3141592..2718281 100644\n" +
"--- a/src/pricing.ts\n" +
"+++ b/src/pricing.ts\n" +
"@@ -8,6 +8,40 @@ export interface Cart {\n" +
" }\n" +
" \n" +
"+const CODES: Record<string, number> = {\n" +
"+  WELCOME10: 0.10,\n" +
"+  HALF: 0.50,\n" +
"+  FREESHIP: 0.00,\n" +
"+};\n" +
"+\n" +
"+export function applyDiscount(cart: Cart, code: string): number {\n" +
"+  let total = cart.items.reduce((s, i) => s + i.price * i.qty, 0);\n" +
"+  const trimmed = (code || '').trim().toUpperCase();\n" +
"+  if (trimmed in CODES) {\n" +
"+    total *= 1 - CODES[trimmed];\n" +
"+  } else if (trimmed.startsWith('BULK')) {\n" +
"+    const n = parseInt(trimmed.slice(4), 10);\n" +
"+    if (!Number.isNaN(n)) total *= 1 - Math.min(n, 40) / 100;\n" +
"+  }\n" +
"+  if (cart.items.length >= 10) total *= 0.95;\n" +
"+  return Math.round(total * 100) / 100;\n" +
"+}\n" +
"+\n" +
"+export function taxFor(region: string, amount: number): number {\n" +
"+  const rates: Record<string, number> = { EU: 0.2, US: 0.07, IN: 0.18 };\n" +
"+  const rate = rates[region] ?? 0;\n" +
"+  return Math.round(amount * rate * 100) / 100;\n" +
"+}\n" +
"+\n" +
"+export function checkout(cart: Cart, code: string, region: string): number {\n" +
"+  const discounted = applyDiscount(cart, code);\n" +
"+  const tax = taxFor(region, discounted);\n" +
"+  return Math.round((discounted + tax) * 100) / 100;\n" +
"+}\n" +
"diff --git a/tests/pricing.test.ts b/tests/pricing.test.ts\n" +
"deleted file mode 100644\n" +
"index 9990001..0000000\n" +
"--- a/tests/pricing.test.ts\n" +
"+++ /dev/null\n" +
"@@ -1,18 +0,0 @@\n" +
"-import { applyDiscount } from '../src/pricing';\n" +
"-\n" +
"-test('welcome code', () => {\n" +
"-  expect(applyDiscount(cart, 'WELCOME10')).toBe(90);\n" +
"-});\n" +
"-\n" +
"-test.only('half code', () => {\n" +
"-  expect(applyDiscount(cart, 'HALF')).toBe(50);\n" +
"-});\n"
    },
    {
      id: "clean-change",
      label: "Clean change",
      note: "What a low-risk PR looks like",
      diff:
"diff --git a/src/format.ts b/src/format.ts\n" +
"index 1010101..2020202 100644\n" +
"--- a/src/format.ts\n" +
"+++ b/src/format.ts\n" +
"@@ -1,7 +1,11 @@\n" +
" export function formatBytes(n: number): string {\n" +
"-  return n + ' B';\n" +
"+  const units = ['B', 'KB', 'MB', 'GB'];\n" +
"+  let i = 0;\n" +
"+  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }\n" +
"+  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;\n" +
" }\n" +
"diff --git a/tests/format.test.ts b/tests/format.test.ts\n" +
"index 3030303..4040404 100644\n" +
"--- a/tests/format.test.ts\n" +
"+++ b/tests/format.test.ts\n" +
"@@ -1,4 +1,8 @@\n" +
" import { formatBytes } from '../src/format';\n" +
" \n" +
" test('bytes', () => {\n" +
"   expect(formatBytes(512)).toBe('512 B');\n" +
"+  expect(formatBytes(2048)).toBe('2.0 KB');\n" +
"+  expect(formatBytes(1048576)).toBe('1.0 MB');\n" +
" });\n"
    },
    {
      id: "trojan-source",
      label: "Trojan source",
      note: "Invisible Unicode most tools miss",
      diff:
"diff --git a/src/auth.js b/src/auth.js\n" +
"index a1b2c3d..d4e5f6a 100644\n" +
"--- a/src/auth.js\n" +
"+++ b/src/auth.js\n" +
"@@ -4,6 +4,11 @@ function checkAccess(user) {\n" +
" \n" +
"+  // Only admins may proceed‮ ⁦// but this comment hides logic⁩‬\n" +
"+  if (user.isAdmin) {\n" +
"+    return grant();\n" +
"+  }\n" +
"+  const token = \"aGVsbG8gd29ybGRzZWNyZXRrZXlhYmMxMjN4eXo5ODc2NTQzMjE\";\n" +
"+  return deny(token);\n" +
" }\n"
    },
    {
      id: "big-refactor",
      label: "Large refactor",
      note: "No bug, just hard to review",
      diff: (function () {
        var d = "diff --git a/src/engine.js b/src/engine.js\n" +
          "index 1111111..2222222 100644\n--- a/src/engine.js\n+++ b/src/engine.js\n" +
          "@@ -1,3 +1,120 @@\n class Engine {\n";
        for (var i = 0; i < 118; i++) {
          if (i % 7 === 0) d += "+  if (this.state[" + i + "] && cfg.flag" + i + ") {\n";
          else if (i % 7 === 3) d += "+    for (var j = 0; j < items" + i + ".length; j++) {\n";
          else d += "+    step" + i + "(this.ctx, " + i + ");\n";
        }
        d += " }\n";
        return d;
      })()
    }
  ];

  root.PRism = root.PRism || {};
  root.PRism.samples = SAMPLES;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SAMPLES;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
