/*
 * PRism — unified diff parser
 * ---------------------------------------------------------------------------
 * Turns raw `git diff` / `.patch` text into a structured model the analyzer
 * can reason about. No dependencies. Attaches to the global `PRism` namespace
 * so it works from file:// without a build step or ES-module CORS issues.
 *
 * Model shape:
 *   {
 *     files: [
 *       {
 *         oldPath, newPath, path,          // resolved display path
 *         status,                          // added | deleted | renamed | modified | binary
 *         language,                        // guessed from extension
 *         isBinary, isRename,
 *         additions, deletions,            // line counts
 *         hunks: [{ header, oldStart, oldLines, newStart, newLines, lines: [...] }],
 *         addedLines:   [{ n, text }],     // convenience: content of added lines
 *         removedLines: [{ n, text }],
 *       }
 *     ],
 *     totals: { files, additions, deletions, churn }
 *   }
 */
(function (root) {
  "use strict";

  var LANG_BY_EXT = {
    js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
    ts: "TypeScript", tsx: "TypeScript",
    py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java",
    kt: "Kotlin", swift: "Swift", c: "C", h: "C", cpp: "C++", cc: "C++",
    hpp: "C++", cs: "C#", php: "PHP", scala: "Scala", dart: "Dart",
    sh: "Shell", bash: "Shell", zsh: "Shell", ps1: "PowerShell",
    html: "HTML", css: "CSS", scss: "SCSS", less: "Less", vue: "Vue",
    svelte: "Svelte", json: "JSON", yml: "YAML", yaml: "YAML",
    toml: "TOML", xml: "XML", md: "Markdown", sql: "SQL",
    tf: "Terraform", dockerfile: "Dockerfile", proto: "Protobuf",
    gradle: "Gradle", lock: "Lockfile", env: "Dotenv"
  };

  function guessLanguage(path) {
    if (!path) return "Unknown";
    var base = path.split("/").pop().toLowerCase();
    if (base === "dockerfile") return "Dockerfile";
    if (base === "makefile") return "Makefile";
    if (base.indexOf(".") === -1) return "Unknown";
    var ext = base.split(".").pop();
    return LANG_BY_EXT[ext] || "Unknown";
  }

  // Strip the a/ b/ prefixes git adds, and quotes around paths with spaces.
  function cleanPath(p) {
    if (!p) return p;
    p = p.trim();
    if (p.length > 1 && p.charAt(0) === '"' && p.charAt(p.length - 1) === '"') {
      p = p.slice(1, -1);
    }
    if (p.indexOf("a/") === 0 || p.indexOf("b/") === 0) p = p.slice(2);
    return p;
  }

  function newFile() {
    return {
      oldPath: null, newPath: null, path: null,
      status: "modified", language: "Unknown",
      isBinary: false, isRename: false, isCopy: false, isCombined: false,
      additions: 0, deletions: 0,
      hunks: [], addedLines: [], removedLines: []
    };
  }

  // Matches standard (@@ … @@) and combined (@@@ … @@@, from merge/`git show`
  // and `diff --cc`) hunk headers. The count of leading @ gives the number of
  // marker columns: 2 @ → 1 column (normal), 3 @ → 2 columns (a 2-parent
  // merge), N @ → N-1 columns. The '+' range is always the merged result.
  var HUNK_ANY_RE = /^(@{2,}) (.+?) \1/;

  function parseRange(tok) {
    var parts = tok.slice(1).split(",");
    return {
      start: parseInt(parts[0], 10) || 0,
      lines: parts[1] === undefined ? 1 : (parseInt(parts[1], 10) || 0)
    };
  }

  function parseHunk(line) {
    var m = line.match(HUNK_ANY_RE);
    if (!m) return null;
    var atRun = m[1].length;
    var groups = m[2].split(/\s+/);
    var plus = null, minuses = [];
    for (var g = 0; g < groups.length; g++) {
      var c = groups[g].charAt(0);
      if (c === "+") plus = groups[g];
      else if (c === "-") minuses.push(groups[g]);
    }
    if (!plus) return null; // not a real hunk header
    var pr = parseRange(plus);
    var om = minuses.length ? parseRange(minuses[minuses.length - 1]) : { start: 0, lines: 0 };
    return {
      header: line,
      oldStart: om.start, oldLines: om.lines,
      newStart: pr.start, newLines: pr.lines,
      markerCols: atRun - 1,
      lines: []
    };
  }

  function isHunkHeader(line) { return line.charAt(0) === "@" && HUNK_ANY_RE.test(line); }

  // Non-git unified diffs append a tab + timestamp after the path; drop it.
  function stripTimestamp(s) { var t = s.indexOf("\t"); return t === -1 ? s : s.slice(0, t); }

  function parse(raw) {
    var files = [];
    if (!raw || !raw.trim()) {
      return { files: files, totals: { files: 0, additions: 0, deletions: 0, churn: 0 } };
    }

    var lines = raw.replace(/\r\n?/g, "\n").split("\n");
    var current = null;
    var hunk = null;
    var oldLineNo = 0;
    var newLineNo = 0;

    function pushFile() {
      if (!current) return;
      // Resolve a friendly path + status.
      current.path = current.newPath && current.newPath !== "/dev/null"
        ? current.newPath
        : current.oldPath;
      if (current.oldPath === "/dev/null") current.status = "added";
      else if (current.newPath === "/dev/null") current.status = "deleted";
      else if (current.isRename) current.status = "renamed";
      else if (current.isCopy) current.status = "copied";
      else if (current.isBinary) current.status = "binary";
      current.language = guessLanguage(current.path || current.oldPath);
      files.push(current);
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Start of a new file section: `diff --git`, or a combined-diff header
      // `diff --cc <path>` / `diff --combined <path>` from a merge.
      if (line.indexOf("diff --git ") === 0) {
        pushFile();
        current = newFile();
        hunk = null;
        // diff --git a/foo b/bar  -> capture both as a hint (may be overridden).
        var m = line.match(/^diff --git (.+) (.+)$/);
        if (m) {
          current.oldPath = cleanPath(m[1]);
          current.newPath = cleanPath(m[2]);
        }
        continue;
      }
      if (line.indexOf("diff --cc ") === 0 || line.indexOf("diff --combined ") === 0) {
        pushFile();
        current = newFile();
        hunk = null;
        current.isCombined = true;
        current.newPath = cleanPath(line.slice(line.indexOf(" ", 5) + 1));
        continue;
      }

      if (!current) {
        // Support bare hunk streams or non-git diffs: start a file lazily.
        if (line.indexOf("--- ") === 0 || isHunkHeader(line)) {
          current = newFile();
          hunk = null;
        } else {
          continue;
        }
      }

      if (line.indexOf("old mode ") === 0 || line.indexOf("new mode ") === 0) continue;
      if (line.indexOf("deleted file mode") === 0) { current.status = "deleted"; continue; }
      if (line.indexOf("new file mode") === 0) { current.status = "added"; continue; }
      if (line.indexOf("rename from ") === 0) { current.isRename = true; current.oldPath = cleanPath(line.slice(12)); continue; }
      if (line.indexOf("rename to ") === 0) { current.isRename = true; current.newPath = cleanPath(line.slice(10)); continue; }
      if (line.indexOf("copy from ") === 0) { current.isCopy = true; current.oldPath = cleanPath(line.slice(10)); continue; }
      if (line.indexOf("copy to ") === 0) { current.isCopy = true; current.newPath = cleanPath(line.slice(8)); continue; }
      if (line.indexOf("similarity index") === 0 || line.indexOf("dissimilarity index") === 0) continue;
      if (line.indexOf("index ") === 0) continue;
      if (line.indexOf("Binary files") === 0 || line.indexOf("GIT binary patch") === 0) {
        current.isBinary = true;
        continue;
      }

      if (line.indexOf("--- ") === 0) {
        current.oldPath = cleanPath(stripTimestamp(line.slice(4)));
        continue;
      }
      if (line.indexOf("+++ ") === 0) {
        current.newPath = cleanPath(stripTimestamp(line.slice(4)));
        continue;
      }

      if (isHunkHeader(line)) {
        hunk = parseHunk(line);
        if (!hunk) continue;
        current.hunks.push(hunk);
        oldLineNo = hunk.oldStart;
        newLineNo = hunk.newStart;
        continue;
      }

      if (!hunk) continue; // header noise outside any hunk

      // "\ No newline at end of file" — a note, not a content line.
      if (line.charAt(0) === "\\") continue;

      // In a combined diff each parent gets its own marker column, so the
      // markers live in the first `markerCols` chars. A line counts as ADDED
      // if any column is '+' (new code entering the merge) — the conservative
      // choice for a risk radar. DELETED if any column is '-' and none is '+'.
      var cols = hunk.markerCols || 1;
      var markers = line.slice(0, cols);
      var content = line.slice(cols);
      var isAdd = markers.indexOf("+") !== -1;
      var isDel = markers.indexOf("-") !== -1;

      if (isAdd) {
        current.additions++;
        current.addedLines.push({ n: newLineNo, text: content });
        hunk.lines.push({ type: "add", text: content, newNo: newLineNo });
        newLineNo++;
      } else if (isDel) {
        current.deletions++;
        current.removedLines.push({ n: oldLineNo, text: content });
        hunk.lines.push({ type: "del", text: content, oldNo: oldLineNo });
        oldLineNo++;
      } else {
        // Context line (leading spaces) or a blank line inside a hunk.
        hunk.lines.push({ type: "ctx", text: content, oldNo: oldLineNo, newNo: newLineNo });
        oldLineNo++;
        newLineNo++;
      }
    }

    pushFile();

    var totals = { files: files.length, additions: 0, deletions: 0, churn: 0 };
    for (var f = 0; f < files.length; f++) {
      totals.additions += files[f].additions;
      totals.deletions += files[f].deletions;
    }
    totals.churn = totals.additions + totals.deletions;

    return { files: files, totals: totals };
  }

  root.PRism = root.PRism || {};
  root.PRism.parseDiff = parse;
  root.PRism.guessLanguage = guessLanguage;

  // Node/CommonJS export so the test harness can import it.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseDiff: parse, guessLanguage: guessLanguage };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
