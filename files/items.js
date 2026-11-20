"use strict";
/**
 * What the user owns now: one row per item / bundle, newest first.
 *
 * - Every owned item has an inventory transaction (wallet_type = 'inventory', amount > 0),
 *   free ones included. There are no negative inventory transactions, so any grant = owned.
 * - The same item can be granted many times -> one row, first grant's date.
 * - Buying a bundle creates a transaction for the bundle (inventory.is_bundle = 1) AND one per
 *   item inside it. There's no direct link between them, so an item is matched to the nearest
 *   bundle transaction of the same user within BUNDLE_WINDOW_MS whose data.items contains it.
 */
const { formatUtc } = require("../lib/format");

const BUNDLE_WINDOW_MS = 5000;

// AVATAR -> Avatar, PROFILE_FRAME -> Profile Frame
function titleCase(value) {
  if (!value) return null;
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function categoryLabel(t) {
  if (!t.isBundle) return titleCase(t.category);
  if (t.category === "AVATAR") return "AVATAR BUNDLE";
  return "Bundle";
}

function bundleItems(data) {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  return new Set(Array.isArray(parsed?.items) ? parsed.items : []);
}

function findBundle(txn, bundleTxns) {
  let best = null;
  for (const b of bundleTxns) {
    const gap = Math.abs(b.time - txn.time);
    if (gap > BUNDLE_WINDOW_MS || !b.items.has(txn.itemId)) continue;
    if (!best || gap < best.gap) best = { gap, title: b.title };
  }
  return best ? best.title : null;
}

async function* source({ knex, userId }) {
  const [rows] = await knex.raw(
    `SELECT t.item_type, t.create_date, inv.title, inv.category, inv.is_bundle, inv.data
       FROM item_transactions t
       LEFT JOIN inventory inv ON inv.id = t.item_type
      WHERE t.user_id = ? AND t.wallet_type = 'inventory' AND t.amount > 0
      ORDER BY t.sequence`,
    [userId],
  );

  const txns = rows.map((r) => ({
    itemId: r.item_type,
    time: new Date(r.create_date).getTime(),
    title: r.title,
    category: r.category,
    isBundle: r.is_bundle === 1,
    data: r.data,
  }));

  const bundleTxns = txns
    .filter((t) => t.isBundle)
    .map((t) => ({ time: t.time, title: t.title, items: bundleItems(t.data) }));

  // first grant per item (rows are in sequence order)
  const owned = new Map();
  for (const t of txns) {
    if (owned.has(t.itemId)) continue;
    owned.set(t.itemId, {
      name: t.title,
      category: categoryLabel(t),
      bundle_name: t.isBundle ? null : findBundle(t, bundleTxns),
      time: t.time,
    });
  }

  const result = [...owned.values()].sort((a, b) => b.time - a.time); // newest first
  for (const r of result) {
    yield {
      name: r.name,
      category: r.category,
      bundle_name: r.bundle_name,
      acquired_on: formatUtc(r.time),
    };
  }
}

module.exports = {
  name: "items.csv",
  columns: ["name", "category", "bundle_name", "acquired_on"],
  source,
};
