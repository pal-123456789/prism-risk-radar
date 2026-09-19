/*
 * PRism service worker — offline app shell.
 * Cache-first for our own assets so the tool keeps working with no network
 * (which is also the privacy promise: it never needed the network anyway).
 */
var CACHE = "prism-v5";
var SHELL = [
  "./",
  "./index.html",
  "./landing.html",
  "./assets/styles.css",
  "./assets/landing.js",
  "./src/parser.js",
  "./src/tokenizer.js",
  "./src/entropy.js",
  "./src/metrics.js",
  "./src/rules.js",
  "./src/config.js",
  "./src/suppress.js",
  "./src/analyzer.js",
  "./src/export.js",
  "./src/samples.js",
  "./src/ui.js",
  "./src/app.js",
  "./src/worker.js",
  "./icon.svg",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        // Cache same-origin successful responses for next time.
        if (res && res.ok && e.request.url.indexOf(self.location.origin) === 0) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return caches.match("./index.html"); });
    })
  );
});
