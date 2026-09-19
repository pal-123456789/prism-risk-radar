/*
 * PRism — change metrics
 * ---------------------------------------------------------------------------
 * A risk score is more trustworthy next to the shape of the change. These are
 * diff-level heuristics — approximate by nature (we only see added/removed
 * lines, not the whole AST) but honest and useful:
 *
 *   - churn, files, additions, deletions
 *   - net complexity delta  (branch/loop keywords added minus removed)
 *   - max nesting depth introduced (by leading indentation of added code)
 *   - comment ratio of added lines
 *   - test-to-code file ratio
 *   - estimated review time (minutes)
 *   - language mix
 *
 * These never *set* the score on their own; the analyzer folds complexity and
 * churn into the waterfall. Here we just measure.
 */
(function (root) {
  "use strict";

  var BRANCH_KW = /\b(if|else\s+if|elif|for|foreach|while|case|when|catch|switch|&&|\|\||\?\?|=>|\?)\b|\?[^:]*:/g;
  // simpler: count common decision points
  var DECISION = /\b(if|elif|for|foreach|while|case|when|catch|switch|and|or)\b|&&|\|\||\?\./g;

  function countDecisions(text) {
    var m = text.match(DECISION);
    return m ? m.length : 0;
  }

  function leadingIndentWidth(text) {
    var m = text.match(/^[\t ]*/);
    if (!m) return 0;
    var s = m[0];
    var w = 0;
    for (var i = 0; i < s.length; i++) w += (s[i] === "\t") ? 4 : 1;
    return w;
  }

  function compute(model, tokenMap, helpers) {
    var files = model.files || [];
    var totals = model.totals || { files: 0, additions: 0, deletions: 0, churn: 0 };

    var decisionsAdded = 0, decisionsRemoved = 0;
    var commentAdded = 0, codeAdded = 0;
    var maxNestIndent = 0, baseIndent = null;
    var langChurn = {};
    var testFiles = 0, codeFiles = 0;

    for (var f = 0; f < files.length; f++) {
      var file = files[f];
      var lang = file.language || "Unknown";
      langChurn[lang] = (langChurn[lang] || 0) + file.additions + file.deletions;

      if (helpers.isTest(file.path)) testFiles++;
      else if (helpers.isCode(file.path)) codeFiles++;

      // removed decisions (from removed lines' raw text)
      for (var r = 0; r < file.removedLines.length; r++) {
        decisionsRemoved += countDecisions(file.removedLines[r].text);
      }

      // added: use tokenizer code-view so comments/strings don't inflate counts
      var toks = tokenMap[file.path];
      for (var a = 0; a < file.addedLines.length; a++) {
        var rawText = file.addedLines[a].text;
        var codeText = toks && toks[a] ? toks[a].code : rawText;
        var commentText = toks && toks[a] ? toks[a].comment : "";

        decisionsAdded += countDecisions(codeText);

        var isCommentLine = codeText.trim() === "" && commentText.trim() !== "";
        if (isCommentLine) commentAdded++;
        else if (codeText.trim() !== "") {
          codeAdded++;
          // nesting via indentation, only for code lines
          var indent = leadingIndentWidth(rawText);
          if (baseIndent === null || indent < baseIndent) baseIndent = indent;
          if (indent > maxNestIndent) maxNestIndent = indent;
        }
      }
    }

    var complexityDelta = decisionsAdded - decisionsRemoved;
    var nestDepth = baseIndent === null ? 0 : Math.max(0, Math.round((maxNestIndent - baseIndent) / 4));
    var commentRatio = (commentAdded + codeAdded) > 0
      ? commentAdded / (commentAdded + codeAdded) : 0;

    // Review-time estimate: a well-known rule of thumb is that effective review
    // slows past ~200-400 LOC. We model ~ churn/8 minutes, with a floor, plus a
    // surcharge for many files (context switching) and high complexity.
    var churn = totals.churn || 0;
    var minutes = Math.max(2, Math.round(
      churn / 8 +
      (totals.files || 0) * 1.5 +
      Math.max(0, complexityDelta) * 0.6
    ));

    var langs = Object.keys(langChurn).map(function (k) {
      return { language: k, churn: langChurn[k] };
    }).sort(function (a, b) { return b.churn - a.churn; });

    return {
      files: totals.files,
      additions: totals.additions,
      deletions: totals.deletions,
      churn: churn,
      complexityDelta: complexityDelta,
      decisionsAdded: decisionsAdded,
      decisionsRemoved: decisionsRemoved,
      maxNestingAdded: nestDepth,
      commentRatio: Math.round(commentRatio * 100) / 100,
      commentLines: commentAdded,
      codeLines: codeAdded,
      testFiles: testFiles,
      codeFiles: codeFiles,
      reviewMinutes: minutes,
      languages: langs
    };
  }

  root.PRism = root.PRism || {};
  root.PRism.metrics = { compute: compute, countDecisions: countDecisions };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PRism.metrics;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
