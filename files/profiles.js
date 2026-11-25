"use strict";
/**
 * The user's non-disabled profiles, oldest first.
 * Profiles are only supported by product "aaa"; any other product gets a header-only file (no query run).
 */
const PROFILES_PRODUCT = "aaa";

const query = ({ userId }) => [
  `SELECT
     username                                     AS name,
     avatar                                       AS avatar,
     IF(is_kid_profile = 1, 'Yes', 'No')          AS kid_profile,
     IF(locked = 1, 'Yes', 'No')                  AS locked,
     language                                     AS language,
     DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_on
   FROM profiles
   WHERE user_id = ? AND disabled = 0
   ORDER BY created_at`,
  [userId],
];

function source(ctx) {
  if (ctx.productId !== PROFILES_PRODUCT) return [];
  const [sql, bindings] = query(ctx);
  return ctx.knex.raw(sql, bindings).stream();
}

module.exports = {
  name: "profiles.csv",
  columns: [
    "name",
    "avatar",
    "kid_profile",
    "locked",
    "language",
    "created_on",
  ],
  source,
};
