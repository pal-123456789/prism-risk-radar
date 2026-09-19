/*
 * PRism — analysis worker
 * ---------------------------------------------------------------------------
 * Runs the exact same engine off the main thread so a very large diff never
 * janks the UI. It imports the same source files the page does — one engine,
 * two hosts. If a browser (or file://) refuses to spawn a worker, app.js
 * silently falls back to a synchronous analyze() on the main thread, so this
 * is a progressive enhancement, never a requirement.
 *
 * Note: localStorage is unavailable in a worker, so config is passed in from
 * the page with each message rather than loaded here.
 */
/* eslint-env worker */
"use strict";

try {
  importScripts(
    "parser.js",
    "tokenizer.js",
    "entropy.js",
    "metrics.js",
    "rules.js",
    "config.js",
    "suppress.js",
    "analyzer.js"
  );
} catch (e) {
  // If imports fail, report broken so the page can fall back.
  self.onmessage = function () { self.postMessage({ ok: false, error: "worker-import-failed" }); };
}

self.onmessage = function (ev) {
  var data = ev.data || {};
  try {
    var result = self.PRism.analyze(data.diff, data.cfg);
    self.postMessage({ ok: true, result: result });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
