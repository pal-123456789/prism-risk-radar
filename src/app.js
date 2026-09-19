/*
 * PRism — app wiring (v2)
 * ---------------------------------------------------------------------------
 * Events, sample loading, drag-and-drop, tabbed navigation, export menu
 * (Markdown / JSON / SARIF), the rule-settings drawer, click-to-line jumps
 * from a signal into the annotated diff, and PWA install + offline.
 *
 * Analysis itself lives in analyzer.js; this file only orchestrates. When a
 * Web Worker is available it offloads the parse there (see runAnalysis); on
 * file:// or older browsers it falls back to a synchronous call so the app
 * always works with zero setup.
 */
(function () {
  "use strict";

  var P = window.PRism;
  var TONE = { critical: "danger", high: "warn", medium: "notice", low: "info", info: "info" };
  var lastResult = null;
  var worker = null, workerBroken = false;

  function q(id) { return document.getElementById(id); }

  // ---- toast ----------------------------------------------------------------
  function toast(msg) {
    var t = q("toast");
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.hidden = true; }, 220);
    }, 2200);
  }

  function updateMeta() {
    var text = q("diffInput").value;
    var lines = text ? text.split("\n").length : 0;
    q("inputMeta").textContent = text.trim()
      ? lines + " lines · " + text.length.toLocaleString() + " chars"
      : "";
  }

  // ---- worker plumbing (with synchronous fallback) --------------------------
  function getWorker() {
    if (workerBroken) return null;
    if (worker) return worker;
    try {
      if (typeof Worker === "undefined") { workerBroken = true; return null; }
      worker = new Worker("src/worker.js");
      worker.onerror = function () { workerBroken = true; worker = null; };
      return worker;
    } catch (e) {
      workerBroken = true;
      return null;
    }
  }

  function analyzeAsync(raw, cb) {
    var cfg = P.config.load();
    var w = getWorker();
    if (!w) { cb(P.analyze(raw, cfg)); return; }
    var done = false;
    var timer = setTimeout(function () {
      // Worker didn't answer (e.g. file:// blocked it) — fall back for good.
      if (done) return;
      done = true; workerBroken = true; worker = null;
      cb(P.analyze(raw, cfg));
    }, 1500);
    w.onmessage = function (ev) {
      if (done) return;
      done = true; clearTimeout(timer);
      if (ev.data && ev.data.ok) cb(ev.data.result);
      else cb(P.analyze(raw, cfg)); // worker reported failure → local
    };
    try { w.postMessage({ diff: raw, cfg: cfg }); }
    catch (e) { done = true; clearTimeout(timer); cb(P.analyze(raw, cfg)); }
  }

  function runAnalysis(animate) {
    var raw = q("diffInput").value;
    if (!raw.trim()) {
      toast("Paste a diff first, or tap a sample.");
      q("diffInput").focus();
      return;
    }
    q("analyzeBtn").disabled = true;
    analyzeAsync(raw, function (result) {
      q("analyzeBtn").disabled = false;
      if (!result || !result.totals || !result.totals.files) {
        toast("Couldn't find a diff in there — expecting `git diff` / .patch output.");
        return;
      }
      lastResult = result;
      P.ui.renderReport(result, { animate: animate !== false });
      if (window.innerWidth <= 880) {
        q("report").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function buildSampleChips() {
    var host = q("sampleChips");
    (P.samples || []).forEach(function (s) {
      var preview = P.analyze(s.diff);
      var chip = document.createElement("button");
      chip.className = "chip";
      chip.type = "button";
      chip.title = s.note + " — scores " + preview.score + "/100";
      chip.innerHTML = '<span class="dot d-' + preview.tierColor + '"></span>' + P.ui.esc(s.label);
      chip.addEventListener("click", function () {
        q("diffInput").value = s.diff;
        updateMeta();
        runAnalysis(true);
      });
      host.appendChild(chip);
    });
  }

  // ---- tabs (roving tabindex, arrow-key nav) --------------------------------
  function wireTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab[role="tab"]'));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        var panel = q(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (e) {
        var idx = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") idx = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") idx = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") idx = 0;
        else if (e.key === "End") idx = tabs.length - 1;
        if (idx !== null) { e.preventDefault(); select(tabs[idx], true); }
      });
    });
    // expose so click-to-line can switch to the Diff tab
    wireTabs._select = select;
    wireTabs._tabs = tabs;
  }
  function showTab(id) {
    var tab = q(id);
    if (tab && wireTabs._select) wireTabs._select(tab, false);
  }

  // ---- click-to-line: jump from a signal location into the diff -------------
  function wireJumps() {
    q("signalList").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".loc[data-jump-file]") : null;
      if (!btn) return;
      var file = btn.getAttribute("data-jump-file");
      var line = btn.getAttribute("data-jump-line");
      if (!lastResult) return;
      var fi = (lastResult.files || []).findIndex(function (f) { return f.path === file; });
      if (fi < 0) return;
      showTab("tab-diff");
      // If "only flagged" hid nothing here we're fine; ensure the file is open.
      var fileEl = document.querySelector('.diff-file[data-fi="' + fi + '"]');
      if (fileEl && fileEl.classList.contains("collapsed")) PRism.ui.toggleDiffFile(fileEl);
      var target = q("dl-" + fi + "-" + line);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("dl-pulse");
        void target.offsetWidth; // restart animation
        target.classList.add("dl-pulse");
      }
    });
  }

  // ---- diff toolbar: only-flagged filter, expand/collapse, per-file toggle --
  function wireDiffControls() {
    var only = q("onlyFlagged");
    if (only) only.addEventListener("change", function () { PRism.ui.setOnlyFlagged(only.checked); });
    var ea = q("expandAll"); if (ea) ea.addEventListener("click", function () { PRism.ui.setAllDiffFiles(false); });
    var ca = q("collapseAll"); if (ca) ca.addEventListener("click", function () { PRism.ui.setAllDiffFiles(true); });

    // Click a file header to expand/collapse that file (event delegation).
    var view = q("diffView");
    if (view) view.addEventListener("click", function (e) {
      var head = e.target.closest ? e.target.closest(".diff-file-head") : null;
      if (!head) return;
      var fileEl = head.parentNode;
      if (fileEl && fileEl.classList.contains("diff-file")) PRism.ui.toggleDiffFile(fileEl);
    });
  }

  // ---- drag & drop ----------------------------------------------------------
  function wireDropzone() {
    var dz = q("dropzone");
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("dragging"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === "dragleave" && dz.contains(e.relatedTarget)) return;
        dz.classList.remove("dragging");
      });
    });
    dz.addEventListener("drop", function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        q("diffInput").value = String(reader.result || "");
        updateMeta();
        runAnalysis(true);
      };
      reader.readAsText(file);
    });
  }

  // ---- export menu ----------------------------------------------------------
  function wireExport() {
    var btn = q("exportBtn"), menu = q("exportMenu");
    function open() { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); document.addEventListener("click", onDoc, true); }
    function close() { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); document.removeEventListener("click", onDoc, true); }
    function onDoc(e) { if (!menu.contains(e.target) && e.target !== btn) close(); }
    btn.addEventListener("click", function (e) { e.stopPropagation(); menu.hidden ? open() : close(); });
    btn.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    menu.addEventListener("click", function (e) {
      var item = e.target.closest ? e.target.closest("[data-export]") : null;
      if (!item) return;
      doExport(item.getAttribute("data-export"));
      close();
    });
  }

  function doExport(kind) {
    if (!lastResult) { toast("Analyze a diff first."); return; }
    if (kind === "md") {
      copyText(P.exporters.toMarkdown(lastResult), "Report copied as Markdown.");
    } else if (kind === "json") {
      download("prism-report.json", P.exporters.toJSON(lastResult), "application/json");
      toast("Downloaded prism-report.json");
    } else if (kind === "sarif") {
      download("prism.sarif.json", P.exporters.toSARIF(lastResult), "application/json");
      toast("Downloaded prism.sarif.json");
    }
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { fallbackCopy(text, okMsg); });
    } else { fallbackCopy(text, okMsg); }
  }
  function fallbackCopy(text, okMsg) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(okMsg); }
    catch (e) { toast("Copy failed — select the report manually."); }
    document.body.removeChild(ta);
  }
  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch (e) {
      // Some file:// contexts block blob downloads — fall back to copying.
      copyText(text, "Download blocked here — copied to clipboard instead.");
    }
  }

  // ---- settings drawer ------------------------------------------------------
  function wireSettings() {
    var drawer = q("settingsDrawer"), scrim = q("settingsScrim"), openBtn = q("settingsBtn");
    var lastFocus = null;
    function open() {
      lastFocus = document.activeElement;
      P.ui.renderRuleConfig(P.config.load());
      drawer.hidden = false; scrim.hidden = false;
      requestAnimationFrame(function () { drawer.classList.add("open"); scrim.classList.add("show"); });
      document.addEventListener("keydown", onKey);
      q("settingsClose").focus();
    }
    function close() {
      drawer.classList.remove("open"); scrim.classList.remove("show");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () { drawer.hidden = true; scrim.hidden = true; }, 220);
      if (lastFocus) lastFocus.focus();
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    openBtn.addEventListener("click", open);
    q("settingsClose").addEventListener("click", close);
    scrim.addEventListener("click", close);

    // Persist changes as the user toggles / re-severities a rule.
    q("ruleConfigList").addEventListener("change", function (e) {
      var row = e.target.closest ? e.target.closest(".rc-rule") : null;
      if (!row) return;
      var id = row.getAttribute("data-rule");
      var cfg = P.config.load();
      if (e.target.classList.contains("rc-enable")) {
        if (e.target.checked) delete cfg.disabled[id];
        else cfg.disabled[id] = true;
        row.classList.toggle("rc-off", !e.target.checked);
      } else if (e.target.classList.contains("rc-sev")) {
        cfg.severity[id] = e.target.value;
      }
      P.config.save(cfg);
      reAnalyzeIfLoaded();
    });

    q("cfgReset").addEventListener("click", function () {
      P.config.reset();
      P.ui.renderRuleConfig(P.config.load());
      reAnalyzeIfLoaded();
      toast("Rules reset to defaults.");
    });
    q("cfgExport").addEventListener("click", function () {
      download("prism-rules.json", P.config.exportJSON(P.config.load()), "application/json");
      toast("Exported rule profile.");
    });
    q("cfgImport").addEventListener("click", function () { q("cfgImportFile").click(); });
    q("cfgImportFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var cfg = P.config.importJSON(String(reader.result || "{}"));
          P.config.save(cfg);
          P.ui.renderRuleConfig(cfg);
          reAnalyzeIfLoaded();
          toast("Imported rule profile.");
        } catch (err) { toast("That file isn't a valid PRism rule profile."); }
      };
      reader.readAsText(file);
      e.target.value = "";
    });
  }

  function reAnalyzeIfLoaded() {
    if (lastResult && q("diffInput").value.trim()) runAnalysis(false);
  }

  // ---- PWA: install prompt + offline via service worker ---------------------
  function wirePWA() {
    var deferred = null;
    var btn = q("installBtn");
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault(); deferred = e; btn.hidden = false;
    });
    btn.addEventListener("click", function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () { deferred = null; btn.hidden = true; });
    });
    window.addEventListener("appinstalled", function () { btn.hidden = true; });

    if ("serviceWorker" in navigator &&
        (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline is a bonus */ });
    }
  }

  // ---- boot -----------------------------------------------------------------
  function init() {
    buildSampleChips();
    wireDropzone();
    wireTabs();
    wireJumps();
    wireDiffControls();
    wireExport();
    wireSettings();
    wirePWA();

    q("analyzeBtn").addEventListener("click", function () { runAnalysis(true); });
    q("clearBtn").addEventListener("click", function () {
      q("diffInput").value = "";
      updateMeta();
      q("reportBody").hidden = true;
      q("emptyState").hidden = false;
      lastResult = null;
      q("diffInput").focus();
    });

    q("diffInput").addEventListener("input", updateMeta);
    q("diffInput").addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runAnalysis(true); }
    });

    updateMeta();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
