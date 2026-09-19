# Hack Devengers 2.0 — Submission

## Project name
**PRism — the pull-request risk radar that never sees your code**

## One-line pitch
Paste a git diff and get an instant, explainable risk score, the exact danger signals, and a ready-to-use review checklist — running 100% in your browser, with the code never leaving your machine.

## Problem statement
Code review is the last line of defense before bad code ships — leaked secrets, injection holes, dropped tests, risky config. But reviewers are human and attention is finite: on a large pull request, the three riskiest lines hide among three hundred harmless ones. The tools that could help almost all require deep repo integration and upload your source code to a cloud service. For students, solo developers, OSS maintainers, and anyone on a private or air-gapped machine, "upload your code to find out if your code is risky" is a dealbreaker — the tool itself becomes a new risk.

## Solution
PRism reads a diff the way a careful senior reviewer does, instantly and locally:
- A single **risk score (0–100)** with a Low / Moderate / High / Critical tier.
- An **explainable score waterfall** — the number is built from auditable steps (critical signals, churn, added complexity) you can see sum to the score. No black box.
- **CWE/OWASP-tagged signals** — every signal names a rule, a plain-language reason, a concrete fix, a confidence level, and the exact file and line, with the industry-standard weakness ID.
- An **annotated diff viewer** with flagged lines marked in the gutter; click a signal to jump to the offending line.
- **Change metrics** (complexity delta, max nesting, comment ratio, estimated review time) so the score sits beside the shape of the change.
- **A generated, prioritized review checklist** (`must` / `should` / `polish`), and export to **Markdown, JSON, or SARIF 2.1.0** — straight into a PR comment, a script, or GitHub code scanning.

The defining choice: it runs entirely in the browser. The diff never leaves the tab, it needs no account or API key, and it keeps working with the network unplugged.

## Innovation / uniqueness
The category of "AI/automated code review" is crowded — but every serious player is cloud-first and repo-integrated, which means they see your code. PRism inverts the model: a **zero-integration, zero-upload, offline-capable** risk radar where privacy is the architecture, not a setting. The app makes zero network requests of its own, and the deploy config ships a strict Content-Security-Policy (`connect-src 'self'`) that forbids the page from reaching any third-party origin — so "your code never leaves the machine" is *enforced by the browser*, not just claimed in marketing.

Three things lift it above a regex toy: (1) a **language-aware tokenizer** masks strings and comments before matching, so `eval` in a comment stays silent while `eval(userInput)` fires — the precision that makes flags trustworthy; (2) a **Shannon-entropy detector** catches secrets that match no known format while filtering URLs/UUIDs/hashes; (3) it emits real **SARIF 2.1.0**, so a fully local, offline result flows into the same code-scanning dashboards server-side scanners report to. Add fully explainable, line-level scoring with CWE tags and PRism occupies a niche the big tools structurally cannot: review help for code you are not allowed — or not willing — to send to anyone.

And it isn't only a webapp: the *same deterministic engine* runs headless as a zero-dependency CLI and a GitHub Action, gating a pull request with an exit code and posting SARIF annotations. A human pasting a diff into the tab and the pipeline blocking a merge get identical verdicts from one code path — the privacy guarantee (nothing leaves the machine) holds in CI exactly as it does in the browser.

## Key features
- Instant risk score with animated gauge, severity tiers, and an explainable score **waterfall**
- **47 explainable detectors across 16 categories, every one CWE-tagged**: secrets (+ entropy-detected unknowns), injection & XSS sinks, prototype pollution, open redirects, disabled TLS, weak crypto & insecure RNG, wide-open CORS, **trojan-source / invisible-Unicode**, committed merge-conflict markers, focused/skipped & deleted tests, logic-without-tests, dependency/migration changes, debug leftovers, oversized files
- **Language-aware tokenizer** — no false positives from code mentioned in comments or strings
- **Annotated diff viewer** with in-gutter flags, click-a-signal-to-jump-to-line, an only-flagged filter, per-file collapse, a large-diff performance guard, and a clean print stylesheet
- **Change metrics**: complexity delta, max nesting, comment ratio, estimated review time
- **Local, tunable rules** — enable/disable and override severities, saved on-device, exportable as a shareable JSON profile
- **Committable `.prism.json` config** (with a JSON Schema) and **eslint-style `prism-ignore` inline suppressions** that are tokenizer-aware and counted-not-hidden
- **Runs in CI too** — a zero-dependency CLI (`git diff | node bin/prism.js`) with exit-code policy gating, and a **GitHub Action** that uploads SARIF to code scanning and fails the build on policy
- Export as **Markdown / JSON / SARIF 2.1.0**
- One-click sample diffs, drag-and-drop `.patch`/`.diff`
- Installable PWA, fully offline, no dependencies; optional Web Worker with a synchronous fallback
- Deterministic engine covered by a node test suite (156 checks across engine, UI, and end-to-end CLI) + CI on Node 18/20/22

## Tech stack
Vanilla JavaScript (framework-free, ES5-safe), modern CSS, PWA (service worker + manifest), optional Web Worker for off-main-thread analysis. No dependencies, no build step. Node-based test harness. Deploy configs for Netlify and Vercel with a strict privacy CSP (`connect-src 'self'`, `worker-src 'self'`). Static hosting — runs anywhere, including `file://`.

## How to run
1. Double-click `index.html` — it just works, or
2. `npx serve .` / `python -m http.server 5173`, then open the URL and click **Install app** for the offline PWA.
In CI or a terminal: `git diff origin/main... | node bin/prism.js --fail-on critical` (exit 0 = pass, 1 = gate tripped).
Tests: `npm test` (runs the engine + CLI suites; or `node tests/analyzer.test.js`).

## Repository / required files
- Source: `index.html`, `src/`, `assets/`, `sw.js`, `manifest.webmanifest`, `icon.svg`
- CLI + CI: `bin/prism.js`, `action.yml`, `.github/workflows/pr-risk.yml` + `ci.yml`
- Config: `.prism.json`, `prism.schema.json`
- Tests: `tests/analyzer.test.js`, `tests/cli.test.js`
- Docs: `README.md`, this `SUBMISSION.md`, `DEMO_SCRIPT.md`
- Deploy: `netlify.toml`, `vercel.json`
- `LICENSE` (MIT), `.gitignore`, `package.json`

## Demo
See `DEMO_SCRIPT.md` for a 30-second and a two-minute walkthrough. The fastest possible demo: open the app, click the **"Leaked credentials"** sample chip, watch the gauge sweep to **98/Critical**, then open the **Diff** tab to see the exact leaked keys marked in the gutter. Then click the **"Trojan source"** sample — PRism reveals invisible Unicode that a human reviewer physically cannot see.

## Team
Solo build.

## What's next
A pastable "PR summary → risk" mode, a drag-in-multiple-patches batch view, more language coverage in the tokenizer, and an AST-based pass for the languages that warrant it — all without ever adding a network call.
