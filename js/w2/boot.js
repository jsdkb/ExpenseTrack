/* ExpenseTrack v6 — loader for the new book that runs beside the current app (docs/v6-book.md §1).
   Adds the "New · preview" menu group and loads the js/w2 files one after another, in order. The
   original app never depends on any of them: when a file does not load, one warning is logged, the
   files after it are not loaded, and everything else keeps working. No personal data in this file. */
(function () {
  'use strict';
  // Only files that exist on disk may be listed here: a missing file is a 404, which the browser
  // logs as a console error on every page of the original app. Add a file when it is finished.
  var FILES = ['js/w2/book.js', 'js/w2/store.js', 'js/w2/match.js', 'js/w2/pages.js', 'js/w2/perf.js', 'js/w2/check.js', 'js/w2/add.js', 'js/w2/tax.js', 'js/w2/acct.js'];
  var state = { loaded: [], failed: null, done: false, on: false };
  window.w2Boot = state;

  // The preview is off unless it was switched on for this browser. Open the app once with
  // "?w2=1" in the address to switch it on, "?w2=0" to switch it off. While it is off this file
  // does nothing at all: no menu group, no files, so the original app is exactly as before.
  var KEY = 'et_w2_preview';
  try {
    var q = new URLSearchParams(location.search).get('w2');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    state.on = localStorage.getItem(KEY) === '1';
  } catch (_) { state.on = false; }
  if (!state.on) { state.done = true; return; }

  // NAV_GROUPS is a top-level const array in the core: pushing to it needs no core edit.
  try {
    if (typeof NAV_GROUPS !== 'undefined' && Array.isArray(NAV_GROUPS) && !NAV_GROUPS.some(function (g) { return g && g[0] === 'w2'; })) {
      NAV_GROUPS.push(['w2', 'New · preview']);
    }
  } catch (_) { /* the core is not there: nothing to add to */ }

  function next(i) {
    if (i >= FILES.length) { state.done = true; return; }
    var src = FILES[i], s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = function () { state.loaded.push(src); next(i + 1); };
    s.onerror = function () {
      state.failed = src; state.done = true;
      console.warn('ExpenseTrack preview: ' + src + ' did not load, so the files after it were skipped. The rest of the app is not affected.');
    };
    (document.head || document.documentElement).appendChild(s);
  }
  try { next(0); } catch (e) {
    state.failed = 'boot'; state.done = true;
    console.warn('ExpenseTrack preview: the loader stopped (' + (e && e.message || e) + '). The rest of the app is not affected.');
  }
})();
