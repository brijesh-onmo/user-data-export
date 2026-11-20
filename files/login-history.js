"use strict";
/**
 * Login history for one product, newest first.
 *
 * 1. Redis — check-ins not yet synced to MySQL. Built the same way the sync job
 *    (syncUserCheckinsToDB) builds MySQL rows: one row per IP in the user's set, all with
 *    the user's last check-in time. The job deletes the set after inserting, so nothing
 *    here is in MySQL yet. Country / user agent / device don't exist in Redis -> blank.
 * 2. MySQL — user_checkins for the user + product.
 *
 * Redis rows are always the newest, so emitting them first keeps the file newest-first.
 */
const { formatUtc } = require("../lib/format");

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

async function* source({ knex, redis, userId, productId }) {
  // 1. Pending in Redis
  const [members, lastCheckin] = await Promise.all([
    redis.smembers(checkinDataKey(productId, userId)),
    redis.zscore(checkinTimeKey(productId), userId),
  ]);
  const timestamp = formatUtc(lastCheckin);
  for (const member of members) {
    yield {
      ip_address: ipFromMember(member),
      timestamp,
      country: null,
      user_agent: null,
      device: null,
    };
  }

  // 2. Synced to MySQL
  const rows = knex
    .raw(
      `SELECT ip, time, country, user_agent, device
         FROM user_checkins
        WHERE user_id = ? AND product = ?
        ORDER BY time DESC, id DESC`,
      [userId, productId],
    )
    .stream();

  for await (const r of rows) {
    yield {
      ip_address: r.ip,
      timestamp: formatUtc(r.time),
      country: r.country,
      user_agent: userAgentText(r.user_agent),
      device: r.device,
    };
  }
}

module.exports = {
  name: "login_history.csv",
  columns: ["ip_address", "timestamp", "country", "user_agent", "device"],
  source,
};
