"use strict";
/**
 * Login history across ALL products (not filtered by the input product), newest first,
 * with a `product` column (aaa -> Onmoplus, onmo -> Onmo, ca -> Challenges Arena).
 *
 * 1. Redis — check-ins not yet synced to MySQL, read for every product in the `products` table
 *    (same list the sync job iterates). Built the same way the sync job (syncUserCheckinsToDB)
 *    builds MySQL rows: one row per IP in the user's set, all with the user's last check-in time
 *    for that product. The job deletes the set after inserting, so nothing here is in MySQL yet.
 *    Country / user agent / device don't exist in Redis -> blank.
 * 2. MySQL — every user_checkins row of the user.
 *
 * Merge: Redis rows are few, so they're loaded up front and slotted into the streamed MySQL rows
 * by time. (Per product they're always newer than MySQL, but across products they interleave.)
 */
const { formatUtc, productLabel } = require("../lib/format");

const checkinDataKey = (productId, userId) =>
  `{data}:{userCheckinData}:${productId}:${userId}`;
const checkinTimeKey = (productId) => `{data}:{userCheckinTime}:${productId}`;

// Redis member is '{"ip":"1.2.3.4"}'
function ipFromMember(member) {
  try {
    return JSON.parse(member).ip ?? null;
  } catch {
    return member;
  }
}

// user_agent is a JSON column holding a string, e.g. "\"Mozilla/5.0 ...\""
function userAgentText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return JSON.stringify(value);
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      /* not JSON, use as is */
    }
  }
  return value;
}

// pending check-ins for every product, newest first
async function redisRows(knex, redis, userId) {
  const [products] = await knex.raw("SELECT id FROM products ORDER BY id");
  const perProduct = await Promise.all(
    products.map(async ({ id: productId }) => {
      const [members, lastCheckin] = await Promise.all([
        redis.smembers(checkinDataKey(productId, userId)),
        redis.zscore(checkinTimeKey(productId), userId),
      ]);
      const time =
        lastCheckin === null || lastCheckin === undefined
          ? null
          : Number(lastCheckin);
      return members.map((m) => ({ productId, ip: ipFromMember(m), time }));
    }),
  );
  // missing time sorts first (it can't be placed by date)
  return perProduct
    .flat()
    .sort((a, b) => (b.time ?? Infinity) - (a.time ?? Infinity));
}

async function* source({ knex, redis, userId }) {
  const pending = await redisRows(knex, redis, userId);
  const pendingRow = (p) => ({
    product: productLabel(p.productId),
    ip_address: p.ip,
    timestamp: formatUtc(p.time),
    country: null,
    user_agent: null,
    device: null,
  });

  const rows = knex
    .raw(
      `SELECT product, ip, time, country, user_agent, device
         FROM user_checkins
        WHERE user_id = ?
        ORDER BY time DESC, id DESC`,
      [userId],
    )
    .stream();

  let i = 0;
  for await (const r of rows) {
    const time = Number(r.time);
    while (i < pending.length && (pending[i].time ?? Infinity) >= time)
      yield pendingRow(pending[i++]);
    yield {
      product: productLabel(r.product),
      ip_address: r.ip,
      timestamp: formatUtc(r.time),
      country: r.country,
      user_agent: userAgentText(r.user_agent),
      device: r.device,
    };
  }
  while (i < pending.length) yield pendingRow(pending[i++]);
}

module.exports = {
  name: "login_history.csv",
  columns: [
    "product",
    "ip_address",
    "timestamp",
    "country",
    "user_agent",
    "device",
  ],
  source,
};
