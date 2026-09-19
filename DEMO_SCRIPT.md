# PRism — demo script

The judges' bar: *why does this need to exist, can someone use it tomorrow, what makes it different, can I demo it in 30 seconds.* This script hits all four.

> All scores below are the real, current engine output — verified by the test suite, not guessed. If you re-run and a number differs, trust the app.

---

## The 30-second version (memorize this)

> **[Open the app — it's already loaded, no login]**
>
> "This is PRism. It scores how risky a pull request is — and it never sees your code. Watch."
>
> **[Click the "Leaked credentials" sample chip]**
>
> "I paste a diff, and instantly: risk score **Critical, 98**. It found a live Stripe key, an AWS key, and a committed `.env` file — each tagged with a CWE and the exact line number."
>
> **[Open DevTools Network tab = empty]**
>
> "And here's the trick: **zero network calls.** The code never left my browser. Every cloud review tool has to upload your source. PRism can't — the deploy ships a Content-Security-Policy that forbids it from reaching any other server. That's the whole idea."

That's it. Score + the reason + the privacy reveal. Everything below is depth for Q&A.

---

## The two-minute version

**1. The hook (15s)**
"Code review is where secrets and security holes are supposed to get caught. But on a 400-line PR, the three dangerous lines hide in the boring ones — and every tool that helps wants to upload your code to a cloud. PRism gives you the same help without ever seeing your code."

**2. Critical case — secrets (25s)**
Click **Leaked credentials**. The gauge sweeps to **Critical, 98**.
"One paste. It flags the Stripe token, the AWS key, the `.env` file, and debug mode left on — each with a plain-English *why*, a CWE tag, and a fix." Open the **Overview** tab's **score waterfall**: "and the number isn't a black box — you can see it built from the critical signals plus the churn. Every point is traceable."

**3. The 'nobody else catches this' moment — trojan source (25s)**
Click **Trojan source**. Score **Critical, 82**.
"There's no obvious bug here. But PRism found invisible bidirectional-Unicode characters — a *trojan-source* attack, CWE-1007 — that reorder how this code reads to a human versus the compiler." Open the **Diff** tab: "It even renders the invisible characters as visible red sentinels, right in the code. A human reviewer physically cannot see these. PRism can."

**4. The differentiator — offline (20s)**
DevTools → Network, reload. "Nothing. No requests, ever." (Or toggle offline and re-run a sample.) "It's a PWA — install it, it works on a plane. Privacy isn't a setting here, it's the architecture."

**5. Depth — precision + a subtler case (25s)**
Click **Feature, tests dropped**. Score **High, 61**.
"No secret here — but it sees new pricing logic added *and the test file deleted*, so it warns the safety net is gone." Mention precision: "And it's not a dumb regex — `eval` in a *comment* won't trip it, only `eval` in real code does. That's a language-aware tokenizer, and it's why you can trust the flags."

**6. Close (15s)**
"Then I export the report as Markdown for the PR — or as **SARIF**, so this fully-local result uploads to GitHub code scanning like any server-side scanner. And the *same engine* runs in CI: `git diff | prism` returns an exit code, and the bundled GitHub Action blocks a merge on policy — no dependencies, no build, no account. Open `index.html` and it runs; pipe a diff to it and it gates. That's PRism: a code-review radar for the code you can't send to anyone."

---

## If a judge asks…

- **"Isn't this just a linter/regex?"** — Two things separate it. One, it's **tokenizer-aware**: it masks strings and comments per language, so it doesn't scream `eval` at a comment — the false positives that make people ignore linters. Two, the value is the *combination* — full-diff scoring with an explainable waterfall, CWE-tagged signals, entropy-based secret detection, an annotated diff, metrics, and SARIF export — delivered with zero upload. A linter needs your whole repo and toolchain; this needs a paste.
- **"False positives?"** — Yes, it's a radar, not a proof — and it says so. Every signal carries a **confidence** score so you can weight it. Severe things (secrets, conflict markers, trojan-source) floor high; cosmetic things stay low. It points attention; the human still decides.
- **"Why not use AI?"** — An LLM would mean sending code to a server — the exact thing we refuse. Local, deterministic scoring is what makes the privacy promise real and the score reproducible: same diff, same report, every time.
- **"Is it real or a mockup?"** — Fully real. `npm test` runs the engine + UI suite and an end-to-end CLI suite (156 checks); it's wired to CI on Node 18/20/22. Try your own `git diff`.
- **"Can teams tune it?"** — Yes, three ways. The settings drawer (on-device), a committable `.prism.json` (rules, severities, and a CI gate — with a JSON Schema for autocomplete), and eslint-style `// prism-ignore` inline suppressions that are tokenizer-aware and *counted, not hidden* — so a wave-through can never silently mask a regression.
- **"Could I put this in my pipeline?"** — It already is one. The same engine runs headless: `git diff origin/main... | node bin/prism.js --fail-on critical` returns exit 0 (pass) or 1 (gate tripped) — zero dependencies. A bundled GitHub Action runs it on every PR, uploads **SARIF** to the code-scanning tab as inline annotations, and blocks the merge on policy. Same verdicts as the tab, in CI, still leaking nothing.

---

## Pre-demo checklist
- [ ] App open at the deployed URL (and a local copy as backup).
- [ ] Browser zoom ~110–125% so the gauge and signals read from the back.
- [ ] DevTools Network tab ready to show it empty (the mic-drop).
- [ ] Rehearse the tab switches: **Overview** (waterfall) and **Diff** (gutter flags + invisible-char sentinels) are the two that land.
- [ ] One **real** `git diff` from your own repo copied, in case they ask "try mine."
- [ ] Know your headline numbers: **Leaked credentials = 98 (Critical)**, **Risky feature = 84 (Critical)**, **Trojan source = 82 (Critical)**, **Tests dropped = 61 (High)**, **Large refactor = 52 (Moderate)**, **Clean change = 22 (Low)**.
