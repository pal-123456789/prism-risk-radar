#!/usr/bin/env node
/*
 * PRism — command-line risk radar
 * ---------------------------------------------------------------------------
 * The same offline engine the web app runs, wired to a pipe:
 *
 *     git diff --staged | prism
 *     git diff origin/main... | prism --fail-on high --format sarif -o prism.sarif
 *
 * Zero dependencies — it loads the same src/*.js modules the browser does, so
 * there is exactly one engine and one set of rules. The diff is read from
 * stdin (or a file) and never leaves the machine; there is no network code
 * here at all. Exit code is the CI contract: 0 = under policy, 1 = gate
 * failed, 2 = usage/parse error.
 */
"use strict";

var fs = require("fs");
var path = require("path");

// ---- load the engine (attaches to globalThis.PRism, same as the page) -----
var ROOT = path.join(__dirname, "..");
var SRC = path.join(ROOT, "src");
try {
  ["parser", "tokenizer", "entropy", "metrics", "rules", "suppress", "analyzer", "config", "export"]
    .forEach(function (m) { require(path.join(SRC, m + ".js")); });
} catch (e) {
  process.stderr.write("prism: failed to load engine: " + (e && e.message || e) + "\n");
  process.exit(2);
}
var P = globalThis.PRism;
var VERSION = readVersion();

// ---- arg parsing ----------------------------------------------------------
var argv = process.argv.slice(2);
var opts = {
  format: "text", config: undefined, noConfig: false,
  failOn: undefined, maxScore: undefined, output: undefined,
  color: undefined, quiet: false, input: undefined
};

for (var i = 0; i < argv.length; i++) {
  var a = argv[i];
  switch (a) {
    case "-h": case "--help": printHelp(); process.exit(0); break;
    case "-v": case "--version": process.stdout.write("PRism " + VERSION + "\n"); process.exit(0); break;
    case "-f": case "--format": opts.format = need(a, argv[++i]); break;
    case "-c": case "--config": opts.config = need(a, argv[++i]); break;
    case "--no-config": opts.noConfig = true; break;
    case "--fail-on": opts.failOn = need(a, argv[++i]); break;
    case "--max-score": opts.maxScore = parseInt(need(a, argv[++i]), 10); break;
    case "-o": case "--output": opts.output = need(a, argv[++i]); break;
    case "--no-color": opts.color = false; break;
    case "--color": opts.color = true; break;
    case "-q": case "--quiet": opts.quiet = true; break;
    default:
      if (a.charAt(0) === "-" && a !== "-") die("unknown option: " + a);
      else opts.input = a; // positional: a diff file (or "-" for stdin)
  }
}

var FORMATS = { text: 1, json: 1, sarif: 1, md: 1, markdown: 1 };
if (!FORMATS[opts.format]) die("unknown --format: " + opts.format + " (use text|json|sarif|md)");
if (opts.failOn !== undefined && P.config.SEVERITIES.indexOf(opts.failOn) === -1)
  die("--fail-on must be one of: " + P.config.SEVERITIES.join(", "));
if (opts.maxScore !== undefined && (isNaN(opts.maxScore) || opts.maxScore < 0 || opts.maxScore > 100))
  die("--max-score must be a number 0–100");

// ---- read the diff --------------------------------------------------------
var diffText = readDiff(opts.input);
if (!diffText || !diffText.trim()) {
  if (process.stdin.isTTY && !opts.input) { printHelp(); process.exit(2); }
  die("no diff on stdin (pipe `git diff` in) or give a file path");
}

// ---- config + gate --------------------------------------------------------
var cfg = loadConfig();
var result;
try {
  result = P.analyze(diffText, cfg);
} catch (e) {
  die("analysis failed: " + (e && e.message || e));
}

var gate = Object.assign({}, cfg.gate || {});
if (opts.failOn !== undefined) gate.failOn = opts.failOn;
if (opts.maxScore !== undefined) gate.maxScore = opts.maxScore;
var verdict = P.config.evaluateGate(result, gate);

// ---- render + emit --------------------------------------------------------
var out = render(result, opts.format);
if (opts.output) {
  fs.writeFileSync(opts.output, out.replace(/\x1b\[[0-9;]*m/g, ""));
  if (!opts.quiet) process.stderr.write("prism: wrote " + opts.format + " report to " + opts.output + "\n");
} else if (!opts.quiet) {
  process.stdout.write(out + (out.charAt(out.length - 1) === "\n" ? "" : "\n"));
}

// The gate verdict goes to stderr (never pollutes piped JSON/SARIF) and prints
// even under --quiet, because it is the actionable signal a CI log needs.
if (gate.failOn !== undefined || gate.maxScore !== undefined) {
  if (verdict.failed) {
    process.stderr.write("\nprism: GATE FAILED\n");
    verdict.reasons.forEach(function (r) { process.stderr.write("  - " + r + "\n"); });
  } else {
    process.stderr.write("\nprism: gate passed\n");
  }
}
process.exit(verdict.failed ? 1 : 0);

/* ========================================================================= */

function render(r, fmt) {
  if (fmt === "json") return P.exporters.toJSON(r);
  if (fmt === "sarif") return P.exporters.toSARIF(r);
  if (fmt === "md" || fmt === "markdown") return P.exporters.toMarkdown(r);
  return renderText(r);
}

function renderText(r) {
  var useColor = wantsColor();
  var C = palette(useColor);
  var lines = [];
  var tierName = r.tier.toUpperCase();
  var tierPaint = r.tier === "Critical" ? C.red : r.tier === "High" ? C.yellow : r.tier === "Moderate" ? C.yellow : C.green;

  lines.push("");
  lines.push(C.bold + "PRism — risk report" + C.reset);
  lines.push("");
  lines.push("  " + C.dim + "Score " + C.reset + C.bold + tierPaint + pad(String(r.score), 3) + C.reset +
    C.dim + " / 100  " + C.reset + tierPaint + C.bold + tierName + C.reset);
  var t = r.totals;
  lines.push("  " + C.dim + "Change" + C.reset + " " + t.files + (t.files === 1 ? " file" : " files") +
    " · +" + t.additions + " / −" + t.deletions + " · ~" + r.metrics.reviewMinutes + " min review");
  lines.push("  " + C.dim + r.summary + C.reset);
  lines.push("");

  if (!r.signals.length) {
    lines.push("  " + C.green + "No risk signals found." + C.reset);
  } else {
    lines.push(C.bold + "Signals (" + r.signals.length + ")" + C.reset);
    var shown = r.signals.slice(0, 24);
    shown.forEach(function (s) {
      var sc = sevColor(C, s.severity);
      var loc = s.locations && s.locations[0];
      var where = loc ? loc.file + (loc.line ? ":" + loc.line : "") : "";
      lines.push("  " + sc + "●" + C.reset + " " + sc + pad(s.severity.toUpperCase(), 8) + C.reset +
        " " + padEnd(s.title, 34) + " " + C.dim + (s.cwe || "") + C.reset +
        (s.count > 1 ? C.dim + "  ×" + s.count + C.reset : "") +
        (where ? "\n      " + C.gray + where + C.reset : ""));
    });
    if (r.signals.length > shown.length) lines.push("  " + C.dim + "… +" + (r.signals.length - shown.length) + " more" + C.reset);
  }
  if (r.suppressed) lines.push("\n  " + C.dim + r.suppressed + " signal" + (r.suppressed > 1 ? "s" : "") + " suppressed by inline directives" + C.reset);
  lines.push("");
  return lines.join("\n");
}

function loadConfig() {
  var raw = null, from = null;
  if (opts.noConfig) return P.config.normalize({});
  if (opts.config) {
    if (!fs.existsSync(opts.config)) die("config not found: " + opts.config);
    from = opts.config;
  } else {
    from = findConfigUp(process.cwd());
  }
  if (from) {
    try { raw = JSON.parse(fs.readFileSync(from, "utf8")); }
    catch (e) { die("could not parse " + from + ": " + (e && e.message || e)); }
  }
  return P.config.normalize(raw || {});
}

function findConfigUp(startDir) {
  var dir = startDir;
  for (var i = 0; i < 50; i++) {
    var p = path.join(dir, ".prism.json");
    if (fs.existsSync(p)) return p;
    var parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readDiff(input) {
  if (input && input !== "-") {
    if (!fs.existsSync(input)) die("diff file not found: " + input);
    return fs.readFileSync(input, "utf8");
  }
  // stdin (fd 0). readFileSync throws EAGAIN on an interactive TTY with no pipe.
  try { return fs.readFileSync(0, "utf8"); }
  catch (e) { return ""; }
}

// ---- small helpers --------------------------------------------------------
function need(flag, val) { if (val === undefined) die("missing value for " + flag); return val; }
function die(msg) { process.stderr.write("prism: " + msg + "\n"); process.exit(2); }
function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }
function padEnd(s, n) { s = String(s); if (s.length > n) return s.slice(0, n - 1) + "…"; while (s.length < n) s += " "; return s; }

function wantsColor() {
  if (opts.color === false) return false;
  if (opts.output) return false;
  if (process.env.NO_COLOR) return false;
  if (opts.color === true) return true;
  return !!process.stdout.isTTY;
}
function palette(on) {
  if (!on) return { reset: "", bold: "", dim: "", red: "", yellow: "", green: "", cyan: "", gray: "" };
  return {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m", gray: "\x1b[90m"
  };
}
function sevColor(C, sev) {
  return sev === "critical" ? C.red : sev === "high" ? C.yellow : sev === "medium" ? C.yellow : sev === "low" ? C.cyan : C.gray;
}

function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "0.0.0"; }
  catch (e) { return "0.0.0"; }
}

function printHelp() {
  process.stdout.write([
    "PRism " + VERSION + " — offline pull-request risk radar",
    "",
    "USAGE",
    "  git diff | prism [options]",
    "  prism [options] <diff-file>",
    "",
    "OPTIONS",
    "  -f, --format <fmt>   text (default) | json | sarif | md",
    "  -o, --output <file>  write the report to a file instead of stdout",
    "  -c, --config <file>  use this .prism.json (else auto-discovered upward)",
    "      --no-config      ignore any .prism.json",
    "      --fail-on <sev>  exit 1 if any signal is >= sev (info|low|medium|high|critical)",
    "      --max-score <n>  exit 1 if the risk score exceeds n (0–100)",
    "  -q, --quiet          suppress the report (the gate verdict still prints)",
    "      --no-color       disable ANSI colors",
    "  -v, --version        print version",
    "  -h, --help           print this help",
    "",
    "EXIT CODES",
    "  0  under policy (or no gate configured)",
    "  1  gate failed (--fail-on / --max-score / .prism.json gate breached)",
    "  2  usage or parse error",
    "",
    "EXAMPLES",
    "  git diff --staged | prism",
    "  git diff origin/main... | prism --fail-on high",
    "  prism pr.diff -f sarif -o prism.sarif",
    "",
    "The diff is analyzed locally and never sent anywhere.",
    ""
  ].join("\n"));
}
