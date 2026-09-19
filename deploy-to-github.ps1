<#
=============================================================================
 PRism - one-shot GitHub publish for PowerShell (uses the GitHub CLI)
-----------------------------------------------------------------------------
 Run from inside the project folder in PowerShell:

     powershell -ExecutionPolicy Bypass -File .\deploy-to-github.ps1

 It will: verify tooling -> RUN THE TEST SUITE (won't push a red build) ->
 init git -> commit -> create the GitHub repo and push, in one shot.
 Safe to re-run: if the repo/remote already exists it just pushes again.
=============================================================================
#>
$ErrorActionPreference = "Stop"

$RepoName    = "prism-risk-radar"
$Visibility  = "public"          # change to "private" if you prefer
$Description  = "PRism - offline, privacy-first pull-request risk radar. Paste a git diff, get an instant explainable risk score. Runs 100% in the browser."

function Say  ($m) { Write-Host "`n==> $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "`nABORT: $m" -ForegroundColor Red; exit 1 }
# native commands don't throw; check their exit code explicitly
function Check($m) { if ($LASTEXITCODE -ne 0) { Die $m } }

# --- run from the script's own directory (location-independent) -------------
Set-Location -Path $PSScriptRoot

# --- 0. sanity: are we in the PRism project? --------------------------------
if (-not (Test-Path package.json)) { Die "no package.json here - cd into the PRism folder first." }
if (-not (Select-String -Path package.json -Pattern '"prism-risk-radar"' -Quiet)) {
  Die "package.json isn't PRism's - wrong folder?"
}

# --- 1. tooling --------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die "git not found. Install: https://git-scm.com/download/win" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "node not found (needed to run the test gate). Install: https://nodejs.org" }
if (-not (Get-Command gh   -ErrorAction SilentlyContinue)) { Die "GitHub CLI 'gh' not found. Install: https://cli.github.com  (or use the manual steps below)." }
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Die "gh is not logged in. Run:  gh auth login   then re-run this script." }

# --- 2. TEST GATE - never publish a broken build ----------------------------
Say "Running the test suite (engine + CLI) before publishing..."
npm test
Check "tests failed - fix them before publishing. Nothing was pushed."
Say "Tests green. Proceeding."

# --- 3. git init + commit ----------------------------------------------------
if (-not (Test-Path .git)) {
  Say "Initializing a git repository..."
  git init -q; Check "git init failed."
  git symbolic-ref HEAD refs/heads/main   # default branch = main
}

Say "Staging files (respecting .gitignore)..."
git add -A; Check "git add failed."
git --no-pager diff --cached --name-only | ForEach-Object { "    $_" }

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Say "Nothing new to commit (working tree already committed)."
} else {
  $msg = @"
PRism: offline privacy-first PR risk radar

Zero-dependency vanilla-JS PWA + Node CLI. 47 CWE-tagged rules, entropy
secret detection, explainable score waterfall, SARIF/JSON/Markdown export,
.prism.json config + CI gate, GitHub Action. 156 tests green.
"@
  git commit -q -m $msg; Check "git commit failed."
  Say "Committed."
}

# --- 4. create remote + push (idempotent) -----------------------------------
git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Say "Remote 'origin' already exists - pushing to it."
  git push -u origin main; Check "git push failed."
} else {
  Say "Creating the GitHub repo and pushing (gh repo create)..."
  gh repo create $RepoName --$Visibility --source=. --remote=origin --description $Description --push
  Check "gh repo create failed."
}

$Url = (gh repo view --json url -q .url 2>$null)
Say "Done. Repository: $(if ($Url) { $Url } else { '<open github.com to see it>' })"

Write-Host @"

NEXT STEP - deploy to Vercel (2 minutes, no build):
  Option A (dashboard): vercel.com -> Add New -> Project -> Import this repo
                        -> Framework Preset: "Other" -> Deploy. Done.
  Option B (CLI):       npm i -g vercel ; vercel --prod
  vercel.json is already in the repo (clean URLs + strict security headers),
  so there is nothing to configure.

If GitHub blocks the push complaining about a "secret" in src/samples.js:
  those are FAKE demo fixtures (that's what PRism detects). Click the URL it
  prints and choose "It's used in tests" / allow - the push then completes.
"@ -ForegroundColor Cyan
