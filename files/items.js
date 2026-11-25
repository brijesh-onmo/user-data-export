"use strict";
/**
 * What the user owns now: one row per item and one per bundle, newest first.
 *
 * - Every owned item has an inventory transaction (wallet_type = 'inventory', amount > 0),
 *   free ones included. There are no negative inventory transactions, so any grant = owned.
 * - The same item can be granted many times -> one row, first grant's date.
 * - Buying a bundle writes a transaction for the bundle itself (inventory.is_bundle = 1) and one
 *   per item inside it, so the bundle and its items each get their own row. Items aren't linked
 *   back to the bundle; they share (almost) the same acquired_on time.
 */
const { label } = require("../lib/format");

// AVATAR -> Avatar; bundles: AVATAR -> "AVATAR BUNDLE", anything else -> "Bundle"
function categoryLabel(category, isBundle) {
  if (!isBundle) return label(category);
  return category === "AVATAR" ? "AVATAR BUNDLE" : "Bundle";
}

module.exports = {
  name: "items.csv",
  columns: ["name", "category", "acquired_on"],

  query: ({ userId }) => [
    `SELECT
       inv.title                                          AS name,
       inv.category,
       inv.is_bundle,
       DATE_FORMAT(MIN(t.create_date), '%Y-%m-%d %H:%i:%s') AS acquired_on
     FROM item_transactions t
     LEFT JOIN inventory inv ON inv.id = t.item_type
     WHERE t.user_id = ? AND t.wallet_type = 'inventory' AND t.amount > 0
     GROUP BY t.item_type, inv.title, inv.category, inv.is_bundle
     ORDER BY MIN(t.create_date) DESC, inv.title`,
    [userId],
  ],

  enrich: async (rows) =>
    rows.map((r) => ({
      name: r.name ?? null,
      category: categoryLabel(r.category, Number(r.is_bundle) === 1),
      acquired_on: r.acquired_on,
    })),
};
