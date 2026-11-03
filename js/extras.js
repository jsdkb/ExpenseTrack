/* ExpenseTrack v2 — Extras module.
   Owner: Extras builder (D). Pages: budgets, goals, invest, spt (group 'plan'); keeps
   STATE.budgets / STATE.goals (shapes in docs/v2-interfaces.md §3).

   Loaded by index.html after the core script, in this fixed order: books, home, statements,
   extras. Everything here runs in the page's global scope, so keep it inside the function below
   and put only deliberate cross-module helpers on window. Contract: docs/v2-interfaces.md.

   Registry API (defined in index.html):
     registerPage({key, label, short?, icon, group, order, render, afterRender?, needs?}) -> bool
       group: 'top' | 'wealth' | 'books' | 'plan'; render(page) returns the page's HTML;
       afterRender(page) runs on the next frame (draw charts into CHARTS[id] so they are cleaned up).
     registerHook(name, fn)        runHooks(name, ...args) -> array of non-null results
     registerIcon(name, svgInner)  adds a Lucide icon for ic(name)
     BOOKS() -> et-books/1 data or null    booksStatus() -> idle|loading|ready|none|error
     scheduleDriveSave() after every STATE change; give each entry an `at` ISO time (merge rule).
   No personal data in this file: the repo is public. */
(function(){
  'use strict';
})();
