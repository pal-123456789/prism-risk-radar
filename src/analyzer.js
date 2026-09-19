/*
 * PRism — analyzer (v2)
 * ---------------------------------------------------------------------------
 * Orchestrates: parse → tokenize → run rules (tokenizer-aware) + entropy →
 * signals → explainable score WATERFALL → per-file breakdown → metrics →
 * review checklist. Pure and deterministic: same diff + same config → same
 * report, every time. That reproducibility is what makes the number trustable.
 *
 * The score is not a magic constant. It is built as an auditable sequence of
 * contributions (the "waterfall"), then squashed to 0–100 with severity
 * floors. `result.waterfall` exposes every step so the UI can show the math.
 */
(function (root) {
  "use strict";

  var P = root.PRism;

  function ensureDeps() {
    // In Node, sibling modules attach to the same global; nothing to do.
    if (!P.rules || !P.parseDiff || !P.tokenizer || !P.entropy || !P.metrics) {
      throw new Error("PRism.analyze: missing dependencies (parser/rules/tokenizer/entropy/metrics).");
    }
  }

  function severityRank(s) { return P.rules.SEVERITY_ORDER.indexOf(s); }
  function truncate(str, n) {
    str = (str || "").replace(/\t/g, "  ");
    return str.length <= n ? str : str.slice(0, n - 1) + "…";
  }

  // Pick the tokenizer view a rule wants to test.
  function viewFor(target, tok, raw) {
    if (!tok) return raw;
    switch (target) {
      case "code": return tok.code;
      case "string": return tok.strings;
      case "comment": return tok.comment;
      case "raw":
      default: return raw;
    }
  }

  function analyze(input, cfg) {
    ensureDeps();
    cfg = P.config ? P.config.normalize(cfg || P.config.load()) : { disabled: {}, severity: {} };

    var model = typeof input === "string" ? P.parseDiff(input) : input;
    var files = model.files || [];
    var R = P.rules;
    var SEV = R.SEVERITY;

    // Tokenize every file's added lines once; reused by rules + metrics.
    var tokenMap = {};
    for (var i = 0; i < files.length; i++) {
      tokenMap[files[i].path] = P.tokenizer.classifyFile(files[i]);
    }

    // Inline suppressions (prism-ignore-*), read from comments only.
    var supp = P.suppress ? P.suppress.build(files, tokenMap) : { isSuppressed: function () { return false; } };
    var suppressedCount = 0;
    function suppressed(path, line, id) {
      if (supp.isSuppressed(path, line, id)) { suppressedCount++; return true; }
      return false;
    }

    var signals = [];
    var fileRisk = {};
    function bump(path, weight, sev) {
      if (!path) return;
      if (!fileRisk[path]) fileRisk[path] = { path: path, points: 0, hits: 0, top: "info" };
      fileRisk[path].points += weight;
      fileRisk[path].hits += 1;
      if (severityRank(sev) > severityRank(fileRisk[path].top)) fileRisk[path].top = sev;
    }
    function effSeverity(rule) {
      var e = P.config ? P.config.effective(cfg, rule) : { severity: rule.severity };
      return e ? e.severity : null; // null => disabled
    }

    // ---- 1) line rules (tokenizer-aware) ----
    R.LINE_RULES.forEach(function (rule) {
      var sev = effSeverity(rule);
      if (sev === null) return;
      var locations = [];
      for (var f = 0; f < files.length; f++) {
        var file = files[f];
        if (file.status === "deleted" || file.isBinary) continue;
        if (rule.files && !rule.files(file.path)) continue;
        var toks = tokenMap[file.path];
        for (var a = 0; a < file.addedLines.length; a++) {
          var ln = file.addedLines[a];
          var hay = viewFor(rule.target, toks && toks[a], ln.text);
          if (hay && rule.re.test(hay)) {
            if (suppressed(file.path, ln.n, rule.id)) continue;
            locations.push({ file: file.path, line: ln.n, snippet: truncate(ln.text.trim(), 160) });
            bump(file.path, SEV[sev], sev);
            if (locations.length >= rule.cap) break;
          }
        }
        if (locations.length >= rule.cap) break;
      }
      if (locations.length) signals.push(makeSignal(rule, sev, locations));
    });

    // ---- 2) file rules ----
    R.FILE_RULES.forEach(function (rule) {
      if (!rule.run) return;
      var sev = effSeverity(rule);
      if (sev === null) return;
      var locations = [];
      for (var f = 0; f < files.length; f++) {
        var hits = rule.run(files[f]);
        for (var h = 0; h < hits.length; h++) {
          if (suppressed(files[f].path, hits[h].line, rule.id)) continue;
          locations.push({ file: files[f].path, line: hits[h].line, snippet: hits[h].snippet });
          bump(files[f].path, SEV[sev], sev);
        }
      }
      if (locations.length) signals.push(makeSignal(rule, sev, locations));
    });

    // ---- 3) entropy secret detector (string content only) ----
    var entropyRule = R.byId["entropy-secret"];
    if (entropyRule && effSeverity(entropyRule) !== null) {
      var esev = effSeverity(entropyRule);
      var elocs = [];
      var seen = {};
      for (var f2 = 0; f2 < files.length; f2++) {
        var file2 = files[f2];
        if (file2.status === "deleted" || file2.isBinary) continue;
        var toks2 = tokenMap[file2.path];
        if (!toks2) continue;
        for (var a2 = 0; a2 < file2.addedLines.length; a2++) {
          var t = toks2[a2];
          if (!t) continue;
          var hit = P.entropy.scanLineStrings(t.stringList);
          if (hit) {
            var keyk = file2.path + ":" + file2.addedLines[a2].n;
            if (seen[keyk]) continue;
            if (suppressed(file2.path, file2.addedLines[a2].n, "entropy-secret")) continue;
            seen[keyk] = 1;
            elocs.push({
              file: file2.path, line: file2.addedLines[a2].n,
              snippet: truncate(file2.addedLines[a2].text.trim(), 160),
              detail: "entropy " + hit.entropy + " bits/char"
            });
            bump(file2.path, SEV[esev], esev);
            if (elocs.length >= entropyRule.cap) break;
          }
        }
        if (elocs.length >= entropyRule.cap) break;
      }
      if (elocs.length) {
        var s = makeSignal(entropyRule, esev, elocs);
        signals.push(s);
      }
    }

    // ---- 4) aggregate: substantial code change, no test touched ----
    var codeAdds = 0, touchedTest = false, touchedCode = [];
    for (var f3 = 0; f3 < files.length; f3++) {
      var file3 = files[f3];
      if (R.helpers.isTest(file3.path)) { if (file3.status !== "deleted") touchedTest = true; continue; }
      if (R.helpers.isCode(file3.path)) {
        codeAdds += file3.additions;
        if (file3.additions + file3.deletions > 0) touchedCode.push(file3.path);
      }
    }
    // A file can opt out of the aggregate with `prism-ignore-file logic-without-tests`.
    touchedCode = touchedCode.filter(function (p) { return !suppressed(p, 0, "logic-without-tests"); });
    var lwtRule = R.byId["logic-without-tests"];
    if (lwtRule && effSeverity(lwtRule) !== null && codeAdds >= 30 && !touchedTest && touchedCode.length) {
      var lsev = effSeverity(lwtRule);
      var llocs = touchedCode.slice(0, 8).map(function (p) { return { file: p, line: 0, snippet: p }; });
      signals.push(makeSignal(lwtRule, lsev, llocs));
      touchedCode.slice(0, 8).forEach(function (p) { bump(p, SEV[lsev], lsev); });
    }

    // ---- 5) metrics ----
    var metrics = P.metrics.compute(model, tokenMap, R.helpers);

    // ---- 6) score waterfall ----
    var totals = model.totals || { churn: 0, files: files.length, additions: 0, deletions: 0 };
    var scored = scoreWaterfall(signals, totals, metrics);

    // ---- 7) per-file breakdown ----
    for (var f4 = 0; f4 < files.length; f4++) {
      var fl = files[f4];
      var churn = fl.additions + fl.deletions;
      if (!fileRisk[fl.path]) fileRisk[fl.path] = { path: fl.path, points: 0, hits: 0, top: "info" };
      fileRisk[fl.path].churn = churn;
      fileRisk[fl.path].additions = fl.additions;
      fileRisk[fl.path].deletions = fl.deletions;
      fileRisk[fl.path].status = fl.status;
      fileRisk[fl.path].language = fl.language;
      fileRisk[fl.path].points += Math.min(12, Math.log(churn + 1) / Math.log(2) * 2);
    }
    var breakdown = Object.keys(fileRisk).map(function (k) { return fileRisk[k]; });
    breakdown.sort(function (a, b) { return b.points - a.points; });

    // ---- 8) severity counts ----
    var counts = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
    signals.forEach(function (sg) { counts[sg.severity] += sg.count; });

    // category rollup for the overview
    var categories = {};
    signals.forEach(function (sg) {
      if (!categories[sg.category]) categories[sg.category] = { category: sg.category, count: 0, top: "info" };
      categories[sg.category].count += sg.count;
      if (severityRank(sg.severity) > severityRank(categories[sg.category].top)) categories[sg.category].top = sg.severity;
    });
    var categoryList = Object.keys(categories).map(function (k) { return categories[k]; })
      .sort(function (a, b) { return severityRank(b.top) - severityRank(a.top) || b.count - a.count; });

    return {
      score: scored.score,
      tier: scored.tier,
      tierColor: scored.color,
      waterfall: scored.waterfall,
      summary: buildSummary(scored, signals, totals, metrics),
      signals: signals.sort(function (a, b) {
        var d = severityRank(b.severity) - severityRank(a.severity);
        if (d !== 0) return d;
        return b.count - a.count;
      }),
      counts: counts,
      categories: categoryList,
      totals: totals,
      metrics: metrics,
      breakdown: breakdown,
      checklist: buildChecklist(signals, files, totals, metrics),
      files: files,
      tokens: tokenMap,
      suppressed: suppressedCount
    };
  }

  function makeSignal(rule, severity, locations) {
    return {
      id: rule.id, title: rule.title, category: rule.category,
      severity: severity, baseSeverity: rule.severity,
      confidence: rule.confidence != null ? rule.confidence : 0.6,
      cwe: rule.cwe || null, owasp: rule.owasp || null,
      why: rule.why, fix: rule.fix || null,
      count: locations.length, weight: P.rules.SEVERITY[severity],
      locations: locations
    };
  }

  /*
   * Build the score as an explainable waterfall of contributions.
   * Confidence scales each signal's contribution — a 0.5-confidence heuristic
   * pushes half as hard as a near-certain one, which is the honest thing to do.
   */
  function scoreWaterfall(signals, totals, metrics) {
    var steps = [];
    var points = 0;

    // group by severity for a readable waterfall
    var bySev = { critical: [], high: [], medium: [], low: [], info: [] };
    signals.forEach(function (s) { bySev[s.severity].push(s); });

    P.rules.SEVERITY_ORDER.slice().reverse().forEach(function (sev) {
      var group = bySev[sev];
      if (!group.length) return;
      var sub = 0;
      group.forEach(function (s) {
        var perHit = s.weight * (0.55 + 0.45 * s.confidence); // confidence-weighted
        var eff = perHit * (1 + 0.5 * (Math.min(s.count, 12) - 1));
        sub += eff;
      });
      points += sub;
      steps.push({ label: cap(sev) + " signals", detail: group.length + " rule" + (group.length > 1 ? "s" : ""), points: round1(sub) });
    });

    var churn = totals.churn || 0;
    var churnPts = Math.min(28, Math.log(churn + 1) / Math.log(2) * 3);
    if (churnPts > 0.05) { points += churnPts; steps.push({ label: "Change size", detail: churn + " lines changed", points: round1(churnPts) }); }

    var filePts = Math.min(12, (totals.files || 0) * 1.5);
    if (filePts > 0.05) { points += filePts; steps.push({ label: "Files touched", detail: (totals.files || 0) + " files", points: round1(filePts) }); }

    var cplx = metrics && metrics.complexityDelta > 0 ? Math.min(10, metrics.complexityDelta * 0.8) : 0;
    if (cplx > 0.05) { points += cplx; steps.push({ label: "Added complexity", detail: "+" + metrics.complexityDelta + " decision points", points: round1(cplx) }); }

    var raw = 100 * (1 - Math.exp(-points / 55));

    // severity floors
    var hasCritical = signals.some(function (s) { return s.severity === "critical"; });
    var hasHigh = signals.some(function (s) { return s.severity === "high"; });
    var floored = raw, floorNote = null;
    if (hasCritical && raw < 82) { floored = 82; floorNote = "Critical-severity floor"; }
    else if (hasHigh && raw < 60) { floored = 60; floorNote = "High-severity floor"; }

    var value = Math.max(0, Math.min(100, Math.round(floored)));
    steps.push({ label: "Squash to 0–100", detail: "raw " + round1(points) + " pts → " + Math.round(raw) + (floorNote ? " → " + floorNote : ""), points: null, isTotal: false });

    var tier, color;
    if (value < 25) { tier = "Low"; color = "safe"; }
    else if (value < 55) { tier = "Moderate"; color = "notice"; }
    else if (value < 80) { tier = "High"; color = "warn"; }
    else { tier = "Critical"; color = "danger"; }

    return { score: value, tier: tier, color: color, waterfall: { steps: steps, total: value } };
  }

  function buildSummary(scored, signals, totals, metrics) {
    if (!totals.files) return "Paste a diff to run the risk radar.";
    var lead;
    if (scored.tier === "Critical") lead = "Do not merge as-is.";
    else if (scored.tier === "High") lead = "Needs a careful review.";
    else if (scored.tier === "Moderate") lead = "Reviewable, with a few things to check.";
    else lead = "Low-risk change.";
    var crit = signals.filter(function (s) { return s.severity === "critical"; }).length;
    var high = signals.filter(function (s) { return s.severity === "high"; }).length;
    var tail = "";
    if (crit) tail = " " + crit + " critical issue" + (crit > 1 ? "s" : "") + " found.";
    else if (high) tail = " " + high + " high-severity issue" + (high > 1 ? "s" : "") + " found.";
    var body = totals.files + (totals.files === 1 ? " file" : " files") + " changed · +" +
      totals.additions + " / −" + totals.deletions + " · ~" + metrics.reviewMinutes + " min review";
    return lead + " " + body + "." + tail;
  }

  function buildChecklist(signals, files, totals, metrics) {
    var items = [];
    var byId = {};
    signals.forEach(function (s) { byId[s.id] = s; });
    var cat = {};
    signals.forEach(function (s) { cat[s.category] = (cat[s.category] || 0) + s.count; });

    if (byId["conflict-markers"]) items.push({ pri: "must", text: "Remove the leftover merge-conflict markers — this code cannot run as written." });
    if (byId["bidi-unicode"]) items.push({ pri: "must", text: "Strip the bidirectional Unicode control characters — verify the code reads the same to a human and the compiler." });
    if (byId["private-key"] || byId["provider-token"] || byId["aws-key"] || byId["secret-file"] || byId["generic-secret"] || byId["entropy-secret"] || byId["jwt"] || byId["basic-auth-url"])
      items.push({ pri: "must", text: "Rotate every exposed secret and scrub it from git history — assume it is already leaked." });
    if (byId["eval-exec"] || byId["shell-injection"] || byId["sql-concat"] || byId["insecure-deserialize"] || byId["nosql-where"] || byId["template-injection"])
      items.push({ pri: "must", text: "Confirm no untrusted input reaches the flagged execution / query sink; parameterize or sanitize." });
    if (byId["raw-html"] || byId["js-scheme"]) items.push({ pri: "must", text: "Verify HTML/URL sinks are fed only sanitized, scheme-checked content (XSS)." });
    if (byId["tls-off"]) items.push({ pri: "must", text: "Re-enable certificate verification before this touches any real network." });
    if (byId["path-traversal"] || byId["ssrf"]) items.push({ pri: "should", text: "Validate input-derived paths/URLs against an allow-list (traversal / SSRF)." });
    if (byId["weak-crypto"] || byId["insecure-random"] || byId["ecb-mode"]) items.push({ pri: "should", text: "Replace weak crypto/RNG with vetted algorithms (SHA-256+, AES-GCM, CSPRNG)." });
    if (byId["focused-test"]) items.push({ pri: "should", text: "Remove .only / .skip so the full test suite actually runs." });
    if (cat["Testing"]) items.push({ pri: "should", text: "Add or restore tests covering the changed behavior." });
    if (byId["dep-change"]) items.push({ pri: "should", text: "Review new/updated dependencies and their changelog; check for typosquats." });
    if (byId["migration"]) items.push({ pri: "should", text: "Confirm the migration is reversible and safe under load." });
    if (byId["infra-change"] || byId["debug-flag"] || byId["cors-wildcard"]) items.push({ pri: "should", text: "Double-check config/CI/CORS changes in a dry run; confirm prod posture." });
    if (byId["debug-print"] || byId["todo"] || byId["zero-width"]) items.push({ pri: "nice", text: "Clear leftover debug output, TODO/FIXME markers, and stray invisible characters." });
    if (byId["large-file-churn"]) items.push({ pri: "nice", text: "Consider splitting the largest files into smaller, focused commits." });
    if (metrics && metrics.maxNestingAdded >= 4) items.push({ pri: "nice", text: "Deeply nested code was added (depth ~" + metrics.maxNestingAdded + ") — consider flattening for readability." });

    items.push({ pri: "always", text: "Does the change actually do what the PR title and description claim?" });
    items.push({ pri: "always", text: "Are error paths and edge cases handled, not just the happy path?" });
    if (totals.churn > 0) items.push({ pri: "always", text: "Read the diff once more end to end — anything here you would not want to own at 2am?" });
    return items;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function round1(n) { return Math.round(n * 10) / 10; }

  P.analyze = analyze;
  P.scoreWaterfall = scoreWaterfall;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { analyze: analyze };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
