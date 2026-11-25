"use strict";

module.exports = {
  name: "account.csv",
  columns: [
    "username",
    "email",
    "phone_number",
    "language",
    "avatar",
    "sign_in_method",
    "created_on",
  ],
  query: ({ userId }) => [
    `SELECT
       username                                     AS username,
       email                                        AS email,
       phone                                        AS phone_number,
       language                                     AS language,
       avatar                                       AS avatar,
       COALESCE(
         NULLIF(TRIM(idp_name), ''),
         CASE WHEN NULLIF(TRIM(phone), '') IS NOT NULL THEN 'Phone' END
       )                                            AS sign_in_method,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_on
     FROM users
     WHERE id = ? AND disable = 0`,
    [userId],
  ],
};
