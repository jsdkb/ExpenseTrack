/* ExpenseTrack v2 — Statements module.
   Owner: Statements builder (C). Adds no page: it extends built-in pages through hooks —
   txnBadges(tx), cardsHistory(cards), accountsExtraCol(acc), homeComingUp() — and keeps
   STATE.stmtFix / STATE.cardMap (shapes in docs/v2-interfaces.md §3).

   Loaded by index.html after the core script, in this fixed order: books, home, statements,
   extras. Everything here runs in the page's global scope, so keep it inside the function below
   and put only deliberate cross-module helpers on window. Contract: docs/v2-interfaces.md.

   Registry API (defined in index.html):
     registerHook(name, fn)        runHooks(name, ...args) -> array of non-null results
       hook results are HTML strings inserted as-is: escape anything from data with escH().
     registerPage({key, label, short?, icon, group, order, render, afterRender?, needs?}) -> bool
     registerIcon(name, svgInner)  adds a Lucide icon for ic(name)
     STATE.cash.statements[] carry id, periodStart, dueDate, minPayment, notes (applyCash).
   No personal data in this file: the repo is public. */
(function(){
  'use strict';
})();
