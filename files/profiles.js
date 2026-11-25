"use strict";
/**
 * The user's non-disabled profiles, oldest first.
 * Which products get this file: lib/product-files.js.
 */
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

  query: ({ userId }) => [
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
  ],
};
