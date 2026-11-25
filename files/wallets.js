"use strict";
/**
 * Coin balances (item_buckets, wallet_type = 'coin'), one row per amount so no number can be
 * misread as expiring:
 *
 *   coin_type,entry,amount,expires_at
 *   Spendable Gems,Total balance,100,
 *   Spendable Gems,Does not expire,95,
 *   Spendable Gems,Expires,5,2026-12-01 00:00:00
 *
 * - "Total balance": one per coin type.
 * - "Does not expire": one per coin type, only when that amount is above 0.
 * - "Expires": one per expiry date, buckets with the same date added together, soonest first.
 *
 * Only unexpired buckets with a positive balance count. The check is the expiry DATE, not
 * is_expiration_processed: expired buckets keep their balance after the expiry job runs.
 * Coin types the user has no balance in don't appear. Not product specific (no product column).
 */
const { coinLabel } = require("../lib/format");

const num = (v) => (v === null || v === undefined ? null : Number(v)); // SUM() comes back as a string

const LIVE_COIN_BUCKETS = `
       FROM item_buckets
      WHERE user_id = ?
        AND wallet_type = 'coin'
        AND balance > 0
        AND (expiry_date IS NULL OR expiry_date > NOW())`;

async function* source({ knex, userId }) {
  const [totals] = await knex.raw(
    `SELECT item_type,
            SUM(balance)                                                   AS total,
            SUM(CASE WHEN expiry_date IS NULL THEN balance ELSE 0 END)     AS non_expiring
     ${LIVE_COIN_BUCKETS}
      GROUP BY item_type
      ORDER BY item_type`,
    [userId],
  );

  const [expiries] = await knex.raw(
    `SELECT item_type,
            DATE_FORMAT(expiry_date, '%Y-%m-%d %H:%i:%s')                  AS expires_at,
            SUM(balance)                                                   AS amount
     ${LIVE_COIN_BUCKETS}
        AND expiry_date IS NOT NULL
      GROUP BY item_type, expiry_date
      ORDER BY item_type, expiry_date`,
    [userId],
  );

  const expiriesByType = new Map();
  for (const e of expiries) {
    if (!expiriesByType.has(e.item_type)) expiriesByType.set(e.item_type, []);
    expiriesByType.get(e.item_type).push(e);
  }

  for (const t of totals) {
    const coin_type = coinLabel(t.item_type);
    yield {
      coin_type,
      entry: "Total balance",
      amount: num(t.total),
      expires_at: null,
    };
    if (num(t.non_expiring) > 0) {
      yield {
        coin_type,
        entry: "Does not expire",
        amount: num(t.non_expiring),
        expires_at: null,
      };
    }
    for (const e of expiriesByType.get(t.item_type) ?? []) {
      yield {
        coin_type,
        entry: "Expires",
        amount: num(e.amount),
        expires_at: e.expires_at,
      };
    }
  }
}

module.exports = {
  name: "wallets.csv",
  columns: ["coin_type", "entry", "amount", "expires_at"],
  source,
};
