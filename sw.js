/*
 * PRism service worker — offline app shell.
 * Cache-first for our own assets so the tool keeps working with no network
 * (which is also the privacy promise: it never needed the network anyway).
 */
var CACHE = "prism-v7";
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

// A response that came from following a redirect is flagged redirected:true,
// and the browser REFUSES to use it for a navigation (redirect mode != follow),
// surfacing as "a redirected response was used...". Rebuild such a response into
// a clean, non-redirected one before it is ever cached or returned.
function clean(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.clone().blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  // Navigations: network-first, so a fresh page can't be shadowed by a stale
  // cached shell; fall back to cache (then index.html) only when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        return clean(res).then(function (safe) {
          if (safe && safe.ok && req.url.indexOf(self.location.origin) === 0) {
            var copy = safe.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return safe;
        });
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match("./index.html"); });
      })
    );
    return;
  }

  // Everything else: cache-first for speed + offline.
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        return clean(res).then(function (safe) {
          if (safe && safe.ok && req.url.indexOf(self.location.origin) === 0) {
            var copy = safe.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return safe;
        });
      }).catch(function () { return caches.match("./index.html"); });
    })
  );
});
