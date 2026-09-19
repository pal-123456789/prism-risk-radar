/*
 * PRism — exporters
 * ---------------------------------------------------------------------------
 * Markdown (for a PR comment), JSON (for tooling), and SARIF 2.1.0 — the
 * OASIS standard that GitHub code scanning, Azure DevOps, and most security
 * dashboards ingest natively. Emitting real SARIF is what lets PRism's local,
 * offline result flow into the same place server-side scanners report to.
 */
(function (root) {
  "use strict";

  var P = root.PRism;

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // ---------- Markdown ----------
  function toMarkdown(result) {
    var L = [];
    L.push("# PRism risk report");
    L.push("");
    L.push("**Risk score:** " + result.score + "/100 — **" + result.tier + " risk**");
    L.push("");
    L.push("> " + result.summary);
    L.push("");
    var c = result.counts;
    var anyc = ["critical", "high", "medium", "low", "info"].some(function (s) { return c[s]; });
    if (anyc) {
      L.push("| Severity | Count |");
      L.push("|---|---|");
      ["critical", "high", "medium", "low", "info"].forEach(function (s) {
        if (c[s]) L.push("| " + cap(s) + " | " + c[s] + " |");
      });
      L.push("");
    }
    if (result.metrics) {
      var m = result.metrics;
      L.push("**Change:** " + m.files + " files · +" + m.additions + " / −" + m.deletions +
        " · complexity Δ " + (m.complexityDelta >= 0 ? "+" : "") + m.complexityDelta +
        " · ~" + m.reviewMinutes + " min review");
      L.push("");
    }
    L.push("## Signals");
    if (!result.signals.length) L.push("_No risk signals fired._");
    result.signals.forEach(function (s) {
      L.push("");
      var tags = [s.cwe, s.owasp].filter(Boolean).join(" · ");
      L.push("### [" + s.severity.toUpperCase() + "] " + s.title + " (" + s.count + "×)");
      L.push("_" + s.category + (tags ? " · " + tags : "") + " · confidence " + Math.round(s.confidence * 100) + "%_");
      L.push("");
      L.push(s.why);
      if (s.fix) L.push("**Fix:** " + s.fix);
      s.locations.slice(0, 8).forEach(function (l) {
        L.push("- `" + (l.file || "?") + (l.line ? ":" + l.line : "") + "`" +
          (l.snippet && l.line ? " — `" + l.snippet + "`" : ""));
      });
    });
    L.push("");
    L.push("## Review checklist");
    result.checklist.forEach(function (it) {
      L.push("- [ ] **" + it.pri + "** — " + it.text);
    });
    L.push("");
    L.push("_Generated locally by PRism. Heuristic radar, not a proof of safety._");
    return L.join("\n");
  }

  // ---------- JSON ----------
  function toJSON(result) {
    return JSON.stringify({
      tool: "PRism",
      score: result.score,
      tier: result.tier,
      summary: result.summary,
      counts: result.counts,
      metrics: result.metrics,
      waterfall: result.waterfall,
      signals: result.signals.map(function (s) {
        return {
          id: s.id, title: s.title, category: s.category, severity: s.severity,
          confidence: s.confidence, cwe: s.cwe, owasp: s.owasp,
          why: s.why, fix: s.fix, count: s.count,
          locations: s.locations.map(function (l) { return { file: l.file, line: l.line }; })
        };
      }),
      checklist: result.checklist
    }, null, 2);
  }

  // ---------- SARIF 2.1.0 ----------
  var SARIF_LEVEL = { critical: "error", high: "error", medium: "warning", low: "warning", info: "note" };
  var SARIF_RANK = { critical: 100, high: 80, medium: 50, low: 20, info: 5 };

  function toSARIF(result) {
    // Build the rule catalog from the signals actually present (with metadata).
    var ruleIndex = {};
    var rules = [];
    result.signals.forEach(function (s) {
      if (ruleIndex[s.id] !== undefined) return;
      ruleIndex[s.id] = rules.length;
      var props = { category: s.category };
      var tags = [s.category.toLowerCase()];
      if (s.cwe) { tags.push("external/cwe/" + s.cwe.toLowerCase()); props.cwe = s.cwe; }
      if (s.owasp) { props.owasp = s.owasp; tags.push("owasp/" + s.owasp.toLowerCase()); }
      props.tags = tags;
      props["security-severity"] = String(sevScore(s.severity));
      rules.push({
        id: s.id,
        name: pascal(s.id),
        shortDescription: { text: s.title },
        fullDescription: { text: s.why },
        help: { text: (s.fix ? "Fix: " + s.fix + "\n\n" : "") + s.why },
        defaultConfiguration: { level: SARIF_LEVEL[s.severity] || "warning" },
        properties: props
      });
    });

    var results = [];
    result.signals.forEach(function (s) {
      s.locations.forEach(function (loc) {
        results.push({
          ruleId: s.id,
          ruleIndex: ruleIndex[s.id],
          level: SARIF_LEVEL[s.severity] || "warning",
          rank: SARIF_RANK[s.severity],
          message: { text: s.title + (s.fix ? " — " + s.fix : "") },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: loc.file || "unknown" },
              region: loc.line ? { startLine: loc.line } : { startLine: 1 }
            }
          }],
          properties: { confidence: s.confidence, cwe: s.cwe || null }
        });
      });
    });

    var sarif = {
      version: "2.1.0",
      $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
      runs: [{
        tool: {
          driver: {
            name: "PRism",
            informationUri: "https://github.com/",
            version: "1.0.0",
            rules: rules
          }
        },
        properties: {
          score: result.score, tier: result.tier
        },
        results: results
      }]
    };
    return JSON.stringify(sarif, null, 2);
  }

  function sevScore(sev) { return SARIF_RANK[sev] / 10; } // 0-10 GitHub security-severity
  function pascal(id) {
    return String(id).split(/[-_]/).map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join("");
  }

  root.PRism = root.PRism || {};
  root.PRism.exporters = { toMarkdown: toMarkdown, toJSON: toJSON, toSARIF: toSARIF };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PRism.exporters;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
