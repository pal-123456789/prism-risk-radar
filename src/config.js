/*
 * PRism — rule configuration (local only)
 * ---------------------------------------------------------------------------
 * Teams tune review standards differently: one team treats a TODO as noise,
 * another blocks on it. PRism lets you enable/disable rules and override
 * severities — persisted in localStorage, so it's remembered on this device
 * and never sent anywhere. Export/import is plain JSON so a team can share a
 * profile by committing a file, not by trusting a server.
 *
 * Shape (also the on-disk `.prism.json` schema — one format, two hosts):
 *   {
 *     "version": 1,
 *     "disabled": { "todo": true },          // rule ids to silence
 *     "severity": { "debug-print": "high" }, // per-rule severity overrides
 *     "gate": { "failOn": "high", "maxScore": 80 }  // optional CI policy
 *   }
 *
 * `gate` is ignored by the web app (it only advises) but read by the CLI /
 * GitHub Action to decide the exit code, so a team commits one file and gets
 * the same policy in the browser and in CI.
 *
 * In Node (tests) there's no localStorage; the module degrades to in-memory.
 */
(function (root) {
  "use strict";

  var KEY = "prism.config.v1";
  var SEV = ["info", "low", "medium", "high", "critical"];

  function hasLS() {
    try { return typeof localStorage !== "undefined" && localStorage !== null; }
    catch (e) { return false; }
  }

  var memory = { disabled: {}, severity: {}, version: 1 };

  function load() {
    if (!hasLS()) return clone(memory);
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return { disabled: {}, severity: {}, version: 1 };
      var parsed = JSON.parse(raw);
      return normalize(parsed);
    } catch (e) {
      return { disabled: {}, severity: {}, version: 1 };
    }
  }

  function save(cfg) {
    var norm = normalize(cfg);
    memory = clone(norm);
    if (hasLS()) {
      try { localStorage.setItem(KEY, JSON.stringify(norm)); } catch (e) { /* private mode, quota */ }
    }
    return norm;
  }

  function normalize(cfg) {
    var out = { disabled: {}, severity: {}, version: 1 };
    if (cfg && cfg.disabled && typeof cfg.disabled === "object") {
      for (var k in cfg.disabled) if (own(cfg.disabled, k)) out.disabled[k] = !!cfg.disabled[k];
    }
    if (cfg && cfg.severity && typeof cfg.severity === "object") {
      for (var s in cfg.severity) {
        if (own(cfg.severity, s) && SEV.indexOf(cfg.severity[s]) !== -1) out.severity[s] = cfg.severity[s];
      }
    }
    var gate = normalizeGate(cfg && cfg.gate);
    if (gate) out.gate = gate;
    return out;
  }

  // Only kept when at least one valid field is present, so exported profiles
  // stay clean instead of carrying an empty {} that reads like a setting.
  function normalizeGate(g) {
    if (!g || typeof g !== "object") return null;
    var out = {};
    if (SEV.indexOf(g.failOn) !== -1) out.failOn = g.failOn;
    if (typeof g.maxScore === "number" && isFinite(g.maxScore)) {
      out.maxScore = Math.max(0, Math.min(100, Math.round(g.maxScore)));
    }
    return (own(out, "failOn") || own(out, "maxScore")) ? out : null;
  }

  /*
   * Decide whether a report should FAIL a build under a gate.
   * Returns { failed, reasons[] } — reasons is empty when the gate passes,
   * so the caller can print exactly why CI went red. Pure and host-agnostic.
   */
  function evaluateGate(result, gate) {
    var reasons = [];
    gate = normalizeGate(gate) || {};
    if (own(gate, "maxScore") && result.score > gate.maxScore) {
      reasons.push("score " + result.score + " exceeds maxScore " + gate.maxScore);
    }
    if (own(gate, "failOn")) {
      var floor = SEV.indexOf(gate.failOn);
      var worst = -1, worstName = null;
      (result.signals || []).forEach(function (s) {
        var r = SEV.indexOf(s.severity);
        if (r > worst) { worst = r; worstName = s.severity; }
      });
      if (worst >= floor && floor !== -1) {
        reasons.push(worstName + "-severity signal at or above failOn threshold " + gate.failOn);
      }
    }
    return { failed: reasons.length > 0, reasons: reasons };
  }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function reset() {
    if (hasLS()) { try { localStorage.removeItem(KEY); } catch (e) {} }
    memory = { disabled: {}, severity: {}, version: 1 };
    return clone(memory);
  }

  // Apply config to a rule: returns effective { enabled, severity } or null if disabled.
  function effective(cfg, rule) {
    if (cfg.disabled[rule.id]) return null;
    var sev = cfg.severity[rule.id] || rule.severity;
    return { severity: sev };
  }

  function exportJSON(cfg) { return JSON.stringify(normalize(cfg), null, 2); }
  function importJSON(text) { return normalize(JSON.parse(text)); }

  root.PRism = root.PRism || {};
  root.PRism.config = {
    load: load, save: save, reset: reset, normalize: normalize,
    effective: effective, exportJSON: exportJSON, importJSON: importJSON,
    normalizeGate: normalizeGate, evaluateGate: evaluateGate,
    SEVERITIES: SEV
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PRism.config;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
