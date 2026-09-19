/*
 * PRism — inline suppressions
 * ---------------------------------------------------------------------------
 * Every production linter needs an escape hatch: a way for a reviewer who has
 * looked at a flagged line and decided it's fine to say so, in the code, in a
 * way that travels with the diff. PRism reads eslint-style directives out of
 * comments (so they're language-safe and tokenizer-aware — a directive only
 * counts when it's genuinely in a comment, never in a string):
 *
 *   foo(bar)              // prism-ignore-line
 *   foo(bar)              // prism-ignore-line eval-exec
 *                         // prism-ignore-next-line sql-concat, raw-html
 *   (top of file)         // prism-ignore-file secret-file
 *
 * Forms accepted (case-insensitive), with `disable` as an alias for `ignore`:
 *   prism-ignore-file [rules]        → whole file
 *   prism-ignore-next-line [rules]   → the next added line
 *   prism-ignore-line [rules]        → this line   (bare `prism-ignore` too)
 *
 * With no rule ids, the directive suppresses ALL rules on its target. With
 * ids, only those. Suppressed hits are counted, not silently dropped — the
 * report shows "N suppressed" so nothing hides without a trace.
 */
(function (root) {
  "use strict";

  var DIRECTIVE = /prism-(?:ignore|disable)(-next-line|-next|-line|-file)?\b[ \t]*:?[ \t]*([a-z0-9,\s_-]*)/i;

  function parseDirective(commentText) {
    if (!commentText || commentText.indexOf("prism-") === -1) return null;
    var m = commentText.match(DIRECTIVE);
    if (!m) return null;
    var kindRaw = (m[1] || "").toLowerCase();
    var kind = kindRaw === "-file" ? "file"
      : (kindRaw === "-next" || kindRaw === "-next-line") ? "next"
      : "line";
    var rules = (m[2] || "").split(/[,\s]+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s !== "prism"; });
    return { kind: kind, rules: rules };
  }

  // Build the suppression index from parsed files + their tokenized views.
  function build(files, tokenMap) {
    var fileMap = {}; // path -> { all, rules:{}, line:{ n:{all, rules:{}} } }
    function ensure(path) {
      if (!fileMap[path]) fileMap[path] = { all: false, rules: {}, line: {} };
      return fileMap[path];
    }
    function markLine(path, n, rules) {
      var e = ensure(path);
      if (!e.line[n]) e.line[n] = { all: false, rules: {} };
      if (!rules.length) e.line[n].all = true;
      else rules.forEach(function (r) { e.line[n].rules[r] = true; });
    }

    (files || []).forEach(function (file) {
      var toks = tokenMap[file.path];
      if (!toks) return;
      for (var a = 0; a < file.addedLines.length; a++) {
        var t = toks[a];
        if (!t || !t.comment) continue;
        var d = parseDirective(t.comment);
        if (!d) continue;
        var n = file.addedLines[a].n;
        if (d.kind === "file") {
          var e = ensure(file.path);
          if (!d.rules.length) e.all = true;
          else d.rules.forEach(function (r) { e.rules[r] = true; });
        } else if (d.kind === "next") {
          markLine(file.path, n + 1, d.rules);
        } else {
          markLine(file.path, n, d.rules);
        }
      }
    });

    function isSuppressed(path, line, ruleId) {
      var e = fileMap[path];
      if (!e) return false;
      if (e.all) return true;
      if (ruleId && e.rules[ruleId]) return true;
      var ls = e.line[line];
      if (ls && (ls.all || (ruleId && ls.rules[ruleId]))) return true;
      return false;
    }

    return { isSuppressed: isSuppressed, fileMap: fileMap };
  }

  root.PRism = root.PRism || {};
  root.PRism.suppress = { build: build, parseDirective: parseDirective };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PRism.suppress;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
