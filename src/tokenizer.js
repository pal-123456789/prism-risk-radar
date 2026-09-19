/*
 * PRism — line tokenizer / region masker
 * ---------------------------------------------------------------------------
 * The difference between a real analyzer and a regex toy: knowing whether a
 * match is in CODE, a STRING, or a COMMENT. `eval(` in a comment is not a
 * vulnerability; an API key in a string literal is exactly the thing to catch.
 *
 * This is a *pragmatic* single-line lexer, not a full parser. It classifies
 * each added line into three parallel views so rules can target precisely:
 *
 *   classify(line, language) -> {
 *     raw,      // the original text
 *     code,     // string + comment spans replaced with spaces (same length)
 *     strings,  // concatenation of just the string-literal contents
 *     comment,  // just the comment text (line + block-on-this-line)
 *     inString  // whether the line ENDS inside an unterminated string
 *   }
 *
 * Because a diff hands us added lines out of context, we can't perfectly track
 * multi-line strings/comments across hunks — but we track block-comment state
 * across consecutive added lines within a file (carry), which covers the
 * common /* ... *​/ and """ ... """ cases. Precision over perfection: when
 * unsure we bias toward treating text as CODE so security rules still fire.
 */
(function (root) {
  "use strict";

  // Per-language comment + string syntax. Kept small on purpose.
  var LANG = {
    c_like: {
      line: ["//"], block: [["/*", "*/"]],
      quotes: ["\"", "'", "`"], // ` = JS template literal
      raw: []
    },
    python: {
      line: ["#"], block: [["\"\"\"", "\"\"\""], ["'''", "'''"]],
      quotes: ["\"", "'"], raw: []
    },
    ruby: {
      line: ["#"], block: [["=begin", "=end"]],
      quotes: ["\"", "'"], raw: []
    },
    shell: {
      line: ["#"], block: [],
      quotes: ["\"", "'"], raw: []
    },
    hashonly: {
      line: ["#"], block: [],
      quotes: ["\"", "'"], raw: []
    },
    html: {
      line: [], block: [["<!--", "-->"]],
      quotes: ["\"", "'"], raw: []
    },
    php: { // PHP allows // and # line comments plus /* */
      line: ["//", "#"], block: [["/*", "*/"]],
      quotes: ["\"", "'"], raw: []
    },
    prose: { // Markdown/plain text: no comment or string syntax to mask
      line: [], block: [], quotes: [], raw: []
    },
    generic: {
      line: ["//", "#"], block: [["/*", "*/"]],
      quotes: ["\"", "'", "`"], raw: []
    }
  };

  var EXT_LANG = {
    JavaScript: "c_like", TypeScript: "c_like", Java: "c_like", "C": "c_like",
    "C++": "c_like", "C#": "c_like", Go: "c_like", Rust: "c_like", Swift: "c_like",
    Kotlin: "c_like", Scala: "c_like", Dart: "c_like", PHP: "c_like", Vue: "c_like",
    Svelte: "c_like",
    Python: "python", Ruby: "ruby", PHP: "php",
    Shell: "shell", PowerShell: "hashonly",
    YAML: "hashonly", TOML: "hashonly", Dockerfile: "hashonly", Makefile: "hashonly",
    Dotenv: "hashonly", Terraform: "c_like", Gradle: "c_like", Protobuf: "c_like",
    HTML: "html", XML: "html",
    CSS: "c_like", SCSS: "c_like", Less: "c_like",
    SQL: "c_like", // -- handled specially below
    Markdown: "prose",
    JSON: "json"
  };

  function syntaxFor(language) {
    var key = EXT_LANG[language];
    if (key === "json") return { line: [], block: [], quotes: ["\""], raw: [] };
    return LANG[key] || LANG.generic;
  }

  // SQL uses -- for line comments; fold that in when relevant.
  function lineCommentTokens(language, syn) {
    if (language === "SQL") return ["--"].concat(syn.line);
    return syn.line;
  }

  var SPACE = " ";
  function pad(n) { return new Array(n + 1).join(SPACE); }

  /*
   * Classify a single line. `carry` is { inBlock, blockEnd } describing whether
   * we started this line inside a block comment (and what closes it).
   * Returns the classification plus the updated carry for the next line.
   */
  function classifyLine(line, language, carry) {
    var syn = syntaxFor(language);
    var lineTokens = lineCommentTokens(language, syn);
    var codeArr = line.split("");
    var strings = [];
    var comments = [];
    var i = 0;
    var n = line.length;
    var inBlock = carry && carry.inBlock;
    var blockEnd = carry && carry.blockEnd;
    var endInString = false;

    function blank(from, to) { for (var k = from; k < to && k < n; k++) codeArr[k] = SPACE; }

    // If we begin inside a block comment, consume until its terminator.
    if (inBlock) {
      var endIdx = line.indexOf(blockEnd);
      if (endIdx === -1) {
        comments.push(line);
        blank(0, n);
        return { cls: view(line, codeArr, strings, comments, false),
                 carry: { inBlock: true, blockEnd: blockEnd } };
      }
      comments.push(line.slice(0, endIdx));
      blank(0, endIdx + blockEnd.length);
      i = endIdx + blockEnd.length;
      inBlock = false; blockEnd = null;
    }

    while (i < n) {
      var ch = line[i];
      var two = line.substr(i, 2);

      // line comment?
      var matchedLine = null;
      for (var li = 0; li < lineTokens.length; li++) {
        if (line.substr(i, lineTokens[li].length) === lineTokens[li]) { matchedLine = lineTokens[li]; break; }
      }
      if (matchedLine) {
        comments.push(line.slice(i));
        blank(i, n);
        i = n;
        break;
      }

      // block comment start?
      var matchedBlock = null;
      for (var bi = 0; bi < syn.block.length; bi++) {
        var open = syn.block[bi][0];
        if (line.substr(i, open.length) === open) { matchedBlock = syn.block[bi]; break; }
      }
      if (matchedBlock) {
        var close = matchedBlock[1];
        var ci = line.indexOf(close, i + matchedBlock[0].length);
        if (ci === -1) {
          comments.push(line.slice(i + matchedBlock[0].length));
          blank(i, n);
          return { cls: view(line, codeArr, strings, comments, false),
                   carry: { inBlock: true, blockEnd: close } };
        }
        comments.push(line.slice(i + matchedBlock[0].length, ci));
        blank(i, ci + close.length);
        i = ci + close.length;
        continue;
      }

      // string literal?
      if (syn.quotes.indexOf(ch) !== -1) {
        var quote = ch;
        var j = i + 1;
        var buf = "";
        var closed = false;
        while (j < n) {
          var cj = line[j];
          if (cj === "\\") { buf += line.substr(j, 2); j += 2; continue; }
          if (cj === quote) { closed = true; break; }
          buf += cj;
          j++;
        }
        strings.push(buf);
        // blank out the whole literal including quotes in the code view
        blank(i, closed ? j + 1 : n);
        if (!closed) {
          // unterminated on this line (unless a template literal we can't track)
          endInString = true;
          i = n;
          break;
        }
        i = j + 1;
        continue;
      }

      i++;
    }

    return { cls: view(line, codeArr, strings, comments, endInString),
             carry: { inBlock: inBlock, blockEnd: blockEnd } };
  }

  function view(raw, codeArr, strings, comments, endInString) {
    return {
      raw: raw,
      code: codeArr.join(""),
      strings: strings.join(""), // separator that won't appear in source
      stringList: strings,
      comment: comments.join(" "),
      inString: !!endInString
    };
  }

  /*
   * Classify all added lines of a parsed file, carrying block-comment state.
   * Attaches `.tokens` (array of classifications aligned to file.addedLines).
   */
  function classifyFile(file) {
    var carry = { inBlock: false, blockEnd: null };
    var out = [];
    for (var i = 0; i < file.addedLines.length; i++) {
      var res = classifyLine(file.addedLines[i].text, file.language, carry);
      out.push(res.cls);
      carry = res.carry;
    }
    return out;
  }

  root.PRism = root.PRism || {};
  root.PRism.tokenizer = {
    classifyLine: classifyLine,
    classifyFile: classifyFile,
    syntaxFor: syntaxFor
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PRism.tokenizer;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
