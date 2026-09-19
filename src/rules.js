/*
 * PRism — risk rule set (CWE/OWASP-tagged, tokenizer-aware)
 * ---------------------------------------------------------------------------
 * A rule is an explainable heuristic. Each carries a severity, a confidence,
 * a CWE id, an OWASP category where relevant, a plain-language *why*, and a
 * concrete *fix*. A score no one understands is a score no one trusts.
 *
 * Every LINE rule declares a `target` telling the analyzer which tokenizer
 * view to test — this is what stops "eval( in a comment" from firing:
 *   "code"    → string/comment spans blanked out (default; real logic)
 *   "string"  → only string-literal contents (secrets, SQL text)
 *   "comment" → only comment text (TODOs)
 *   "raw"     → the untouched line (whitespace/unicode/markers)
 *
 * FILE rules inspect file-level facts (deletions, renames, churn, paths).
 * The entropy secret detector and the "logic without tests" aggregate are
 * driven by the analyzer directly (see analyzer.js) but declared here so they
 * appear in the rule catalog and honor user config.
 *
 * Severity point weights (per hit, before caps & confidence):
 *   info 0 · low 4 · medium 10 · high 22 · critical 40
 */
(function (root) {
  "use strict";

  var SEVERITY = { info: 0, low: 4, medium: 10, high: 22, critical: 40 };
  var SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];

  // ---- path helpers (shared) ------------------------------------------------
  function isTest(path) {
    if (!path) return false;
    return /(^|\/)(tests?|__tests__|spec|specs)(\/|$)/i.test(path) ||
      /\.(test|spec)\.[a-z]+$/i.test(path) ||
      /_test\.[a-z]+$/i.test(path) ||
      /(^|\/)test_[^/]+\.py$/i.test(path);
  }
  function isCode(path) {
    return /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cc|hpp|cs|php|scala|dart|vue|svelte)$/i.test(path || "");
  }
  function isDependencyManifest(path) {
    var b = (path || "").split("/").pop().toLowerCase();
    return [
      "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
      "requirements.txt", "pipfile", "pipfile.lock", "poetry.lock", "pyproject.toml",
      "gemfile", "gemfile.lock", "go.mod", "go.sum", "cargo.toml", "cargo.lock",
      "composer.json", "composer.lock", "pom.xml", "build.gradle", "gradle.lockfile"
    ].indexOf(b) !== -1;
  }
  function isInfra(path) {
    if (!path) return false;
    var b = path.split("/").pop().toLowerCase();
    return /(^|\/)\.github\/workflows\//i.test(path) ||
      /\.(tf|tfvars)$/i.test(path) ||
      /(dockerfile|docker-compose\.ya?ml|\.gitlab-ci\.yml|jenkinsfile|\.circleci\/config\.yml|k8s|kubernetes|helm)/i.test(path) ||
      b === "dockerfile";
  }
  function isMigration(path) {
    return /(^|\/)migrations?\//i.test(path || "") ||
      /(migration|schema)\.(sql|py|rb|js|ts)$/i.test(path || "") ||
      /\.sql$/i.test(path || "");
  }
  function isSecretFile(path) {
    var b = (path || "").split("/").pop().toLowerCase();
    return /^\.env($|\.)/.test(b) ||
      /(^|\/)\.env($|\.)/.test(path || "") ||
      /(credentials|secrets?|id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i.test(b) ||
      /\.(pem|pfx|p12|keystore|jks)$/i.test(b);
  }
  function isLockfile(path) {
    var b = (path || "").split("/").pop().toLowerCase();
    return /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|gemfile\.lock|cargo\.lock|composer\.lock|go\.sum)$/.test(b);
  }
  var jsLike = function (p) { return /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|html)$/i.test(p || ""); };

  // ---- line rules -----------------------------------------------------------
  // { id, title, category, severity, confidence, cwe, owasp, target, re, cap, files?, why, fix }
  var LINE_RULES = [
    // ----- Correctness that must never ship -----
    {
      id: "conflict-markers", title: "Merge conflict markers committed",
      category: "Correctness", severity: "critical", confidence: 0.99,
      cwe: "CWE-1164", target: "raw", cap: 20,
      re: /^(<{7}|>{7})(\s|$)|^={7}$/,
      why: "Unresolved merge-conflict markers won't compile or run — this code was never actually merged.",
      fix: "Resolve the conflict and delete the <<<<<<< ======= >>>>>>> markers."
    },

    // ----- Secrets (keyworded; entropy detector complements these) -----
    {
      id: "private-key", title: "Private key material added",
      category: "Secrets", severity: "critical", confidence: 0.98,
      cwe: "CWE-798", owasp: "A07:2021", target: "raw", cap: 5,
      re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
      why: "A private key in source control is compromised the moment it is pushed.",
      fix: "Remove the key, rotate it immediately, and load it from a secret store or env var."
    },
    {
      id: "aws-key", title: "AWS access key ID added",
      category: "Secrets", severity: "critical", confidence: 0.95,
      cwe: "CWE-798", owasp: "A07:2021", target: "raw", cap: 5,
      re: /\bAKIA[0-9A-Z]{16}\b/,
      why: "Hard-coded cloud credentials get scraped from repos within minutes and used to run up real bills.",
      fix: "Revoke the key in IAM, rotate it, and move it to environment configuration."
    },
    {
      id: "provider-token", title: "Provider secret / token added",
      category: "Secrets", severity: "critical", confidence: 0.95,
      cwe: "CWE-798", owasp: "A07:2021", target: "raw", cap: 8,
      re: /\b(?:gh[pousr]_[0-9A-Za-z]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|sk_live_[0-9A-Za-z]{16,}|AIza[0-9A-Za-z_\-]{35}|glpat-[0-9A-Za-z_\-]{20})\b/,
      why: "This matches a live token format (GitHub, Slack, Stripe, Google, GitLab). Treat it as leaked.",
      fix: "Revoke the token with the provider and issue a new one stored outside the repo."
    },
    {
      id: "jwt", title: "Hard-coded JWT",
      category: "Secrets", severity: "high", confidence: 0.7,
      cwe: "CWE-798", owasp: "A07:2021", target: "raw", cap: 5,
      re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}\b/,
      why: "A committed JWT often carries a real session or signing context and can be replayed.",
      fix: "Remove the token; if it's a real credential, revoke the session and rotate the signing key."
    },
    {
      id: "generic-secret", title: "Hard-coded credential assignment",
      category: "Secrets", severity: "high", confidence: 0.75,
      cwe: "CWE-798", owasp: "A07:2021", target: "raw", cap: 8,
      re: /(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|pwd)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
      why: "Secrets belong in environment variables or a vault, not in code. Anyone with repo access now has this.",
      fix: "Replace the literal with a reference to config/secret storage and rotate the exposed value."
    },
    {
      id: "basic-auth-url", title: "Credentials embedded in URL",
      category: "Secrets", severity: "high", confidence: 0.8,
      cwe: "CWE-798", owasp: "A07:2021", target: "string", cap: 6,
      re: /\b[a-z][a-z0-9+.\-]*:\/\/[^\/\s:@]+:[^\/\s:@]+@/i,
      why: "A user:password@host URL leaks the credential into logs, history, and referrers.",
      fix: "Move the username/password out of the URL into headers or a credential store."
    },

    // ----- Injection -----
    {
      id: "eval-exec", title: "Dynamic code execution",
      category: "Injection", severity: "high", confidence: 0.7,
      cwe: "CWE-95", owasp: "A03:2021", target: "code", cap: 10, files: isCode,
      re: /(?:^|[^.\w])(?:eval|exec)\s*\(|new\s+Function\s*\(/,
      why: "eval/exec runs arbitrary strings as code. If any part comes from input, this is remote code execution.",
      fix: "Remove dynamic execution; use a parser, a lookup table, or JSON.parse for data."
    },
    {
      id: "shell-injection", title: "Shell command from untrusted input",
      category: "Injection", severity: "high", confidence: 0.8,
      cwe: "CWE-78", owasp: "A03:2021", target: "code", cap: 10,
      re: /os\.system\s*\(|subprocess\.(?:call|run|Popen)\([^)]*shell\s*=\s*True|child_process\.exec\s*\(|Runtime\.getRuntime\(\)\.exec/,
      why: "Building shell commands from variables invites command injection.",
      fix: "Use an argument array (execFile/spawn, subprocess without shell=True) and never interpolate input."
    },
    {
      id: "sql-concat", title: "SQL built by string concatenation",
      category: "Injection", severity: "high", confidence: 0.75,
      cwe: "CWE-89", owasp: "A03:2021", target: "raw", cap: 10,
      re: /(?:SELECT|INSERT|UPDATE|DELETE)\b[^;\n]*(?:["'`]\s*(?:\+|\.|%|\$\{)|f["'].*\{)/i,
      why: "Concatenating values into SQL enables injection — the classic database breach.",
      fix: "Use parameterized queries / bound placeholders; never build SQL by string."
    },
    {
      id: "nosql-where", title: "NoSQL $where / JS expression query",
      category: "Injection", severity: "high", confidence: 0.6,
      cwe: "CWE-943", owasp: "A03:2021", target: "code", cap: 6,
      re: /\$where\s*:|\bmapReduce\s*\(|\$function\s*:/,
      why: "A $where or JS-expression query runs on the DB engine and is injectable from input.",
      fix: "Replace with structured query operators; validate and type-check inputs."
    },
    {
      id: "template-injection", title: "Server-side template from input",
      category: "Injection", severity: "high", confidence: 0.55,
      cwe: "CWE-1336", owasp: "A03:2021", target: "code", cap: 6,
      re: /render_template_string\s*\(|Template\s*\(\s*[a-zA-Z_]|new\s+Template\s*\(\s*req\./,
      why: "Rendering a template built from input allows server-side template injection (SSTI).",
      fix: "Render static templates and pass data as context, never build the template from input."
    },
    {
      id: "prototype-pollution", title: "Prototype pollution sink",
      category: "Injection", severity: "high", confidence: 0.5,
      cwe: "CWE-1321", owasp: "A03:2021", target: "code", cap: 6, files: jsLike,
      re: /\.__proto__\b|(?:^|[^"'\w])__proto__\s*:|\bconstructor\s*\.\s*prototype\b|\bObject\.prototype\s*\[/,
      why: "Writing through __proto__ or constructor.prototype can poison every object in the runtime — a prototype-pollution attack.",
      fix: "Reject __proto__/constructor keys when merging input; use Map, Object.create(null), or a vetted deep-merge that guards these keys."
    },

    // ----- XSS / client -----
    {
      id: "raw-html", title: "Unescaped HTML injection",
      category: "XSS", severity: "high", confidence: 0.65,
      cwe: "CWE-79", owasp: "A03:2021", target: "code", cap: 12, files: jsLike,
      re: /\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|insertAdjacentHTML\s*\(|v-html\s*=/,
      why: "Writing raw HTML from data is the classic XSS vector.",
      fix: "Use textContent / safe binding, or sanitize with a vetted library (DOMPurify) before insertion."
    },
    {
      id: "js-scheme", title: "javascript: URL sink",
      category: "XSS", severity: "medium", confidence: 0.5,
      cwe: "CWE-79", owasp: "A03:2021", target: "string", cap: 6, files: jsLike,
      re: /javascript:\s*[^"'\s]/i,
      why: "A javascript: URL executes code when followed — a common XSS payload.",
      fix: "Allow only http/https/mailto schemes; reject javascript: and data: for links."
    },
    {
      id: "open-redirect", title: "Redirect to a user-supplied URL",
      category: "XSS", severity: "medium", confidence: 0.45,
      cwe: "CWE-601", owasp: "A01:2021", target: "code", cap: 6,
      re: /(?:res\.redirect|response\.redirect|redirect|sendRedirect|window\.location(?:\.href)?\s*=|location\.replace\s*\()\s*\(?[^)\n]*(?:req\.|request\.|params|query|input|getParameter)/,
      why: "Redirecting to an input-derived URL enables open-redirect phishing — your domain sends users to an attacker's.",
      fix: "Redirect only to allow-listed paths, or validate the target is same-origin before redirecting."
    },

    // ----- Crypto & transport -----
    {
      id: "tls-off", title: "TLS / certificate verification disabled",
      category: "Crypto", severity: "high", confidence: 0.9,
      cwe: "CWE-295", owasp: "A02:2021", target: "code", cap: 8,
      re: /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:0|false)|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/i,
      why: "Turning off certificate checks defeats HTTPS and exposes traffic to man-in-the-middle attacks.",
      fix: "Re-enable verification; if a cert is self-signed, add it to the trust store instead."
    },
    {
      id: "weak-crypto", title: "Weak hashing / cipher",
      category: "Crypto", severity: "medium", confidence: 0.7,
      cwe: "CWE-327", owasp: "A02:2021", target: "code", cap: 8,
      re: /\b(?:md5|sha1)\s*\(|hashlib\.(?:md5|sha1)\s*\(|\bDES\b|\bRC4\b|createHash\(\s*["'](?:md5|sha1)["']/,
      why: "MD5/SHA-1/DES/RC4 are broken for security use.",
      fix: "Use SHA-256+ for integrity, and bcrypt/scrypt/argon2 for passwords, AES-GCM for encryption."
    },
    {
      id: "insecure-random", title: "Insecure randomness for security value",
      category: "Crypto", severity: "medium", confidence: 0.4,
      cwe: "CWE-338", owasp: "A02:2021", target: "code", cap: 6,
      re: /Math\.random\s*\(\)|random\.randint\s*\(|new\s+Random\s*\(/,
      why: "Math.random and friends are not cryptographically secure — unsafe for tokens, IDs, or keys.",
      fix: "Use a CSPRNG: crypto.randomBytes, secrets (Python), or java.security.SecureRandom."
    },
    {
      id: "ecb-mode", title: "ECB cipher mode",
      category: "Crypto", severity: "medium", confidence: 0.7,
      cwe: "CWE-327", owasp: "A02:2021", target: "code", cap: 4,
      re: /AES\/ECB|MODE_ECB|["']aes-\d+-ecb["']/i,
      why: "ECB mode leaks plaintext patterns — identical blocks encrypt identically.",
      fix: "Use an authenticated mode like AES-GCM with a unique nonce per message."
    },

    // ----- Deserialization / SSRF / traversal -----
    {
      id: "insecure-deserialize", title: "Unsafe deserialization",
      category: "Deserialization", severity: "high", confidence: 0.8,
      cwe: "CWE-502", owasp: "A08:2021", target: "code", cap: 6,
      re: /pickle\.loads?\s*\(|yaml\.load\s*\((?![^)]*Loader)|Marshal\.load|ObjectInputStream|cPickle\.loads?\s*\(/,
      why: "Deserializing untrusted data can execute arbitrary objects.",
      fix: "Use safe loaders (yaml.safe_load, JSON) and never deserialize attacker-controlled bytes."
    },
    {
      id: "path-traversal", title: "Possible path traversal",
      category: "Path", severity: "medium", confidence: 0.4,
      cwe: "CWE-22", owasp: "A01:2021", target: "code", cap: 6,
      re: /(?:open|readFile|readFileSync|sendFile|createReadStream)\s*\([^)]*(?:req\.|request\.|params|query|input|argv)/,
      why: "Building a file path from input can let an attacker read ../ outside the intended directory.",
      fix: "Resolve and validate the path against an allow-listed base directory before use."
    },
    {
      id: "ssrf", title: "Request to a user-supplied URL",
      category: "SSRF", severity: "medium", confidence: 0.4,
      cwe: "CWE-918", owasp: "A10:2021", target: "code", cap: 6,
      re: /(?:requests\.get|axios\.get|fetch|urlopen|http\.get)\s*\([^)]*(?:req\.|request\.|params|query|input)/,
      why: "Fetching a URL from input enables SSRF — reaching internal services or cloud metadata.",
      fix: "Validate the host against an allow-list and block private/link-local ranges."
    },

    // ----- Config / security posture -----
    {
      id: "debug-flag", title: "Debug mode enabled",
      category: "Config", severity: "medium", confidence: 0.7,
      cwe: "CWE-489", owasp: "A05:2021", target: "code", cap: 6,
      re: /DEBUG\s*=\s*True|app\.run\([^)]*debug\s*=\s*True|NODE_ENV\s*[:=]\s*["']?development|FLASK_DEBUG\s*=\s*1/,
      why: "Debug mode can leak stack traces and internals — and interactive debuggers are RCE in prod.",
      fix: "Drive debug from environment config and ensure production runs with it off."
    },
    {
      id: "cors-wildcard", title: "Wide-open CORS",
      category: "Config", severity: "medium", confidence: 0.7,
      cwe: "CWE-942", owasp: "A05:2021", target: "raw", cap: 6,
      re: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*|cors\([^)]*origin\s*:\s*["']\*|"?\*"?\s*}\s*\)?\s*;?\s*\/\/\s*cors/i,
      why: "A wildcard origin lets any site call this API with the user's credentials.",
      fix: "Reflect only an allow-listed set of origins; never combine * with credentials."
    },
    {
      id: "bind-all", title: "Service bound to 0.0.0.0",
      category: "Config", severity: "low", confidence: 0.4,
      cwe: "CWE-668", owasp: "A05:2021", target: "raw", cap: 4,
      re: /0\.0\.0\.0|::\/0|host\s*=\s*["']0\.0\.0\.0["']/,
      why: "Binding to all interfaces / 0.0.0.0/0 can expose a service more widely than intended.",
      fix: "Bind to localhost or a specific interface, and scope security-group / firewall rules."
    },
    {
      id: "insecure-cookie", title: "Cookie without Secure/HttpOnly",
      category: "Config", severity: "low", confidence: 0.4,
      cwe: "CWE-614", owasp: "A05:2021", target: "code", cap: 6,
      re: /set_cookie\s*\(|res\.cookie\s*\(|new\s+Cookie\s*\(/,
      why: "Session cookies need Secure and HttpOnly, or they can leak over HTTP or to scripts.",
      fix: "Set Secure, HttpOnly, and an appropriate SameSite attribute on session cookies."
    },
    {
      id: "hardcoded-ip", title: "Hard-coded public IP address",
      category: "Config", severity: "low", confidence: 0.35,
      cwe: "CWE-547", target: "raw", cap: 5, files: isCode,
      re: /(?:^|[^.\d])(?!(?:10|127|192\.168|169\.254)\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?!0\.)(?:[1-9]\d{0,2})\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![.\d])/,
      why: "A hard-coded public IP is brittle and often a leftover from local testing — it breaks across environments and can pin traffic to the wrong host.",
      fix: "Move the address to configuration / DNS; don't bake environment endpoints into code."
    },

    // ----- Unicode / trojan source (the one most tools miss) -----
    {
      id: "bidi-unicode", title: "Invisible bidirectional Unicode (trojan source)",
      category: "Unicode", severity: "critical", confidence: 0.9,
      cwe: "CWE-1007", target: "raw", cap: 6,
      re: /[‪-‮⁦-⁩‎‏]/,
      why: "Bidi control characters can reorder how code reads to a human vs. the compiler — a trojan-source attack that hides logic in plain sight.",
      fix: "Remove the bidirectional control characters; if RTL text is genuinely needed, isolate it in data, not code."
    },
    {
      id: "zero-width", title: "Zero-width / invisible characters",
      category: "Unicode", severity: "medium", confidence: 0.6,
      cwe: "CWE-1007", target: "raw", cap: 6,
      re: /[​-‍﻿⁠]/,
      why: "Zero-width characters are invisible but change identifiers and strings — a source of subtle, hard-to-spot bugs and homoglyph tricks.",
      fix: "Strip zero-width characters; verify identifiers are the ASCII you expect."
    },

    // ----- Testing -----
    {
      id: "focused-test", title: "Focused or skipped test",
      category: "Testing", severity: "medium", confidence: 0.85,
      cwe: "CWE-1164", target: "code", cap: 15,
      re: /\b(?:describe|it|test)\.only\s*\(|\bf(?:describe|it)\s*\(|\bx(?:describe|it)\s*\(|\.skip\s*\(|@pytest\.mark\.skip|@unittest\.skip/,
      why: "A .only silently drops the rest of the suite; a .skip quietly disables coverage. Both hide failures.",
      fix: "Remove .only / .skip before merging so the full suite runs in CI."
    },
    {
      id: "test-no-assert", title: "Test with no assertion",
      category: "Testing", severity: "low", confidence: 0.3,
      cwe: "CWE-1164", target: "code", cap: 8,
      files: isTest,
      re: /\b(?:it|test)\s*\(\s*["'][^"']*["']\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/,
      why: "An empty test always passes and proves nothing.",
      fix: "Add an assertion, or remove the placeholder test."
    },

    // ----- Correctness / cleanliness -----
    {
      id: "broad-except", title: "Overly broad error handling",
      category: "Correctness", severity: "low", confidence: 0.5,
      cwe: "CWE-396", target: "code", cap: 15,
      re: /except\s*:|except\s+Exception\s*:|catch\s*\(\s*(?:\)|e\s*\)\s*\{\s*\})|catch\s*\{\s*\}|rescue\s*=>\s*\w+\s*$/,
      why: "Swallowing every error hides real failures and makes bugs invisible.",
      fix: "Catch specific exceptions and handle or re-raise the rest; at minimum, log it."
    },
    {
      id: "debug-print", title: "Debug output left in code",
      category: "Cleanliness", severity: "low", confidence: 0.6,
      cwe: "CWE-489", target: "code", cap: 30, files: isCode,
      re: /(?:^|[^.\w])(?:console\.(?:log|debug|dir)|debugger|System\.out\.print(?:ln)?|var_dump|print_r|binding\.pry|byebug|fmt\.Println)\s*[\(;]/,
      why: "Leftover debug output clutters logs and can leak data.",
      fix: "Remove it, or route through the project's real logger at an appropriate level."
    },
    {
      id: "stacktrace-print", title: "Stack trace printed to output",
      category: "Cleanliness", severity: "low", confidence: 0.55,
      cwe: "CWE-209", target: "code", cap: 10, files: isCode,
      re: /\.printStackTrace\s*\(|traceback\.print_exc\s*\(|console\.trace\s*\(|e\.printStackTrace/,
      why: "Printing a raw stack trace leaks internal paths and class names to logs or users, and usually means an error is being shown, not handled.",
      fix: "Log through the real logger at error level and return a safe message; don't dump traces to stdout."
    },
    {
      id: "todo", title: "TODO / FIXME left in the change",
      category: "Cleanliness", severity: "low", confidence: 0.7,
      cwe: "CWE-546", target: "comment", cap: 30,
      re: /\b(?:TODO|FIXME|HACK|XXX|WIP)\b/i,
      why: "An unfinished marker in a submitted change is a promise of work not yet done.",
      fix: "Finish it, or file a tracked issue and reference it."
    },
    {
      id: "long-line", title: "Very long / possibly minified line",
      category: "Cleanliness", severity: "info", confidence: 0.5,
      cwe: "CWE-1121", target: "raw", cap: 5,
      re: /^.{500,}$/,
      why: "A 500+ character line is usually minified or generated content that shouldn't be hand-edited in a PR.",
      fix: "Commit generated artifacts separately, or keep source lines readable."
    }
  ];

  // ---- file rules -----------------------------------------------------------
  var FILE_RULES = [
    {
      id: "test-deleted", title: "Test file deleted", category: "Testing",
      severity: "high", confidence: 0.8, cwe: "CWE-1164", cap: 10,
      why: "Removing tests lowers the safety net. Confirm the covered behavior is gone too, not just its test.",
      fix: "Keep tests for behavior that still exists; if the feature is removed, say so in the PR.",
      run: function (file) {
        return (file.status === "deleted" && isTest(file.path)) ? [{ line: 0, snippet: file.path }] : [];
      }
    },
    {
      id: "secret-file", title: "Secret / key file committed", category: "Secrets",
      severity: "critical", confidence: 0.9, cwe: "CWE-798", owasp: "A07:2021", cap: 5,
      why: "Files like .env, *.pem or credentials should never be committed.",
      fix: "Remove it, add it to .gitignore, and rotate anything it contained.",
      run: function (file) {
        return (file.status !== "deleted" && isSecretFile(file.path)) ? [{ line: 0, snippet: file.path }] : [];
      }
    },
    {
      id: "dep-change", title: "Dependency manifest changed", category: "Supply chain",
      severity: "medium", confidence: 0.6, cwe: "CWE-1104", owasp: "A06:2021", cap: 6,
      why: "New or bumped dependencies expand the attack surface.",
      fix: "Review the changelog and lockfile diff; confirm the package name isn't a typosquat.",
      run: function (file) {
        return (file.status !== "deleted" && isDependencyManifest(file.path) && !isLockfile(file.path))
          ? [{ line: 0, snippet: file.path }] : [];
      }
    },
    {
      id: "migration", title: "Database migration / schema change", category: "Data",
      severity: "medium", confidence: 0.6, cwe: "CWE-1188", cap: 6,
      why: "Schema changes are hard to roll back and can lock tables.",
      fix: "Verify the migration is reversible and safe to run online under load.",
      run: function (file) {
        return (file.status !== "deleted" && isMigration(file.path)) ? [{ line: 0, snippet: file.path }] : [];
      }
    },
    {
      id: "infra-change", title: "Infrastructure / CI change", category: "Ops",
      severity: "medium", confidence: 0.6, cwe: "CWE-1188", owasp: "A05:2021", cap: 6,
      why: "CI, container and IaC edits change how everything builds and deploys — a typo here breaks the pipeline.",
      fix: "Dry-run the change and confirm secrets/permissions aren't widened.",
      run: function (file) {
        return (file.status !== "deleted" && isInfra(file.path)) ? [{ line: 0, snippet: file.path }] : [];
      }
    },
    {
      id: "large-file-churn", title: "Large single-file change", category: "Reviewability",
      severity: "medium", confidence: 0.7, cwe: "CWE-1121", cap: 8,
      why: "A file with heavy churn is hard to review well.",
      fix: "Split into smaller, focused commits or PRs where possible.",
      run: function (file) {
        var churn = file.additions + file.deletions;
        return churn >= 400 ? [{ line: 0, snippet: file.path + " (" + churn + " lines)" }] : [];
      }
    },
    {
      id: "binary-added", title: "Binary file added", category: "Reviewability",
      severity: "low", confidence: 0.6, cwe: "CWE-1121", cap: 10,
      why: "Binaries can't be reviewed line by line and bloat the repo.",
      fix: "Confirm it belongs in the repo, not in asset storage or LFS.",
      run: function (file) {
        return (file.isBinary && file.status !== "deleted") ? [{ line: 0, snippet: file.path }] : [];
      }
    },
    {
      id: "lockfile-only-note", title: "Lockfile updated", category: "Supply chain",
      severity: "info", confidence: 0.5, cwe: "CWE-1104", cap: 4,
      why: "Lockfile changes pin new transitive dependencies; usually fine but worth a glance.",
      fix: "Skim for unexpected new packages or registry changes.",
      run: function (file) {
        return (file.status !== "deleted" && isLockfile(file.path)) ? [{ line: 0, snippet: file.path }] : [];
      }
    },
    // declared for the catalog/config; driven by the analyzer:
    {
      id: "logic-without-tests", title: "Code changed without matching tests", category: "Testing",
      severity: "medium", confidence: 0.6, cwe: "CWE-1164", cap: 1, aggregate: true,
      why: "Substantial logic changed but no test file was touched. New behavior without a test can silently break.",
      fix: "Add or update a test that exercises the changed behavior.",
      run: null
    },
    {
      id: "entropy-secret", title: "High-entropy string (possible secret)", category: "Secrets",
      severity: "high", confidence: 0.6, cwe: "CWE-798", owasp: "A07:2021", cap: 8, entropy: true,
      why: "A long, random-looking token was added in a string literal — the signature of a leaked credential.",
      fix: "If it's a secret, remove and rotate it; store it in env/secret config.",
      run: null
    }
  ];

  // Build a quick lookup for config / catalog.
  var ALL = {};
  LINE_RULES.concat(FILE_RULES).forEach(function (r) { ALL[r.id] = r; });

  root.PRism = root.PRism || {};
  root.PRism.rules = {
    SEVERITY: SEVERITY,
    SEVERITY_ORDER: SEVERITY_ORDER,
    LINE_RULES: LINE_RULES,
    FILE_RULES: FILE_RULES,
    byId: ALL,
    catalog: function () {
      return LINE_RULES.concat(FILE_RULES).map(function (r) {
        return {
          id: r.id, title: r.title, category: r.category, severity: r.severity,
          confidence: r.confidence, cwe: r.cwe || null, owasp: r.owasp || null,
          why: r.why, fix: r.fix
        };
      });
    },
    helpers: {
      isTest: isTest, isCode: isCode, isDependencyManifest: isDependencyManifest,
      isInfra: isInfra, isMigration: isMigration, isSecretFile: isSecretFile, isLockfile: isLockfile
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PRism.rules;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
