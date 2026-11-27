"use strict";
/**
 * Games in each (non-disabled) profile's library, across ALL products and tenants,
 * with a `product` column.
 * Order: by product, then profile, then most recently added first.
 */
const { productLabel } = require("../lib/format");

module.exports = {
  name: "game_library.csv",
  columns: ["product", "profile_name", "game", "added_on"],

  query: ({ userId }) => [
    `SELECT
       l.product_id,
       p.username                                     AS profile_name,
       g.title                                        AS game,
       DATE_FORMAT(l.created_at, '%Y-%m-%d %H:%i:%s') AS added_on
     FROM user_game_library l
     JOIN profiles p ON p.id = l.profile_id AND p.user_id = l.user_id AND p.disabled = 0
     LEFT JOIN games g ON g.id = l.game_id
     WHERE l.user_id = ?
     ORDER BY l.product_id, p.created_at, p.id, l.created_at DESC`,
    [userId],
  ],

  enrich: async (rows) =>
    rows.map((r) => ({
      product: productLabel(r.product_id),
      profile_name: r.profile_name,
      game: r.game ?? null,
      added_on: r.added_on,
    })),
};
