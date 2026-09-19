/*
 * PRism — rendering (v2)
 * ---------------------------------------------------------------------------
 * Pure view layer: takes an analysis result and paints the tabbed report —
 * overview (waterfall + categories + files), signals, annotated diff, metrics,
 * and checklist. Every piece of user-supplied text (paths, code, snippets) is
 * escaped before it touches the DOM: an XSS radar that is itself XSS-able would
 * be a bad look. No innerHTML is ever fed raw diff content.
 */
(function (root) {
  "use strict";

  var TONE = { critical: "danger", high: "warn", medium: "notice", low: "info", info: "info" };
  var CIRC = 2 * Math.PI * 82; // gauge circumference

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function q(id) { return document.getElementById(id); }
  function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Reveal invisible / bidi control characters so they can't hide in the DOM.
  // These are exactly the chars the trojan-source and zero-width rules catch;
  // showing them as visible sentinels is the honest way to render a diff.
  // Same code points the bidi-unicode + zero-width rules catch, built from
  // explicit escapes so no invisible character ever lives in this source file.
  var INVISIBLE = new RegExp(
    "[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]", "g");
  function markInvisibles(s) {
    return String(s == null ? "" : s).replace(INVISIBLE, function (ch) {
      var hex = ch.charCodeAt(0).toString(16).toUpperCase();
      while (hex.length < 4) hex = "0" + hex;
      return '<span class="invis" title="U+' + hex + ' invisible / bidi control character">U+' + hex + '</span>';
    });
  }

  function renderReport(result, opts) {
    opts = opts || {};
    q("emptyState").hidden = true;
    q("reportBody").hidden = false;

    renderGauge(result, opts.animate !== false);
    q("summaryLine").textContent = result.summary;
    renderSevCounts(result.counts);
    renderWaterfall(result.waterfall);
    renderCategories(result.categories);
    renderFiles(result.breakdown);
    renderSignals(result.signals);
    renderDiff(result);
    renderMetrics(result.metrics);
    renderChecklist(result.checklist);

    var n = result.signals.length;
    q("signalCount").textContent = n + (n === 1 ? " finding" : " findings");
    var tc = q("tabSignalCount");
    if (n) { tc.textContent = n; tc.hidden = false; } else { tc.hidden = true; }
  }

  // ---- hero gauge -----------------------------------------------------------
  function renderGauge(result, animate) {
    var arc = q("gaugeArc");
    var value = result.score;
    var target = CIRC * (1 - value / 100);
    var tierEl = q("scoreTier");
    tierEl.textContent = result.tier + " risk";
    tierEl.className = "score-tier t-" + result.tierColor;

    var valEl = q("scoreValue");
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!animate || reduced) {
      arc.style.transition = "none";
      arc.style.strokeDashoffset = target;
      valEl.textContent = value;
      return;
    }
    arc.style.transition = "";
    arc.style.strokeDashoffset = CIRC;
    arc.getBoundingClientRect(); // force reflow so the transition re-triggers
    requestAnimationFrame(function () { arc.style.strokeDashoffset = target; });

    // Count the number up in lockstep with the arc sweep.
    var start = null, dur = 950;
    requestAnimationFrame(function loop(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      valEl.textContent = Math.round(value * eased);
      if (p < 1) requestAnimationFrame(loop);
      else valEl.textContent = value;
    });
  }

  function renderSevCounts(counts) {
    var order = ["critical", "high", "medium", "low", "info"];
    var labels = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };
    var html = "";
    order.forEach(function (sev) {
      if (!counts[sev]) return;
      html += '<span class="sev-pill"><span class="dot d-' + TONE[sev] + '"></span>' +
        labels[sev] + ' <b>' + counts[sev] + '</b></span>';
    });
    if (!html) html = '<span class="sev-pill"><span class="dot d-safe"></span>No issues flagged <b>✓</b></span>';
    q("sevCounts").innerHTML = html;
  }

  // ---- overview: waterfall --------------------------------------------------
  function renderWaterfall(wf) {
    var host = q("waterfall");
    if (!wf || !wf.steps || !wf.steps.length) { host.innerHTML = '<p class="muted">No contributions.</p>'; return; }
    var max = 1;
    wf.steps.forEach(function (s) { if (typeof s.points === "number" && s.points > max) max = s.points; });
    var html = "";
    wf.steps.forEach(function (s) {
      var hasPts = typeof s.points === "number";
      var pct = hasPts ? Math.max(2, Math.round(s.points / max * 100)) : 0;
      html +=
        '<div class="wf-row' + (hasPts ? "" : " wf-note") + '">' +
          '<span class="wf-label">' + esc(s.label) + '</span>' +
          '<span class="wf-detail">' + esc(s.detail || "") + '</span>' +
          (hasPts
            ? '<span class="wf-bar"><span class="wf-fill" style="width:' + pct + '%"></span></span>' +
              '<span class="wf-pts">+' + s.points + '</span>'
            : '<span class="wf-arrow" aria-hidden="true">↓</span>') +
        '</div>';
    });
    html += '<div class="wf-row wf-total"><span class="wf-label">Final score</span>' +
      '<span class="wf-detail"></span><span class="wf-bar"></span>' +
      '<span class="wf-pts">' + wf.total + '</span></div>';
    host.innerHTML = html;
  }

  function renderCategories(categories) {
    var host = q("categoryList");
    if (!categories || !categories.length) {
      host.innerHTML = '<p class="muted">No risk categories triggered — the change reads clean.</p>';
      return;
    }
    host.innerHTML = categories.map(function (c) {
      var tone = TONE[c.top] || "info";
      return '<div class="cat-row"><span class="dot d-' + tone + '"></span>' +
        '<span class="cat-name">' + esc(c.category) + '</span>' +
        '<span class="cat-count">' + c.count + '</span></div>';
    }).join("");
  }

  function renderFiles(breakdown) {
    var body = q("fileRows");
    if (!breakdown.length) { body.innerHTML = '<tr><td colspan="5">No files.</td></tr>'; return; }
    var statusTone = { added: "t-safe", deleted: "t-danger", renamed: "t-notice", modified: "t-info", binary: "t-warn" };
    var html = "";
    breakdown.forEach(function (f) {
      var tone = TONE[f.top] || "info";
      html +=
        '<tr>' +
          '<td><span class="file-path">' + esc(f.path || "(unknown)") + '</span></td>' +
          '<td><span class="status-tag ' + (statusTone[f.status] || "t-info") + '">' + esc(f.status || "?") + '</span></td>' +
          '<td class="num add-num">' + (f.additions || 0) + '</td>' +
          '<td class="num del-num">' + (f.deletions || 0) + '</td>' +
          '<td>' + (f.hits
            ? '<span class="top-sig"><span class="dot d-' + tone + '"></span>' + capital(f.top) + '</span>'
            : '<span class="loc-line">—</span>') + '</td>' +
        '</tr>';
    });
    body.innerHTML = html;
  }

  // ---- signals --------------------------------------------------------------
  function renderSignals(signals) {
    var host = q("signalList");
    if (!signals.length) {
      host.innerHTML = '<p class="disclaimer">No risk signals fired. The change looks clean to the radar — ' +
        'still worth a human read for logic and intent.</p>';
      return;
    }
    var html = "";
    signals.forEach(function (s, idx) {
      var tone = TONE[s.severity];
      var tags = [s.cwe, s.owasp].filter(Boolean).map(function (t) {
        return '<span class="tag">' + esc(t) + '</span>';
      }).join("");
      var conf = '<span class="tag tag-conf" title="Detector confidence">' + Math.round(s.confidence * 100) + '% conf</span>';
      var locs = s.locations.slice(0, 8).map(function (l) {
        var jump = (l.file && l.line)
          ? ' data-jump-file="' + esc(l.file) + '" data-jump-line="' + l.line + '"' : '';
        var head = '<span class="loc-path">' + esc(l.file || "(unknown)") + '</span>' +
          (l.line ? ' <span class="loc-line">:' + l.line + '</span>' : '') +
          (l.detail ? ' <span class="loc-detail">' + esc(l.detail) + '</span>' : '');
        var snip = l.snippet && l.line
          ? '<code class="loc-snip">' + markInvisibles(esc(l.snippet)) + '</code>' : '';
        return '<button type="button" class="loc"' + jump + '>' + head + snip + '</button>';
      }).join("");
      var more = s.locations.length > 8
        ? '<p class="loc-more">+ ' + (s.locations.length - 8) + ' more…</p>' : '';
      var fix = s.fix ? '<p class="signal-fix"><span class="fix-label">Fix</span>' + esc(s.fix) + '</p>' : '';

      html +=
        '<details class="signal sev-' + s.severity + '"' + (idx === 0 ? ' open' : '') + '>' +
          '<summary class="signal-head">' +
            '<span class="sev-tag t-' + tone + '">' + s.severity + '</span>' +
            '<span class="signal-title">' + esc(s.title) + '</span>' +
            '<span class="signal-cat">' + esc(s.category) + '</span>' +
            '<span class="signal-badge">' + s.count + '×</span>' +
            '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 6l6 6-6 6"/></svg>' +
          '</summary>' +
          '<div class="signal-body">' +
            '<div class="signal-tags">' + tags + conf + '</div>' +
            '<p class="signal-why">' + esc(s.why) + '</p>' +
            fix +
            '<div class="loc-list">' + locs + more + '</div>' +
          '</div>' +
        '</details>';
    });
    host.innerHTML = html;
  }

  // ---- annotated diff viewer ------------------------------------------------
  // Build a lookup of the worst signal per file:line so the gutter can mark it.
  function buildFlagMap(signals) {
    var order = root.PRism.rules.SEVERITY_ORDER;
    var map = {};
    signals.forEach(function (s) {
      s.locations.forEach(function (l) {
        if (!l.file || !l.line) return;
        var key = l.file + ":" + l.line;
        var cur = map[key];
        if (!cur || order.indexOf(s.severity) > order.indexOf(cur.severity)) {
          map[key] = { severity: s.severity, title: s.title };
        }
      });
    });
    return map;
  }

  // Rendering a huge diff line-by-line can produce tens of thousands of DOM
  // nodes and stall the tab. The guard: past this many changed lines, files
  // that carry no flags start COLLAPSED and their bodies are built only when
  // the user opens them (lazy). Flagged files always render up front — those
  // are the ones worth reading.
  var LARGE_DIFF_LINES = 2000;
  var STATUS_TONE = { added: "t-safe", deleted: "t-danger", renamed: "t-notice", copied: "t-notice", modified: "t-info", binary: "t-warn" };

  var diffState = null; // { files, flags, flaggedByFile, perf }

  function fileIsFlagged(path, flags) {
    for (var k in flags) if (flags.hasOwnProperty(k) && k.indexOf(path + ":") === 0) return true;
    return false;
  }

  function buildFileBody(file, fi, flags) {
    if (file.isBinary) return '<div class="diff-binary">Binary file — not shown.</div>';
    var html = '<div class="diff-body">';
    (file.hunks || []).forEach(function (hunk) {
      html += '<div class="diff-hunk-head"><span class="dl-gutter">…</span>' +
        '<span class="dl-text">' + esc(hunk.header) + '</span></div>';
      hunk.lines.forEach(function (ln) {
        var cls = "dl dl-" + ln.type;
        var oldN = ln.type === "add" ? "" : (ln.oldNo != null ? ln.oldNo : "");
        var newN = ln.type === "del" ? "" : (ln.newNo != null ? ln.newNo : "");
        var sign = ln.type === "add" ? "+" : ln.type === "del" ? "−" : " ";
        var marker = "", anchor = "";
        if (ln.type === "add" && ln.newNo != null) {
          anchor = ' id="dl-' + fi + '-' + ln.newNo + '"';
          var fl = flags[file.path + ":" + ln.newNo];
          if (fl) {
            cls += " dl-flagged sev-" + fl.severity;
            marker = '<span class="dl-flag t-' + TONE[fl.severity] + '" title="' + esc(fl.title) + '">' +
              fl.severity.charAt(0).toUpperCase() + '</span>';
          }
        }
        html += '<div class="' + cls + '"' + anchor + '>' +
          '<span class="dl-num dl-old">' + oldN + '</span>' +
          '<span class="dl-num dl-new">' + newN + '</span>' +
          '<span class="dl-mark">' + marker + '</span>' +
          '<span class="dl-sign">' + sign + '</span>' +
          '<span class="dl-text">' + markInvisibles(esc(ln.text)) + '</span>' +
        '</div>';
      });
    });
    return html + '</div>';
  }

  function fileShell(file, fi, flagged, collapsed) {
    var html = '<div class="diff-file' + (collapsed ? " collapsed" : "") + (flagged ? " has-flags" : "") +
      '" data-diff-file="' + esc(file.path || "") + '" data-fi="' + fi + '">';
    html += '<button type="button" class="diff-file-head" aria-expanded="' + (collapsed ? "false" : "true") + '">' +
      '<span class="diff-caret" aria-hidden="true">▾</span>' +
      '<span class="file-path">' + esc(file.path || "(unknown)") + '</span>' +
      (flagged ? '<span class="diff-flag-dot" title="has flagged lines"></span>' : '') +
      '<span class="status-tag ' + (STATUS_TONE[file.status] || "t-info") + '">' + esc(file.status || "?") + '</span>' +
      '<span class="diff-lang">' + esc(file.language || "") + '</span>' +
      '<span class="diff-counts"><span class="add-num">+' + file.additions + '</span> ' +
        '<span class="del-num">−' + file.deletions + '</span></span>' +
      '</button>';
    html += '<div class="diff-file-body">' + (collapsed ? "" : buildFileBody(file, fi, flagsFor())) + '</div>';
    return html + '</div>';
    function flagsFor() { return diffState ? diffState.flags : {}; }
  }

  function renderDiff(result) {
    var host = q("diffView");
    var files = result.files || [];
    if (!files.length) {
      host.innerHTML = '<p class="muted">No files to show.</p>';
      diffState = null;
      updateDiffSummary();
      return;
    }
    var flags = buildFlagMap(result.signals);
    var totalLines = (result.totals && result.totals.churn) || 0;
    var perf = totalLines > LARGE_DIFF_LINES;

    var flaggedByFile = {};
    files.forEach(function (f) { flaggedByFile[f.path] = fileIsFlagged(f.path, flags); });
    diffState = { files: files, flags: flags, flaggedByFile: flaggedByFile, perf: perf, onlyFlagged: false };

    var html = "";
    files.forEach(function (file, fi) {
      var flagged = flaggedByFile[file.path];
      // In perf mode, collapse unflagged files by default (lazy body).
      var collapsed = perf && !flagged;
      html += fileShell(file, fi, flagged, collapsed);
    });
    host.innerHTML = html;
    updateDiffSummary();
  }

  // Expand/collapse a single file; builds the body lazily the first time.
  function toggleDiffFile(fileEl) {
    if (!fileEl || !diffState) return;
    var collapsed = fileEl.classList.contains("collapsed");
    var body = fileEl.querySelector(".diff-file-body");
    var head = fileEl.querySelector(".diff-file-head");
    if (collapsed) {
      if (body && !body.innerHTML) {
        var fi = parseInt(fileEl.getAttribute("data-fi"), 10);
        body.innerHTML = buildFileBody(diffState.files[fi], fi, diffState.flags);
      }
      fileEl.classList.remove("collapsed");
      if (head) head.setAttribute("aria-expanded", "true");
    } else {
      fileEl.classList.add("collapsed");
      if (head) head.setAttribute("aria-expanded", "false");
    }
  }

  function setAllDiffFiles(collapse) {
    var host = q("diffView");
    if (!host || !diffState) return;
    var els = host.querySelectorAll(".diff-file");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var isCollapsed = el.classList.contains("collapsed");
      if (collapse && !isCollapsed) toggleDiffFile(el);
      else if (!collapse && isCollapsed) toggleDiffFile(el);
    }
  }

  // "Only flagged files" filter — hides files with no flagged lines.
  function setOnlyFlagged(on) {
    var host = q("diffView");
    if (!host || !diffState) return;
    diffState.onlyFlagged = !!on;
    var els = host.querySelectorAll(".diff-file");
    for (var i = 0; i < els.length; i++) {
      var path = els[i].getAttribute("data-diff-file");
      var flagged = diffState.flaggedByFile[path];
      els[i].hidden = on && !flagged;
    }
    updateDiffSummary();
  }

  function updateDiffSummary() {
    var el = q("diffSummary");
    if (!el) return;
    if (!diffState) { el.textContent = ""; return; }
    var total = diffState.files.length;
    var flagged = 0;
    diffState.files.forEach(function (f) { if (diffState.flaggedByFile[f.path]) flagged++; });
    var msg = total + (total === 1 ? " file" : " files") + " · " + flagged + " flagged";
    if (diffState.perf) msg += " · large diff — clean files collapsed for speed";
    el.textContent = msg;
  }

  // ---- metrics --------------------------------------------------------------
  function renderMetrics(m) {
    if (!m) return;
    var cards = [
      { label: "Files changed", value: m.files, hint: m.testFiles + " test · " + m.codeFiles + " code" },
      { label: "Lines added", value: "+" + m.additions, tone: "safe" },
      { label: "Lines removed", value: "−" + m.deletions, tone: "danger" },
      { label: "Total churn", value: m.churn, hint: "additions + deletions" },
      { label: "Complexity Δ", value: (m.complexityDelta >= 0 ? "+" : "") + m.complexityDelta,
        hint: m.decisionsAdded + " added · " + m.decisionsRemoved + " removed",
        tone: m.complexityDelta > 6 ? "warn" : m.complexityDelta > 0 ? "notice" : "safe" },
      { label: "Max nesting", value: m.maxNestingAdded, hint: "depth introduced",
        tone: m.maxNestingAdded >= 4 ? "warn" : m.maxNestingAdded >= 3 ? "notice" : null },
      { label: "Comment ratio", value: Math.round(m.commentRatio * 100) + "%", hint: m.commentLines + " comment lines" },
      { label: "Est. review time", value: "~" + m.reviewMinutes + "m", hint: "focused reading" }
    ];
    q("metricCards").innerHTML = cards.map(function (c) {
      return '<div class="metric-card">' +
        '<span class="metric-value' + (c.tone ? " mv-" + c.tone : "") + '">' + esc(String(c.value)) + '</span>' +
        '<span class="metric-label">' + esc(c.label) + '</span>' +
        (c.hint ? '<span class="metric-hint">' + esc(c.hint) + '</span>' : '') +
      '</div>';
    }).join("");

    var langs = m.languages || [];
    var totalChurn = langs.reduce(function (a, l) { return a + l.churn; }, 0) || 1;
    q("langMix").innerHTML = langs.map(function (l) {
      var pct = Math.round(l.churn / totalChurn * 100);
      return '<div class="lang-row">' +
        '<span class="lang-name">' + esc(l.language) + '</span>' +
        '<span class="lang-bar"><span class="lang-fill" style="width:' + Math.max(3, pct) + '%"></span></span>' +
        '<span class="lang-pct">' + pct + '%</span>' +
      '</div>';
    }).join("") || '<p class="muted">No languages detected.</p>';
  }

  function renderChecklist(items) {
    var host = q("checklist");
    var priLabel = { must: "must", should: "should", nice: "polish", always: "always" };
    host.innerHTML = items.map(function (it) {
      return '<li><span class="pri pri-' + it.pri + '">' + (priLabel[it.pri] || it.pri) + '</span>' +
        '<span>' + esc(it.text) + '</span></li>';
    }).join("");
  }

  // ---- settings drawer: rule config list ------------------------------------
  function renderRuleConfig(cfg) {
    var host = q("ruleConfigList");
    var cat = root.PRism.rules.catalog();
    var SEV = root.PRism.config.SEVERITIES;
    // group by category
    var groups = {};
    cat.forEach(function (r) { (groups[r.category] = groups[r.category] || []).push(r); });
    var html = "";
    Object.keys(groups).sort().forEach(function (g) {
      html += '<div class="rc-group"><h3 class="rc-cat">' + esc(g) + '</h3>';
      groups[g].forEach(function (r) {
        var disabled = !!(cfg.disabled && cfg.disabled[r.id]);
        var effSev = (cfg.severity && cfg.severity[r.id]) || r.severity;
        var opts = SEV.map(function (s) {
          return '<option value="' + s + '"' + (s === effSev ? " selected" : "") + '>' + capital(s) + '</option>';
        }).join("");
        html += '<div class="rc-rule' + (disabled ? " rc-off" : "") + '" data-rule="' + esc(r.id) + '">' +
          '<label class="rc-toggle">' +
            '<input type="checkbox" class="rc-enable" ' + (disabled ? "" : "checked") + ' aria-label="Enable ' + esc(r.title) + '" />' +
            '<span class="rc-title">' + esc(r.title) + '</span>' +
          '</label>' +
          '<span class="rc-meta">' + (r.cwe ? esc(r.cwe) : "") + '</span>' +
          '<select class="rc-sev" aria-label="Severity for ' + esc(r.title) + '">' + opts + '</select>' +
        '</div>';
      });
      html += '</div>';
    });
    host.innerHTML = html;
  }

  root.PRism = root.PRism || {};
  root.PRism.ui = {
    renderReport: renderReport,
    renderRuleConfig: renderRuleConfig,
    toggleDiffFile: toggleDiffFile,
    setAllDiffFiles: setAllDiffFiles,
    setOnlyFlagged: setOnlyFlagged,
    esc: esc
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
