# Deploying PRism

PRism is a **static, zero-build, dependency-free** site. "Deploy" just means
serving the files. Total time from here to a live URL: about 3 minutes.

There are two things to do: **(1) push to GitHub**, then **(2) point Vercel at
the repo**. Both configs (`vercel.json`, `netlify.toml`) are already committed,
so there is nothing to configure on the host.

---

## 1. Push to GitHub

### The one-command way (uses the GitHub CLI)

From inside the project folder, in **WSL** or **Git Bash**:

```bash
bash deploy-to-github.sh
```

That script runs the full test suite first (it will **not** push a red build),
initializes git, commits, then creates the repo and pushes — in one shot. Safe
to re-run; if the repo already exists it just pushes again.

> First time only: if `gh` isn't logged in, run `gh auth login` once, then
> re-run the script. Install gh from https://cli.github.com if you don't have it.

### The manual way (no gh CLI)

1. Create an **empty** repo on github.com (no README, no .gitignore).
2. Then, from the project folder:

```bash
npm test                      # gate: make sure it's green first
git init
git branch -M main
git add -A
git commit -m "PRism: offline privacy-first PR risk radar"
git remote add origin https://github.com/<you>/prism-risk-radar.git
git push -u origin main
```

### If GitHub blocks the push over a "secret"

`src/samples.js` contains **fake** secret-shaped fixtures (`AKIA5FAKE0KEY…`,
`sk_live_…demo…`, `hunter2…`) — they are the demo diffs PRism itself detects,
not real credentials. If push protection stops you, open the URL it prints and
allow it ("used in tests"). `.github/secret_scanning.yml` already excludes that
file from scan **alerts**; push protection on the very first push may still ask.

---

## 2. Deploy to Vercel

### Option A — Dashboard (easiest)

1. Go to https://vercel.com → **Add New… → Project**.
2. **Import** the `prism-risk-radar` repo.
3. **Framework Preset:** `Other`. Leave Build Command and Output Directory
   **empty** (it's already static). Root Directory: `./`.
4. Click **Deploy**. You'll get a `https://prism-risk-radar-*.vercel.app` URL.

`vercel.json` applies clean URLs and the strict security headers (CSP with
`connect-src 'self'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`)
automatically.

### Option B — CLI

```bash
npm i -g vercel
vercel --prod       # run from the project folder; accept the defaults
```

### Landing page vs app

- `/` and `/index.html` → **the app** (paste a diff, get a score).
- `/landing.html` → **the cinematic landing page** (the WebGL prism + brand story).

If you'd rather the landing page be the front door, add a redirect in
`vercel.json` (say the word and I'll wire it), or just link people straight to
`/landing.html`.

---

## 3. Verify the live deploy (30-second checklist)

- [ ] Site loads at the Vercel URL; the gauge and sample chips render.
- [ ] Click a sample (e.g. **Leaked credentials**) → score sweeps to **98**.
- [ ] Open DevTools → **Network**, reload → **no requests** after the initial
      files (fonts may load once, then cache). This is the privacy proof.
- [ ] DevTools → **Application → Service Workers**: `sw.js` is *activated*.
- [ ] Kill your network / toggle **Offline**, reload → the app still works (PWA).
- [ ] Open `/landing.html` → the prism renders (or the CSS fallback shows on
      machines without WebGL) and scroll captions fire.

If all six pass, PRism is live and the privacy story is browser-verified.

---

## What's deployed

Static files only: `index.html`, `landing.html`, `assets/`, `src/`, `icon.svg`,
`manifest.webmanifest`, `sw.js`. The Node CLI (`bin/prism.js`), tests, GitHub
Action, and `.prism.json` ride along in the repo for CI use but aren't part of
the served site. No server, no database, no build step, no secrets.
