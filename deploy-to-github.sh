#!/usr/bin/env bash
# =============================================================================
# PRism — one-shot GitHub publish (uses the GitHub CLI)
# -----------------------------------------------------------------------------
# Run this from inside the project folder, in WSL or Git Bash:
#
#     bash deploy-to-github.sh
#
# It will: verify tooling -> RUN THE TEST SUITE (won't push a red build) ->
# init git -> commit -> create the GitHub repo and push, in one shot.
# Safe to re-run: if the repo/remote already exists it just pushes again.
# =============================================================================
set -euo pipefail

REPO_NAME="prism-risk-radar"
VISIBILITY="public"          # change to "private" if you prefer
DESCRIPTION="PRism — offline, privacy-first pull-request risk radar. Paste a git diff, get an instant explainable risk score. Runs 100% in the browser."

# --- run from the script's own directory (location-independent) -------------
cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"

say(){ printf "\n\033[1;33m==>\033[0m %s\n" "$1"; }
die(){ printf "\n\033[1;31mABORT:\033[0m %s\n" "$1" >&2; exit 1; }

# --- 0. sanity: are we in the PRism project? --------------------------------
[ -f package.json ] || die "no package.json here — cd into the PRism folder first."
grep -q '"prism-risk-radar"' package.json || die "package.json isn't PRism's — wrong folder?"

# --- 1. tooling --------------------------------------------------------------
command -v git >/dev/null || die "git not found."
command -v node >/dev/null || die "node not found (needed to run the test gate)."
command -v gh  >/dev/null || die "GitHub CLI 'gh' not found. Install: https://cli.github.com  (or use the manual steps in DEPLOY.md)."
gh auth status >/dev/null 2>&1 || die "gh is not logged in. Run:  gh auth login   then re-run this script."

# --- 2. TEST GATE — never publish a broken build ----------------------------
say "Running the test suite (engine + CLI) before publishing..."
npm test || die "tests failed — fix them before publishing. Nothing was pushed."
say "Tests green. Proceeding."

# --- 3. git init + commit ----------------------------------------------------
if [ ! -d .git ]; then
  say "Initializing a git repository..."
  git init -q
  git symbolic-ref HEAD refs/heads/main   # default branch = main
fi

say "Staging files (respecting .gitignore)..."
git add -A
echo "  $(git diff --cached --numstat | wc -l) files staged:"
git --no-pager diff --cached --name-only | sed 's/^/    /'

if git diff --cached --quiet; then
  say "Nothing new to commit (working tree already committed)."
else
  git commit -q -m "PRism: offline privacy-first PR risk radar

Zero-dependency vanilla-JS PWA + Node CLI. 47 CWE-tagged rules, entropy
secret detection, explainable score waterfall, SARIF/JSON/Markdown export,
.prism.json config + CI gate, GitHub Action. 156 tests green."
  say "Committed."
fi

# --- 4. create remote + push (idempotent) -----------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  say "Remote 'origin' already exists — pushing to it."
  git push -u origin main
else
  say "Creating the GitHub repo and pushing (gh repo create)..."
  gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin \
     --description "$DESCRIPTION" --push
fi

URL="$(gh repo view --json url -q .url 2>/dev/null || echo '')"
say "Done. Repository: ${URL:-<open github.com to see it>}"
cat <<'NEXT'

NEXT STEP — deploy to Vercel (2 minutes, no build):
  Option A (dashboard): vercel.com -> Add New -> Project -> Import this repo
                        -> Framework Preset: "Other" -> Deploy. Done.
  Option B (CLI):       npm i -g vercel && vercel --prod
  vercel.json is already in the repo (clean URLs + strict security headers),
  so there is nothing to configure.

If GitHub blocks the push complaining about a "secret" in src/samples.js:
  those are FAKE demo fixtures (that's what PRism detects). Click the URL it
  prints and choose "It's used in tests" / allow — the push then completes.
  (.github/secret_scanning.yml already excludes that file from scan alerts.)
NEXT
