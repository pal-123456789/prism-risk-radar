/*
 * PRism — CLI test harness (Node, zero dependencies)
 * ---------------------------------------------------------------------------
 * Run:  node tests/cli.test.js
 * Spawns the real bin/prism.js as a child process and drives it exactly the
 * way CI will: pipe a diff to stdin, read stdout/stderr, assert on the exit
 * code. The exit code is the contract, so it gets tested for real, not mocked.
 */
"use strict";

var path = require("path");
var cp = require("child_process");

var ROOT = path.join(__dirname, "..");
var BIN = path.join(ROOT, "bin", "prism.js");

// build the sample diffs by loading the engine's own sample set
require(path.join(ROOT, "src", "samples.js"));
var samples = {};
globalThis.PRism.samples.forEach(function (s) { samples[s.id] = s.diff; });

var pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  -> " + detail : "")); }
}
function group(name) { console.log("\n" + name); }

// run the CLI with args + optional stdin; returns { code, out, err }
function run(args, stdin) {
  var r = cp.spawnSync(process.execPath, [BIN].concat(args), {
    input: stdin || "", encoding: "utf8"
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

group("cli — basics");
(function () {
  var h = run(["--help"], "");
  check("--help exits 0", h.code === 0);
  check("--help shows usage", h.out.indexOf("USAGE") !== -1);
  var v = run(["--version"], "");
  check("--version prints version", v.code === 0 && /PRism \d+\.\d+\.\d+/.test(v.out));
  var none = run(["--no-config"], "");
  check("empty stdin exits 2", none.code === 2, "code " + none.code);
  var bad = run(["--format", "xml", "--no-config"], samples["clean-change"]);
  check("unknown --format exits 2", bad.code === 2);
  var badsev = run(["--fail-on", "nope", "--no-config"], samples["clean-change"]);
  check("bad --fail-on exits 2", badsev.code === 2);
})();

group("cli — analysis + formats");
(function () {
  var txt = run(["--no-config"], samples["leaked-secret"]);
  check("text report renders score", txt.out.indexOf("risk report") !== -1 && /Score\s+98/.test(txt.out), txt.out.slice(0, 80));
  check("advisory run (no gate) exits 0", txt.code === 0, "code " + txt.code);

  var json = run(["-f", "json", "--no-config"], samples["leaked-secret"]);
  var parsedOk = false;
  try { var d = JSON.parse(json.out); parsedOk = d.tool === "PRism" && d.signals.length > 0; } catch (e) {}
  check("--format json emits valid JSON", parsedOk);

  var sarif = run(["-f", "sarif", "--no-config"], samples["leaked-secret"]);
  var sarifOk = false;
  try { var s = JSON.parse(sarif.out); sarifOk = s.version === "2.1.0" && s.runs[0].results.length > 0; } catch (e) {}
  check("--format sarif emits valid SARIF 2.1.0", sarifOk);

  var md = run(["-f", "md", "--no-config"], samples["leaked-secret"]);
  check("--format md emits a Markdown title", md.out.indexOf("# PRism risk report") === 0);

  // quiet: JSON/SARIF must not be polluted; -q suppresses the report entirely
  var q = run(["-q", "--no-config"], samples["leaked-secret"]);
  check("--quiet suppresses stdout", q.out.trim() === "", JSON.stringify(q.out.slice(0, 40)));
})();

group("cli — the gate (exit-code contract)");
(function () {
  // no gate anywhere -> always 0
  check("no gate -> exit 0 even on critical", run(["--no-config"], samples["leaked-secret"]).code === 0);

  // --fail-on
  check("--fail-on high fails on a critical diff", run(["-q", "--no-config", "--fail-on", "high"], samples["leaked-secret"]).code === 1);
  check("--fail-on high passes a clean diff", run(["-q", "--no-config", "--fail-on", "high"], samples["clean-change"]).code === 0);
  check("--fail-on critical passes a moderate diff", run(["-q", "--no-config", "--fail-on", "critical"], samples["big-refactor"]).code === 0);

  // --max-score
  check("--max-score 10 fails a clean-but-nonzero diff", run(["-q", "--no-config", "--max-score", "10"], samples["clean-change"]).code === 1);
  check("--max-score 100 never fails", run(["-q", "--no-config", "--max-score", "100"], samples["leaked-secret"]).code === 0);

  // failure reasons surface on stderr, not stdout
  var g = run(["-q", "--no-config", "--fail-on", "high"], samples["leaked-secret"]);
  check("gate failure reason goes to stderr", g.err.indexOf("GATE FAILED") !== -1);
})();

console.log("\n" + (fail === 0 ? "✓ ALL GREEN" : "✗ FAILURES") +
  " — " + pass + " passed, " + fail + " failed.\n");
process.exit(fail === 0 ? 0 : 1);
