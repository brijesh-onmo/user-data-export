"use strict";
/**
 * Everyone the user follows + everyone who follows the user (not followed back).
 * user_followers: sender_id follows receiver_id. Rows both ways = mutual.
 * Disabled users are left out.
 * Order: people the user follows (newest first), then followers not followed back (newest first).
 * Product "aaa" doesn't support friends: header-only file, no query run.
 */
const NO_FRIENDS_PRODUCT = "aaa";

const query = ({ userId }) => [
    `SELECT
       u.username                                           AS username,
       IF(f.id IS NOT NULL, 'Yes', 'No')                    AS following,
       IF(f.id IS NOT NULL AND r.id IS NOT NULL, 'Yes', 'No') AS mutual,
       DATE_FORMAT(f.created_at, '%Y-%m-%d %H:%i:%s')       AS followed_date,     -- user followed them
       DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s')       AS followed_you_date  -- they followed user
     FROM (
       SELECT receiver_id AS other_id FROM user_followers WHERE sender_id = ?
       UNION
       SELECT sender_id   AS other_id FROM user_followers WHERE receiver_id = ?
     ) p
     JOIN users u ON u.id = p.other_id AND u.disable = 0
     LEFT JOIN user_followers f ON f.sender_id = ? AND f.receiver_id = p.other_id  -- user follows them
     LEFT JOIN user_followers r ON r.sender_id = p.other_id AND r.receiver_id = ?  -- they follow user
     WHERE p.other_id <> ?
     ORDER BY f.id IS NULL, COALESCE(f.created_at, r.created_at) DESC`,
    [userId, userId, userId, userId, userId],
];

function source(ctx) {
  if (ctx.productId === NO_FRIENDS_PRODUCT) return [];
  const [sql, bindings] = query(ctx);
  return ctx.knex.raw(sql, bindings).stream();
}

module.exports = {
  name: "friends.csv",
  columns: [
    "username",
    "following",
    "mutual",
    "followed_date",
    "followed_you_date",
  ],
  source,
};
