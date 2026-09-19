/*
 * PRism — engine test harness (Node, zero dependencies)
 * ---------------------------------------------------------------------------
 * Run:  node tests/analyzer.test.js   (or: npm test)
 * Exits non-zero if anything fails, so it drops straight into CI.
 *
 * The browser loads these as classic <script> tags; here we load them through
 * require() — each attaches to globalThis.PRism, the same global namespace it
 * uses in the page. Covers: parser, tokenizer, entropy, metrics, rules,
 * analyzer scoring + waterfall, config, and the SARIF/JSON/Markdown exporters.
 */
"use strict";

var path = require("path");
var base = path.join(__dirname, "..", "src");
["parser", "tokenizer", "entropy", "metrics", "rules", "suppress", "analyzer", "config", "samples", "ui", "export"]
  .forEach(function (m) { require(path.join(base, m + ".js")); });

var P = globalThis.PRism;
var samples = {};
P.samples.forEach(function (s) { samples[s.id] = s.diff; });

var pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  -> " + detail : "")); }
}
function group(name) { console.log("\n" + name); }
function ids(r) { return r.signals.map(function (s) { return s.id; }); }
function has(r, id) { return ids(r).indexOf(id) !== -1; }

// diff helper: wrap added lines into a minimal valid unified diff
function diff(file, addedLines, ctx) {
  var body = (ctx || " x\n");
  addedLines.forEach(function (l) { body += "+" + l + "\n"; });
  var n = addedLines.length + 1;
  return "diff --git a/" + file + " b/" + file + "\n--- a/" + file + "\n+++ b/" + file +
    "\n@@ -1 +1," + n + " @@\n" + body;
}

// --- parser ---------------------------------------------------------------
group("parser");
(function () {
  var m = P.parseDiff(samples["clean-change"]);
  check("counts two files", m.files.length === 2, "got " + m.files.length);
  check("tallies additions", m.totals.additions > 0);
  check("tallies deletions", m.totals.deletions > 0);
  check("guesses TypeScript", m.files[0].language === "TypeScript", m.files[0].language);
  check("empty diff -> 0 files", P.parseDiff("").files.length === 0);
  var added = P.parseDiff("diff --git a/new.js b/new.js\nnew file mode 100644\n--- /dev/null\n+++ b/new.js\n@@ -0,0 +1,2 @@\n+const x=1;\n+module.exports=x;\n");
  check("detects added file status", added.files[0].status === "added", added.files[0].status);
  var del = P.parseDiff("diff --git a/old.js b/old.js\ndeleted file mode 100644\n--- a/old.js\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n");
  check("detects deleted file status", del.files[0].status === "deleted", del.files[0].status);
  var ren = P.parseDiff("diff --git a/x.js b/y.js\nsimilarity index 90%\nrename from x.js\nrename to y.js\n");
  check("detects rename", ren.files[0].status === "renamed", ren.files[0].status);
})();

// --- parser edge cases -----------------------------------------------------
group("parser edge cases");
(function () {
  // combined (merge) diff: @@@ header, two marker columns
  var comb = P.parseDiff([
    "diff --cc app.js",
    "index 000,111..222 100644",
    "--- a/app.js",
    "+++ b/app.js",
    "@@@ -1,1 -1,1 +1,2 @@@",
    "  var x = 1;",
    "++eval(userInput);"
  ].join("\n"));
  check("combined diff parses one file", comb.files.length === 1, "got " + comb.files.length);
  check("combined diff captures the merged add", comb.files[0].addedLines.length === 1 &&
    comb.files[0].addedLines[0].text === "eval(userInput);", JSON.stringify(comb.files[0].addedLines));
  check("combined diff feeds the rules (eval fires)", has(P.analyze(comb), "eval-exec"), ids(P.analyze(comb)).join(","));

  // non-git unified diff with tab + timestamp on the path lines
  var ts = P.parseDiff([
    "--- foo.js\t2026-01-01 10:00:00.000000000 +0000",
    "+++ foo.js\t2026-01-02 10:00:00.000000000 +0000",
    "@@ -1,1 +1,2 @@",
    " existing",
    "+var y = 2;"
  ].join("\n"));
  check("timestamped path is cleaned", ts.files[0].path === "foo.js", ts.files[0].path);
  check("timestamped diff still counts adds", ts.files[0].additions === 1, "got " + ts.files[0].additions);

  // copy from/to -> copied status
  var cp = P.parseDiff("diff --git a/orig.js b/copy.js\nsimilarity index 100%\ncopy from orig.js\ncopy to copy.js\n");
  check("copy is detected", cp.files[0].status === "copied", cp.files[0].status);
  check("copy resolves the new path", cp.files[0].path === "copy.js", cp.files[0].path);

  // mode-change-only diff: no hunks, zero churn, still one file
  var mode = P.parseDiff("diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n");
  check("mode-only diff yields a file", mode.files.length === 1);
  check("mode-only diff has zero additions", mode.files[0].additions === 0);

  // CRLF line endings
  var crlf = P.parseDiff("diff --git a/a.js b/a.js\r\n--- a/a.js\r\n+++ b/a.js\r\n@@ -1 +1,2 @@\r\n x\r\n+var z = 3;\r\n");
  check("CRLF diff parses adds without stray \\r", crlf.files[0].addedLines[0].text === "var z = 3;", JSON.stringify(crlf.files[0].addedLines[0].text));

  // headerless bare hunk stream
  var bare = P.parseDiff("@@ -1,1 +1,2 @@\n ctx\n+eval(bad);\n");
  check("headerless hunk still parses", bare.files.length === 1 && bare.files[0].addedLines.length === 1);
})();

// --- tokenizer ------------------------------------------------------------
group("tokenizer");
(function () {
  var T = P.tokenizer;
  var c = T.classifyLine('const s = "hello"; // trailing', "JavaScript", { inBlock: false });
  check("code view blanks the string body", c.cls.code.indexOf("hello") === -1, c.cls.code);
  check("code view blanks the comment", c.cls.code.indexOf("trailing") === -1);
  check("captures string content", c.cls.stringList.indexOf("hello") !== -1);
  check("captures comment content", c.cls.comment.indexOf("trailing") !== -1);

  var py = T.classifyLine('x = 1  # eval(this)', "Python", { inBlock: false });
  check("python # comment recognized", py.cls.code.indexOf("eval") === -1, py.cls.code);

  // block comment carry across lines
  var l1 = T.classifyLine("/* start", "JavaScript", { inBlock: false });
  check("open block sets carry", l1.carry.inBlock === true);
  var l2 = T.classifyLine("still comment eval()", "JavaScript", l1.carry);
  check("carried block masks eval", l2.cls.code.indexOf("eval") === -1);
  var l3 = T.classifyLine("end */ real();", "JavaScript", l2.carry);
  check("block close resumes code", l3.cls.code.indexOf("real") !== -1 && l3.carry.inBlock === false);

  // PHP supports both // and # line comments
  var php = T.classifyLine('$x = 1; # eval($y)', "PHP", { inBlock: false });
  check("PHP # comment recognized", php.cls.code.indexOf("eval") === -1, php.cls.code);
  var php2 = T.classifyLine('$q = "SELECT *"; // note', "PHP", { inBlock: false });
  check("PHP // comment recognized", php2.cls.code.indexOf("note") === -1);
  check("PHP captures string content", php2.cls.stringList.join("").indexOf("SELECT") !== -1);

  // Dotenv uses # comments (matters for secret-in-string context)
  var env = T.classifyLine('API_KEY=abc123 # inline note', "Dotenv", { inBlock: false });
  check("Dotenv # comment recognized", env.cls.comment.indexOf("inline note") !== -1, env.cls.comment);
})();

// --- entropy --------------------------------------------------------------
group("entropy");
(function () {
  var E = P.entropy;
  check("shannon of uniform > shannon of repeated", E.shannon("abcdefgh") > E.shannon("aaaaaaaa"));
  check("high-entropy base64 token flagged",
    !!E.evaluateToken("aGVsbG8gd29ybGRzZWNyZXRrZXlhYmMxMjN4eXo5ODc2NTQ"));
  check("english words not flagged", E.evaluateToken("thequickbrownfoxjumps") === null);
  check("url not flagged", E.evaluateToken("https://example.com/a/b/c/d/e/f/g") === null);
  check("uuid not flagged", E.evaluateToken("550e8400-e29b-41d4-a716-446655440000") === null);
  check("short string not flagged", E.evaluateToken("abc123") === null);
  check("repeated chars not flagged", E.evaluateToken("abcabcabcabcabcabcabcabc") === null);
})();

// --- metrics --------------------------------------------------------------
group("metrics");
(function () {
  var r = P.analyze(diff("a.js", [
    "function f(x){", "  if (x > 0) {", "    for (var i=0;i<x;i++){", "      doThing(i);", "    }", "  }", "}"
  ]));
  check("counts added decisions", r.metrics.complexityDelta >= 2, "cd=" + r.metrics.complexityDelta);
  check("measures nesting added", r.metrics.maxNestingAdded >= 2, "nest=" + r.metrics.maxNestingAdded);
  check("estimates review minutes", r.metrics.reviewMinutes >= 2);
  check("reports language mix", r.metrics.languages.length >= 1 && r.metrics.languages[0].language === "JavaScript");
})();

// --- scoring + floors -----------------------------------------------------
group("scoring");
(function () {
  var clean = P.analyze(samples["clean-change"]);
  check("clean change is Low risk", clean.tier === "Low", clean.tier + " (" + clean.score + ")");
  check("clean change has no signals", clean.signals.length === 0, ids(clean).join(","));

  var secret = P.analyze(samples["leaked-secret"]);
  check("leaked secret is Critical", secret.tier === "Critical", secret.tier + " (" + secret.score + ")");
  check("leaked secret score >= 82", secret.score >= 82, "" + secret.score);

  var risky = P.analyze(samples["risky-security"]);
  check("risky feature is High or Critical", risky.tier === "High" || risky.tier === "Critical", risky.tier);

  var tiny = P.analyze(diff("a.py", ['AWS = "AKIA0000FAKEKEY00000"']));
  check("single leaked key floors to >= 82", tiny.score >= 82, "" + tiny.score);
  check("score never exceeds 100", tiny.score <= 100 && clean.score <= 100 && secret.score <= 100);

  // waterfall present and traceable
  check("waterfall has steps", secret.waterfall && secret.waterfall.steps.length > 0);
  check("waterfall total matches score", secret.waterfall.total === secret.score);
})();

// --- signal detection -----------------------------------------------------
group("signals");
(function () {
  var secret = P.analyze(samples["leaked-secret"]);
  check("flags provider token", has(secret, "provider-token"), ids(secret).join(","));
  check("flags AWS key", has(secret, "aws-key"));
  check("flags .env secret file", has(secret, "secret-file"));
  check("flags debug mode", has(secret, "debug-flag"));

  var risky = P.analyze(samples["risky-security"]);
  ["eval-exec", "sql-concat", "tls-off", "raw-html", "debug-print", "todo"].forEach(function (id) {
    check("risky flags " + id, has(risky, id), ids(risky).join(","));
  });

  var dropped = P.analyze(samples["dropped-tests"]);
  check("flags deleted test", has(dropped, "test-deleted"), ids(dropped).join(","));
  check("flags logic without tests", has(dropped, "logic-without-tests"));

  var focused = P.analyze(diff("tests/x.test.js", ["it.only('b', () => { expect(1).toBe(1); });"], " it('a',()=>{});\n"));
  check("flags focused test (added line)", has(focused, "focused-test"), ids(focused).join(","));

  var clean = P.analyze(samples["clean-change"]);
  check("clean change has no critical/high", clean.counts.critical === 0 && clean.counts.high === 0);
})();

// --- tokenizer-aware precision (the god-level bit) ------------------------
group("tokenizer-aware precision");
(function () {
  var inComment = P.analyze(diff("a.js", ["// we should not use eval() anywhere", "const y = 2;"]));
  check("eval in a comment does NOT fire eval-exec", !has(inComment, "eval-exec"), ids(inComment).join(","));

  var inCode = P.analyze(diff("a.js", ["const z = eval(userInput);"]));
  check("eval in code DOES fire eval-exec", has(inCode, "eval-exec"), ids(inCode).join(","));

  var todoInString = P.analyze(diff("a.js", ['const label = "TODO list feature";']));
  check("TODO inside a string does NOT fire todo rule", !has(todoInString, "todo"), ids(todoInString).join(","));

  var todoInComment = P.analyze(diff("a.js", ["// TODO: finish this", "const q = 1;"]));
  check("TODO in a comment DOES fire todo rule", has(todoInComment, "todo"));
})();

// --- unicode / trojan source ----------------------------------------------
group("unicode / trojan source");
(function () {
  var rlo = String.fromCharCode(0x202E), pdi = String.fromCharCode(0x2069);
  var trojan = P.analyze(diff("a.js", ["var x = 1 /*" + rlo + " evil " + pdi + "*/;"]));
  check("detects bidi trojan-source", has(trojan, "bidi-unicode"), ids(trojan).join(","));
  check("bidi is Critical tier", trojan.tier === "Critical", trojan.tier);

  var zwsp = String.fromCharCode(0x200B);
  var zw = P.analyze(diff("a.js", ["var ad" + zwsp + "min = true;"]));
  check("detects zero-width character", has(zw, "zero-width"), ids(zw).join(","));
})();

// --- new security rules ---------------------------------------------------
group("new security rules");
(function () {
  check("weak crypto (md5)", has(P.analyze(diff("a.py", ["h = hashlib.md5(data).hexdigest()"])), "weak-crypto"));
  check("insecure deserialize (pickle)", has(P.analyze(diff("a.py", ["obj = pickle.loads(raw)"])), "insecure-deserialize"));
  check("insecure random", has(P.analyze(diff("a.js", ["const token = Math.random().toString(36);"])), "insecure-random"));
  check("path traversal", has(P.analyze(diff("a.js", ["fs.readFile(req.query.path, cb);"])), "path-traversal"));
  check("ssrf", has(P.analyze(diff("a.py", ["r = requests.get(request.args['url'])"])), "ssrf"));
  check("shell injection", has(P.analyze(diff("a.py", ["os.system('rm ' + name)"])), "shell-injection"));
  check("private key material", has(P.analyze(diff("k.txt", ["-----BEGIN RSA PRIVATE KEY-----"])), "private-key"));
  check("cors wildcard", has(P.analyze(diff("a.js", ["res.setHeader('Access-Control-Allow-Origin','*');"])), "cors-wildcard"));
})();

// --- conflict markers -----------------------------------------------------
group("conflict markers");
(function () {
  var r = P.analyze(diff("x.js", ["<<<<<<< HEAD", "const a = 1;", "=======", "const a = 2;", ">>>>>>> feature"]));
  check("detects conflict markers", has(r, "conflict-markers"), ids(r).join(","));
  check("conflict markers are Critical tier", r.tier === "Critical", r.tier);
})();

// --- high-signal rules -----------------------------------------------------
group("high-signal rules");
(function () {
  function fire(id, file, line) { return has(P.analyze(diff(file, [line])), id); }

  check("prototype-pollution: object-literal __proto__ key", fire("prototype-pollution", "m.js", "var payload = { __proto__: { admin: true } };"));
  check("prototype-pollution: dot assignment", fire("prototype-pollution", "m.js", "target.__proto__ = source;"));
  check("prototype-pollution: constructor.prototype", fire("prototype-pollution", "m.js", "o.constructor.prototype.x = 1;"));
  check("prototype-pollution: quiet on normal .prototype read", !fire("prototype-pollution", "m.js", "var p = Klass.prototype;"));

  check("open-redirect: redirect to req param", fire("open-redirect", "r.js", "res.redirect(req.query.next);"));
  check("open-redirect: window.location from input", fire("open-redirect", "r.js", "window.location = req.params.url;"));
  check("open-redirect: quiet on static path", !fire("open-redirect", "r.js", 'res.redirect("/home");'));

  check("hardcoded-ip: public IP fires", fire("hardcoded-ip", "n.js", 'connect("52.14.220.101");'));
  check("hardcoded-ip: private IP is quiet", !fire("hardcoded-ip", "n.js", 'connect("192.168.1.10");'));
  check("hardcoded-ip: loopback is quiet", !fire("hardcoded-ip", "n.js", 'connect("127.0.0.1");'));
  check("hardcoded-ip: version string is quiet", !fire("hardcoded-ip", "n.js", 'var version = "1.2.3";'));

  check("stacktrace-print: Java printStackTrace", fire("stacktrace-print", "A.java", "e.printStackTrace();"));
  check("stacktrace-print: Python print_exc", fire("stacktrace-print", "a.py", "traceback.print_exc()"));

  // precision: all four must stay silent when the pattern is inside a comment
  check("new rules respect comments (proto in a comment stays silent)",
    !has(P.analyze(diff("m.js", ["var x = 1; // set obj.__proto__ = evil here"])), "prototype-pollution"));
})();

// --- config ----------------------------------------------------------------
group("config");
(function () {
  var cfg = P.config.normalize({ disabled: { "todo": true }, severity: { "debug-print": "high" } });
  var withTodo = diff("a.js", ["// TODO: x", "console.log('y');"]);
  var on = P.analyze(withTodo, { disabled: {}, severity: {} });
  var off = P.analyze(withTodo, cfg);
  check("disabling a rule removes its signal", has(on, "todo") && !has(off, "todo"));
  var bumped = off.signals.filter(function (s) { return s.id === "debug-print"; })[0];
  check("severity override applies", bumped && bumped.severity === "high", bumped && bumped.severity);
  check("export/import round-trips", P.config.exportJSON(cfg).indexOf("todo") !== -1 &&
    P.config.importJSON(P.config.exportJSON(cfg)).disabled.todo === true);
})();

// --- config-file gate ------------------------------------------------------
group("config gate");
(function () {
  check("empty gate normalizes away", P.config.normalize({ gate: {} }).gate === undefined);
  check("gate keeps valid fields", (function () {
    var g = P.config.normalize({ gate: { failOn: "high", maxScore: 80, bogus: 1 } }).gate;
    return g && g.failOn === "high" && g.maxScore === 80 && g.bogus === undefined;
  })());
  check("maxScore clamps to 0–100", P.config.normalize({ gate: { maxScore: 999 } }).gate.maxScore === 100);
  check("invalid failOn is dropped", P.config.normalize({ gate: { failOn: "nope" } }).gate === undefined);
  check("gate survives export/import", (function () {
    var norm = P.config.normalize({ gate: { failOn: "critical" } });
    return P.config.importJSON(P.config.exportJSON(norm)).gate.failOn === "critical";
  })());

  var crit = P.analyze(samples["leaked-secret"]);
  var clean = P.analyze(samples["clean-change"]);
  check("gate fails a critical report on failOn: high", P.config.evaluateGate(crit, { failOn: "high" }).failed);
  check("gate passes a clean report on failOn: high", !P.config.evaluateGate(clean, { failOn: "high" }).failed);
  check("gate fails on maxScore breach", P.config.evaluateGate(crit, { maxScore: 50 }).failed);
  check("gate reasons explain the failure", P.config.evaluateGate(crit, { maxScore: 50 }).reasons.length > 0);
  check("empty gate never fails", !P.config.evaluateGate(crit, {}).failed);
})();

// --- exporters -------------------------------------------------------------
group("exporters");
(function () {
  var r = P.analyze(samples["risky-security"]);
  var md = P.exporters.toMarkdown(r);
  check("markdown has title + score", md.indexOf("# PRism risk report") === 0 && md.indexOf("Risk score:") !== -1);
  check("markdown includes a CWE tag", md.indexOf("CWE-") !== -1);

  var json = JSON.parse(P.exporters.toJSON(r));
  check("json has tool + score + signals", json.tool === "PRism" && typeof json.score === "number" && Array.isArray(json.signals));

  var sarif = JSON.parse(P.exporters.toSARIF(r));
  check("sarif version 2.1.0", sarif.version === "2.1.0");
  check("sarif has a run with driver", sarif.runs && sarif.runs[0].tool.driver.name === "PRism");
  check("sarif rules carry CWE tags", sarif.runs[0].tool.driver.rules.some(function (rule) {
    return rule.properties && rule.properties.tags && rule.properties.tags.some(function (t) { return t.indexOf("cwe") !== -1; });
  }));
  check("sarif results reference rules", sarif.runs[0].results.length > 0 &&
    typeof sarif.runs[0].results[0].ruleIndex === "number");
  check("sarif security-severity present", sarif.runs[0].tool.driver.rules[0].properties["security-severity"] !== undefined);
})();

// --- report shape ----------------------------------------------------------
group("report shape");
(function () {
  var r = P.analyze(samples["risky-security"]);
  check("produces a checklist", Array.isArray(r.checklist) && r.checklist.length > 0);
  check("produces a file breakdown", Array.isArray(r.breakdown) && r.breakdown.length > 0);
  check("produces category rollup", Array.isArray(r.categories) && r.categories.length > 0);
  check("signals sorted, highest severity first", (function () {
    var ord = P.rules.SEVERITY_ORDER;
    for (var i = 1; i < r.signals.length; i++) {
      if (ord.indexOf(r.signals[i].severity) > ord.indexOf(r.signals[i - 1].severity)) return false;
    }
    return true;
  })());
  check("every signal carries why + confidence", r.signals.every(function (s) {
    return s.why && typeof s.confidence === "number";
  }));
})();

// --- suppressions ----------------------------------------------------------
group("suppressions");
(function () {
  // baseline: eval fires with no directive
  var on = P.analyze(diff("a.js", ["eval(userInput);"]));
  check("eval-exec fires without suppression", has(on, "eval-exec"), ids(on).join(","));

  // same-line, rule-scoped
  var off = P.analyze(diff("a.js", ["eval(userInput); // prism-ignore-line eval-exec"]));
  check("prism-ignore-line suppresses the named rule", !has(off, "eval-exec"));
  check("suppressed hits are counted, not dropped", off.suppressed >= 1, "got " + off.suppressed);

  // scoped directive leaves other rules alone
  var mixed = P.analyze(diff("b.js", ["eval(x); console.log(y); // prism-ignore-line eval-exec"]));
  check("scoped suppression spares other rules", !has(mixed, "eval-exec") && has(mixed, "debug-print"), ids(mixed).join(","));

  // next-line
  var nxt = P.analyze(diff("c.js", ["// prism-ignore-next-line", "eval(userInput);"]));
  check("prism-ignore-next-line suppresses the following line", !has(nxt, "eval-exec"));

  // whole file
  var fileWide = P.analyze("diff --git a/d.js b/d.js\n--- a/d.js\n+++ b/d.js\n@@ -1 +1,3 @@\n x\n+// prism-ignore-file eval-exec\n+eval(a);\n+eval(b);\n");
  check("prism-ignore-file suppresses the whole file", !has(fileWide, "eval-exec"));

  // tokenizer-aware: a directive inside a STRING must not count
  var inString = P.analyze(diff("e.js", ['var s = "prism-ignore-line eval-exec"; eval(x);']));
  check("directive inside a string does NOT suppress", has(inString, "eval-exec"));

  // bare directive suppresses everything on the line
  var bare = P.analyze(diff("f.js", ["eval(x); console.log(y); // prism-ignore"]));
  check("bare prism-ignore suppresses all rules on the line", !has(bare, "eval-exec") && !has(bare, "debug-print"));

  // `disable` is an alias for `ignore`
  var alias = P.analyze(diff("g.js", ["eval(x); // prism-disable-line eval-exec"]));
  check("disable is an alias for ignore", !has(alias, "eval-exec"));

  // parseDirective unit surface
  var pd = P.suppress.parseDirective;
  check("parseDirective: bare -> line scope, no rules", (function () { var d = pd("prism-ignore"); return d && d.kind === "line" && d.rules.length === 0; })());
  check("parseDirective: file scope with rule list", (function () { var d = pd("prism-ignore-file eval-exec, todo"); return d && d.kind === "file" && d.rules.length === 2 && d.rules.indexOf("todo") !== -1; })());
  check("parseDirective: next-line via disable alias", (function () { var d = pd("prism-disable-next-line sql-concat"); return d && d.kind === "next" && d.rules[0] === "sql-concat"; })());
  check("parseDirective: ordinary comment -> null", pd("just a normal comment") === null);

  // aggregate rule can be silenced per-file
  var many = [];
  for (var i = 0; i < 32; i++) many.push("var v" + i + " = compute(" + i + ");");
  var lwtOn = P.analyze(diff("big.js", many));
  check("logic-without-tests fires on a big untested change", has(lwtOn, "logic-without-tests"));
  var lwtOff = P.analyze(diff("big.js", ["// prism-ignore-file logic-without-tests"].concat(many)));
  check("file suppression silences the aggregate rule", !has(lwtOff, "logic-without-tests"));
})();

console.log("\n" + (fail === 0 ? "✓ ALL GREEN" : "✗ FAILURES") +
  " — " + pass + " passed, " + fail + " failed.\n");
process.exit(fail === 0 ? 0 : 1);
