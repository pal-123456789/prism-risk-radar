<div align="center">

# PRism

### The pull-request risk radar that never sees your code

Paste a `git diff` → get an instant, explainable risk score, CWE-tagged danger signals, an annotated diff, change metrics, and a ready-to-use review checklist.
**100% in your browser. No upload, no account, no API key. Works offline.**

`Open Innovation` · `Hack Devengers 2.0` · zero-dependency PWA

</div>

---

## The problem

Code review is where bugs, leaked secrets, and security holes are supposed to get caught — but reviewers are human. On a big pull request, attention runs out before the diff does. The riskiest three lines hide inside three hundred boring ones. And the tools that *could* help mostly want to bolt onto your repo, ship your source to a cloud, and hand you a bill.

For a student, a solo dev, an OSS maintainer, or anyone reviewing code on a private or air-gapped machine, that is a non-starter. The moment a tool needs to *upload the code* to tell you the code is risky, the tool has become a new risk.

## The solution

PRism reads a diff the way a careful senior reviewer does, in the time it takes to paste it:

- **A single risk score (0–100)** with a tier — Low / Moderate / High / Critical — so you instantly know how much attention this change deserves.
- **An explainable score waterfall.** The number is never a black box: every contribution is shown as an auditable step — this many critical signals, this much churn, this much added complexity — that sums to the score. You can see exactly *why* it says what it says.
- **CWE / OWASP-tagged signals.** Every signal names a rule, a plain-language *why*, a concrete *fix*, a confidence level, and the exact file + line that tripped it — with the industry-standard weakness ID so it slots into real security triage.
- **An annotated diff viewer.** Read the change with the flagged lines marked right in the gutter; click any signal to jump straight to the line that caused it.
- **Change metrics** — cyclomatic-complexity delta, max nesting depth introduced, comment ratio, and an estimated review time — so the score sits next to the shape of the change.
- **A generated review checklist** — concrete, prioritized to-dos (`must` / `should` / `polish`) plus the timeless reviewer questions.
- **Export to Markdown, JSON, or SARIF 2.1.0** — paste into a PR comment, feed a script, or upload to GitHub code scanning like any server-side scanner.
- **The same engine gates your CI.** A zero-dependency CLI (`git diff | node bin/prism.js`) and a GitHub Action fail a build on policy and post SARIF findings as inline PR annotations — the browser radar and the pre-merge check share one deterministic engine, so a human and the pipeline always agree.

And the part that makes it different: **it runs entirely in your browser.** The diff never leaves the tab. You can pull the network cable, open PRism, and it still works. That is not a limitation we worked around — it is the whole point.

## Why this is different

|  | Cloud review bots | Local linters | **PRism** |
|---|:---:|:---:|:---:|
| Sees a full pull-request diff at once | ✅ | ❌ | ✅ |
| Runs with **no repo integration** | ❌ | ⚠️ | ✅ |
| **Code never leaves the machine** | ❌ | ✅ | ✅ |
| Works **offline / air-gapped** | ❌ | ⚠️ | ✅ |
| Emits **SARIF** for code-scanning dashboards | ✅ | ⚠️ | ✅ |
| Explains *why*, line by line, with a **CWE** | ⚠️ | ⚠️ | ✅ |
| One engine for a **human GUI *and* a headless CI gate** | ❌ | ❌ | ✅ |
| Setup time | minutes–hours | minutes | **zero — open a file** |

## Precision: the part most toy scanners get wrong

A risk radar is only useful if you can trust its flags. A naive regex scanner screams "`eval`!" at a line that only *mentions* `eval` in a comment — and reviewers learn to ignore it. PRism is **tokenizer-aware**: it masks strings and comments per language before matching, so:

- `eval(userInput)` in real code → **flagged.**
- `// we should never use eval()` in a comment → **silent.**
- `const label = "TODO: buy milk"` in a string → **silent** (no false TODO).

On top of the pattern rules, a **Shannon-entropy detector** (the same idea behind gitleaks / truffleHog) catches high-entropy secrets that match no known token format, while filtering the things that *look* random but aren't — URLs, UUIDs, hashes, placeholders, prose. And a dedicated **trojan-source** detector surfaces invisible bidirectional-Unicode and zero-width characters (CWE-1007) that most tools — and every human — read right past.

## What it catches

**47 rules across 16 categories, every one tagged with a CWE.** A sample:

- **Secrets** — private keys, AWS keys, GitHub/Slack/Stripe/Google tokens, JWTs, basic-auth URLs, `.env`/keystore files, hard-coded passwords, plus entropy-detected unknown secrets.
- **Injection** — `eval`/`exec`, shell-from-input, string-built SQL, NoSQL `$where`, template injection.
- **XSS** — `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, `javascript:` URLs.
- **Crypto / transport** — MD5/SHA-1/DES, ECB mode, insecure RNG for tokens, **disabled TLS verification.**
- **Config / ops** — debug mode shipped on, wide-open CORS, binding to `0.0.0.0`, insecure cookies.
- **Correctness** — committed **merge-conflict markers** (Critical — the code can't even run).
- **Unicode** — trojan-source bidi controls, zero-width characters.
- **Testing** — focused/skipped tests (`.only`/`.skip`), deleted tests, substantial logic changed with no test touched.
- **Supply chain / data** — dependency-manifest and database-migration changes.
- **Cleanliness / reviewability** — leftover debug output and TODOs, oversized hard-to-review files.

Full, source-of-truth list lives in [`src/rules.js`](src/rules.js) — each rule is a few lines and reads like English.

## Tune it to your team

Not every team blocks on a `TODO`. A settings drawer lets you **enable/disable any rule and override its severity**, saved to this device only (never uploaded). Export the profile as JSON to commit it in your repo, so a whole team shares one standard by checking in a file — not by trusting a server.

Three ways to tune, from ad-hoc to committed:

- **In the app** — the settings drawer, saved locally.
- **A `.prism.json` file** at the repo root — enable/disable rules, override severities, and set a CI `gate` (`failOn` severity + `maxScore`). It ships with a JSON Schema ([`prism.schema.json`](prism.schema.json)) so editors autocomplete it. The CLI and the browser both read it.
- **Inline suppressions** — an eslint-style `// prism-ignore <rule-id>` (also `-next-line`, `-file`, and a `disable` alias) silences a specific finding right where it lives. Suppressions are *tokenizer-aware* (a directive inside a string doesn't count) and suppressed hits are **counted, not hidden** — the report tells you how many were waved through, so a suppression can never quietly mask a regression.

## Run it

It is a static app. There is nothing to build.

**Fastest:** double-click `index.html`. Done.

**As a local server** (needed for the offline/installable PWA and the analysis Web Worker):

```bash
# any one of these
npx serve .            # then open the printed URL
python -m http.server 5173
```

Then open `http://localhost:5173`. Click **Install app** (or your browser's install icon) to keep it as a desktop/mobile app that works with no connection.

## Test it

The engine and UI are covered by a zero-dependency test harness:

```bash
node tests/analyzer.test.js
# or
npm test
```

It checks the parser, the language tokenizer (the precision claims above), the entropy detector, the metrics, the score tiers and severity floors (a single leaked key must read Critical no matter how tiny the diff), the waterfall math, the config overrides, the suppression engine, and all three exporters against realistic samples. A second suite (`tests/cli.test.js`) spawns the real CLI end-to-end. Both exit non-zero on failure, so they run in CI as-is (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Use it in CI

The same engine that runs in the browser also runs headless, so PRism can gate a pull request the same way it advises a human. No install, no dependencies — it's the one file `bin/prism.js` on the Node you already have.

```bash
# score a diff straight from git — the diff still never leaves your machine
git diff origin/main... | node bin/prism.js

# machine-readable out for tooling / dashboards
git diff origin/main... | node bin/prism.js --format sarif > prism.sarif.json
git diff origin/main... | node bin/prism.js --format json

# fail the build on policy (overrides / reads .prism.json)
git diff origin/main... | node bin/prism.js --fail-on critical --max-score 85
```

The exit code **is** the CI contract: **0** = under policy, **1** = the gate tripped (a blocking finding or the score ceiling was crossed), **2** = usage error. So a single piped command is a working pre-merge check.

For GitHub, a composite Action wraps all of the above — it computes the PR diff, runs the scan, uploads SARIF to the **Security → Code scanning** tab so findings land as inline PR annotations, and enforces the gate:

```yaml
# .github/workflows/pr-risk.yml
- uses: ./                       # this repo ships the action at its root
  with:
    fail-on: critical
    max-score: 85
```

Because the analysis is local and dependency-free, the whole check runs in seconds and leaks nothing to a third party — the privacy guarantee holds in CI, not just in the tab.

## How it works

```
diff text
   │
   ▼
parser.js      unified-diff → { files[], hunks[], added/removed lines, totals }
   │
   ▼
tokenizer.js   per-language lexer → masks string/comment spans so rules match
               real code, not text that merely mentions it
   │
   ▼
rules.js       47 explainable heuristics (line + file), each with a severity,
entropy.js     CWE/OWASP tag, confidence, and reason · + Shannon-entropy secrets
   │
   ▼
analyzer.js    run rules → signals → confidence-weighted score WATERFALL with
metrics.js     severity floors → per-file risk → change metrics → checklist
               (pure & deterministic — same diff always yields the same report)
   │
   ▼
ui.js          tabbed report: overview + waterfall, signals, annotated diff,
               metrics, checklist  (all user text escaped)
export.js      Markdown · JSON · SARIF 2.1.0
app.js         events, tabs, click-to-line, settings, export, PWA, offline
worker.js      runs the same engine off the main thread (with a sync fallback)
```

Deterministic by design: the same diff always yields the same report, which is what makes the score trustworthy. All user-supplied text is escaped before it hits the DOM, and invisible/bidi characters are rendered as visible sentinels — a tool that flags XSS and trojan-source should not be vulnerable to either.

## Tech

Vanilla JavaScript (ES5-safe, no framework), modern CSS, an installable PWA with a caching service worker, and an optional Web Worker for off-main-thread analysis that degrades to a synchronous call on `file://`. **No dependencies, no build step, no tracking.** Ships as static files to any host; deploy configs for Netlify and Vercel are included, both with a strict Content-Security-Policy (`connect-src 'self'`) that forbids the page from reaching any third-party origin — making the privacy claim browser-enforced, not just promised. (`'self'` rather than `'none'` so the service worker can cache the app shell for offline use; the app itself issues no network requests.)

## Project layout

```
index.html            app shell
assets/styles.css     the "instrument" design system
src/parser.js         unified-diff parser
src/tokenizer.js      language-aware string/comment masking  ← precision
src/entropy.js        Shannon-entropy secret detection
src/metrics.js        complexity / nesting / review-time metrics
src/rules.js          the 47 explainable, CWE-tagged rules   ← the heart of it
src/config.js         local rule enable/disable + severity overrides
src/analyzer.js       waterfall scoring + checklist engine
src/export.js         Markdown · JSON · SARIF 2.1.0 exporters
src/samples.js        one-click demo diffs
src/ui.js             tabbed rendering (all user text escaped)
src/app.js            wiring, tabs, click-to-line, export, settings, PWA
src/suppress.js       inline `prism-ignore` directive engine (tokenizer-aware)
src/worker.js         off-main-thread analysis (with sync fallback)
bin/prism.js          zero-dependency CLI — `git diff | prism` for CI/pre-commit
action.yml            composite GitHub Action (scan + SARIF upload + gate)
.prism.json           committable rule/severity/gate config  ← team standard
prism.schema.json     JSON Schema for .prism.json (editor autocomplete)
tests/analyzer.test.js  engine + UI node test harness
tests/cli.test.js       end-to-end CLI test harness
.github/workflows/      pr-risk.yml (the Action) · ci.yml (npm test matrix)
sw.js · manifest.webmanifest · icon.svg   PWA
netlify.toml · vercel.json                deploy + CSP
```

## Honest limits

PRism is a **radar, not a proof of safety.** It surfaces where a reviewer should look first; it does not replace the reviewer, and it can't understand intent or run the code. Detection is pattern- and heuristic-based, so it will occasionally flag a safe line or miss a cleverly obfuscated one — confidence scores are shown precisely so you can weight each finding. It reads the diff, not the whole repository, so cross-file issues are out of scope by design. Every one of these is a deliberate trade for the thing that matters most here: your code never leaves your machine.

## License

MIT — see [LICENSE](LICENSE).
