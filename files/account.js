'use strict';

module.exports = {
  name: 'account.csv',
  columns: ['Username', 'Email', 'Phone Number', 'Language', 'Avatar', 'Sign In Method', 'Created On'],
  query: ({ userId }) => [
    `SELECT
       username                                     AS \`Username\`,
       email                                        AS \`Email\`,
       phone                                        AS \`Phone Number\`,
       language                                     AS \`Language\`,
       avatar                                       AS \`Avatar\`,
       COALESCE(
         NULLIF(TRIM(idp_name), ''),
         CASE WHEN NULLIF(TRIM(phone), '') IS NOT NULL THEN 'Phone' END
       )                                            AS \`Sign In Method\`,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS \`Created On\`
     FROM users
     WHERE id = ?`,
    [userId],
  ],
};
