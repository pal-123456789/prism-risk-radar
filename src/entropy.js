/*
 * PRism — entropy-based secret detection
 * ---------------------------------------------------------------------------
 * Keyword rules ("password = ...") catch the obvious. Real secret scanners
 * (gitleaks, truffleHog, detect-secrets) also catch the *shape* of a secret:
 * a long, high-entropy, mixed-charset token that no human typed. This module
 * scores candidate tokens by Shannon entropy and filters the things that look
 * random but aren't (hashes of known length, UUIDs, URLs, hex colors, repeated
 * or sequential junk, obvious placeholders).
 *
 * It reports findings only from STRING-literal content (passed in by the
 * tokenizer), which is where credentials actually live — a huge false-positive
 * reduction over scanning raw lines.
 */
(function (root) {
  "use strict";

  // Shannon entropy in bits per character.
  function shannon(str) {
    if (!str) return 0;
    var freq = {};
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      freq[c] = (freq[c] || 0) + 1;
    }
    var H = 0, len = str.length;
    for (var k in freq) {
      if (!Object.prototype.hasOwnProperty.call(freq, k)) continue;
      var p = freq[k] / len;
      H -= p * (Math.log(p) / Math.log(2));
    }
    return H;
  }

  function charClasses(str) {
    return {
      lower: /[a-z]/.test(str),
      upper: /[A-Z]/.test(str),
      digit: /[0-9]/.test(str),
      symbol: /[^A-Za-z0-9]/.test(str)
    };
  }
  function classCount(str) {
    var c = charClasses(str);
    return (c.lower ? 1 : 0) + (c.upper ? 1 : 0) + (c.digit ? 1 : 0) + (c.symbol ? 1 : 0);
  }

  // Things that are high-entropy but benign.
  var PLACEHOLDER = /^(?:x{3,}|\.{3,}|<[^>]+>|\$\{[^}]+\}|%[sd]|changeme|example|placeholder|your[-_ ]?\w+|todo|none|null|undefined|true|false)$/i;
  var LOOKS_URL = /^[a-z][a-z0-9+.\-]*:\/\//i;
  var LOOKS_PATH = /^[.]{0,2}\/|^[A-Za-z]:\\/;
  var HEX_COLOR = /^#?[0-9a-fA-F]{3,8}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var WORDS = /^[A-Za-z]+(?:[ _-][A-Za-z]+)+$/; // "some words joined" -> prose, not a secret
  var SENTENCE = /\s/;

  function isRepetitiveOrSequential(str) {
    if (/^(.)\1+$/.test(str)) return true; // aaaaaa
    // low unique-char ratio
    var uniq = {};
    for (var i = 0; i < str.length; i++) uniq[str[i]] = 1;
    if (Object.keys(uniq).length / str.length < 0.35) return true;
    return false;
  }

  // Known secret-length hex hashes we don't want to double-report as "entropy".
  function isCommonHash(str) {
    if (!/^[0-9a-f]+$/i.test(str)) return false;
    return [32, 40, 56, 64, 96, 128].indexOf(str.length) !== -1; // md5..sha512 hex
  }

  /*
   * Evaluate a single candidate token.
   * Returns null if benign, or { value, entropy, confidence, kind }.
   */
  function evaluateToken(tok) {
    if (!tok) return null;
    var s = tok.trim();
    if (s.length < 20 || s.length > 200) return null;       // too short/long to judge
    if (SENTENCE.test(s)) return null;                       // real secrets have no spaces
    if (PLACEHOLDER.test(s)) return null;
    if (LOOKS_URL.test(s) || LOOKS_PATH.test(s)) return null;
    if (HEX_COLOR.test(s) && s.length <= 8) return null;
    if (UUID.test(s)) return null;
    if (WORDS.test(s)) return null;
    if (isRepetitiveOrSequential(s)) return null;

    var H = shannon(s);
    var classes = classCount(s);

    // base64/base64url/hex-ish body, long, multi-class, high entropy
    var b64ish = /^[A-Za-z0-9+/_\-]+={0,2}$/.test(s);
    if (!b64ish) return null;

    // thresholds tuned to be quiet: require genuine randomness
    var minEntropy = isCommonHash(s) ? 3.6 : 4.0;
    if (H < minEntropy) return null;
    if (classes < 2) return null;

    // confidence grows with entropy, length, and charset variety
    var conf = 0.4;
    if (H >= 4.3) conf += 0.2;
    if (H >= 4.6) conf += 0.1;
    if (s.length >= 32) conf += 0.15;
    if (classes >= 3) conf += 0.15;
    if (conf > 0.95) conf = 0.95;

    var kind = isCommonHash(s) ? "high-entropy hash-like string" : "high-entropy token";
    return {
      value: s,
      entropy: Math.round(H * 100) / 100,
      confidence: Math.round(conf * 100) / 100,
      kind: kind
    };
  }

  /*
   * Scan the tokenizer's per-line string content. `stringList` is an array of
   * string-literal bodies found on that line. Returns the strongest finding on
   * the line, or null. (We report at most one entropy hit per line to avoid
   * drowning the report; the rule engine caps across the file.)
   */
  function scanLineStrings(stringList) {
    if (!stringList || !stringList.length) return null;
    var best = null;
    for (var i = 0; i < stringList.length; i++) {
      // A string may itself contain a token amid other chars; test the whole
      // literal and also any long word-ish run inside it.
      var candidates = [stringList[i]];
      var runs = stringList[i].match(/[A-Za-z0-9+/_\-]{20,}={0,2}/g);
      if (runs) candidates = candidates.concat(runs);
      for (var c = 0; c < candidates.length; c++) {
        var r = evaluateToken(candidates[c]);
        if (r && (!best || r.confidence > best.confidence)) best = r;
      }
    }
    return best;
  }

  root.PRism = root.PRism || {};
  root.PRism.entropy = {
    shannon: shannon,
    evaluateToken: evaluateToken,
    scanLineStrings: scanLineStrings
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PRism.entropy;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
