"use strict";
/**
 * Everyone the user follows + everyone who follows the user (not followed back).
 * user_followers: sender_id follows receiver_id. Rows both ways = mutual.
 *
 * - Disabled users are KEPT: the relationship is the requester's own data (shown with their username).
 * - Service users (is_service_user = 1) are left out.
 * - Which products get this file: lib/product-files.js.
 *
 * Query: each follow row is read once (UNION ALL of both directions, each using its index), then
 * GROUP BY collapses each person to one row with both dates. No duplicate removal, no re-lookups.
 * Order: people the user follows (newest first), then followers not followed back (newest first).
 */
module.exports = {
  name: "friends.csv",
  columns: [
    "username",
    "following",
    "mutual",
    "followed_date",
    "followed_you_date",
  ],

  // :userId is a named binding, so every occurrence gets the same value
  query: ({ userId }) => [
    `SELECT
       u.username                                                                         AS username,
       IF(x.followed_date IS NOT NULL, 'Yes', 'No')                                       AS following,
       IF(x.followed_date IS NOT NULL AND x.followed_you_date IS NOT NULL, 'Yes', 'No')   AS mutual,
       DATE_FORMAT(x.followed_date,     '%Y-%m-%d %H:%i:%s')                              AS followed_date,     -- user followed them
       DATE_FORMAT(x.followed_you_date, '%Y-%m-%d %H:%i:%s')                              AS followed_you_date  -- they followed user
     FROM (
       SELECT other_id,
              MAX(CASE WHEN dir = 'out' THEN created_at END) AS followed_date,
              MAX(CASE WHEN dir = 'in'  THEN created_at END) AS followed_you_date
       FROM (
         SELECT receiver_id AS other_id, created_at, 'out' AS dir FROM user_followers WHERE sender_id   = :userId
         UNION ALL
         SELECT sender_id   AS other_id, created_at, 'in'  AS dir FROM user_followers WHERE receiver_id = :userId
       ) rel
       WHERE other_id <> :userId
       GROUP BY other_id
     ) x
     JOIN users u ON u.id = x.other_id AND u.is_service_user = 0
     ORDER BY x.followed_date IS NULL, COALESCE(x.followed_date, x.followed_you_date) DESC`,
    { userId },
  ],
};
