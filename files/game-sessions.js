"use strict";
/**
 * Every game session of the user for the input product, newest first, across all profiles.
 *
 * Why it's built this way:
 * - All joins are LEFT JOIN: older sessions have no game_play_id / game_participant_id and must
 *   still be exported.
 * - No publish_status filter: delisted games were still played.
 * - The participant join uses game_sessions.game_participant_id AND user_id, never game_play_id:
 *   in multiplayer modes game_play_id would return other players' rows.
 * - Product: game_plays.product_id. Legacy sessions have no game_play, so they count as
 *   LEGACY_PRODUCT ('onmo') and only appear in ONMO exports.
 * - Rows are streamed from one query (no OFFSET paging), so heavy players don't fill memory.
 *   Point MYSQL_HOST at a read replica. If EXPLAIN shows a filesort on large accounts, consider a
 *   (user_id, created_at, id) index on game_sessions.
 *
 * Deliberately NOT exported:
 * - Cheat detection: cheat_detected; close reason CHEAT_DETECTED shows blank; legacy statuses
 *   CHEATED and REVIEWED show as "Closed".
 * - Internal infra / debugging: edge node, stream/cluster/codec data, device signature,
 *   volatileSpecs, keyboardLayout, isSystemClosed, deprecated columns.
 * - Other users' data: hostUserId, other participants' rows.
 * - Offer configuration: game_plays.payment_modes / payouts (the user's own payment_mode and prize are kept).
 * - IDs: session, game, play and profile ids.
 */
const { label, coinLabel } = require("../lib/format");

const STATUS_LABELS = {
  CREATED: "Not Started",
  PLAYING: "Playing",
  CLOSED: "Closed",
  CHEATED: "Closed", // legacy; not revealing cheat flags
  REVIEWED: "Closed", // legacy
};
const HIDDEN_CLOSE_REASONS = new Set(["CHEAT_DETECTED"]);

// product of legacy sessions (no game_play row)
const LEGACY_PRODUCT = "onmo";

// JSON_UNQUOTE gives the string "null" for a JSON null
const clean = (v) =>
  v === null || v === undefined || v === "" || v === "null" ? null : v;
const yesNo = (v) =>
  v === null || v === undefined ? null : Number(v) === 1 ? "Yes" : "No";

// JSON column -> list of entries (a single object becomes a list of one).
// Returns null for empty, or { raw } when it isn't valid JSON.
function entries(value) {
  if (value === null || value === undefined || value === "") return null;
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { raw: value };
    }
  }
  if (Array.isArray(v)) return v.length ? v : null;
  if (v && typeof v === "object") return Object.keys(v).length ? [v] : null;
  return null;
}
const isObj = (x) => x !== null && typeof x === "object";

/**
 * game_participants.payment_mode (GamePlayPaymentMode):
 *   { type: "coin", coinType, amount, priority } -> "50 Basic"
 *   { type: "subscription", priority }           -> "Subscription"
 *   legacy [{ amount, coinType }]                -> "50 Basic"
 * Unknown shapes are kept as raw JSON so nothing is lost.
 */
function formatPaymentMode(value) {
  const list = entries(value);
  if (!list) return null;
  if (list.raw) return list.raw;
  return list
    .map((x) => {
      if (isObj(x) && x.coinType && x.amount !== undefined)
        return `${x.amount} ${coinLabel(x.coinType)}`;
      if (isObj(x) && x.type === "subscription") return "Subscription";
      return JSON.stringify(x);
    })
    .join("; ");
}

/**
 * game_participants.prize (GameParticipantPrize[]): { walletType, itemType, amount }
 *   coin      -> "20 Gems"
 *   inventory -> inventory title (itemType is the inventory id), "2 x Title" when amount > 1
 *   other     -> "1 Time Played (Achievement)"
 * Unknown shapes are kept as raw JSON.
 */
function formatPrizes(value, inventoryTitles) {
  const list = entries(value);
  if (!list) return null;
  if (list.raw) return list.raw;
  return list
    .map((x) => {
      if (!isObj(x) || x.amount === undefined || !x.itemType)
        return JSON.stringify(x);
      if (x.walletType === "coin")
        return `${x.amount} ${coinLabel(x.itemType)}`;
      if (x.walletType === "inventory") {
        const title = inventoryTitles.get(x.itemType) ?? x.itemType;
        return Number(x.amount) > 1 ? `${x.amount} x ${title}` : title;
      }
      return `${x.amount} ${label(x.itemType)}${x.walletType ? ` (${label(x.walletType)})` : ""}`;
    })
    .join("; ");
}

// inventory ids used as prizes in this batch
function inventoryIds(rows) {
  const ids = new Set();
  for (const r of rows) {
    const list = entries(r.prize);
    if (!list || list.raw) continue;
    for (const x of list)
      if (isObj(x) && x.walletType === "inventory" && x.itemType)
        ids.add(x.itemType);
  }
  return [...ids];
}
const asNumber = (v) => (clean(v) === null ? null : Number(v));

module.exports = {
  name: "game_sessions.csv",
  columns: [
    "started_at",
    "last_updated_at",
    "profile_name",
    "game",
    "game_mode",
    "status",
    "close_reason",
    "duration_seconds",
    "score",
    "result",
    "paid",
    "payment_mode",
    "prizes",
    "device_make",
    "device_model",
    "device_type",
    "device_os",
    "app_version",
    "ip_address",
    "city",
    "region",
    "isp",
    "poor_network_seconds",
  ],

  // JSON_UNQUOTE(JSON_EXTRACT()) instead of ->> so it also runs on MariaDB
  query: ({ userId, productId }) => [
    `SELECT
       DATE_FORMAT(gs.created_at, '%Y-%m-%d %H:%i:%s')                       AS started_at,
       DATE_FORMAT(gs.updated_at, '%Y-%m-%d %H:%i:%s')                       AS last_updated_at,
       p.username                                                            AS profile_name,
       g.title                                                               AS game,
       gs.session_type,
       gs.status,
       JSON_UNQUOTE(JSON_EXTRACT(gp.data, '$.closedReason'))                 AS close_reason,
       gs.time                                                               AS duration_seconds,
       gs.score,
       gpart.result,
       COALESCE(gpart.paid, gs.paid)                                         AS paid,
       gpart.payment_mode,
       gpart.prize,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.deviceInfo.make'))          AS device_make,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.deviceInfo.model'))         AS device_model,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.deviceInfo.type'))          AS device_type,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.deviceInfo.os'))            AS device_os,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.appVersion'))               AS app_version,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.clientNetwork.ip'))         AS ip_address,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.clientNetwork.city'))       AS city,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.clientNetwork.region'))     AS region,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.clientNetwork.isp'))        AS isp,
       JSON_UNQUOTE(JSON_EXTRACT(gs.metadata, '$.poorNetworkSeconds'))       AS poor_network_seconds
     FROM game_sessions gs
     LEFT JOIN game_plays gp
            ON gp.id = gs.game_play_id
     LEFT JOIN game_participants gpart
            ON gpart.id = gs.game_participant_id
           AND gpart.user_id = gs.user_id               -- only this user's own participant row
     LEFT JOIN games g
            ON g.id = gs.app_id
     LEFT JOIN profiles p
            ON p.id = COALESCE(gpart.profile_id, gs.user_id)
           AND p.user_id = gs.user_id
     WHERE gs.user_id = ?
       AND COALESCE(gp.product_id, ?) = ?               -- legacy sessions (no game_play) = 'onmo'
     ORDER BY gs.created_at DESC, gs.id DESC`,
    [userId, LEGACY_PRODUCT, productId],
  ],

  // one inventory lookup per batch, for inventory prizes
  enrich: async (rows, { knex }) => {
    const ids = inventoryIds(rows);
    const inventoryTitles = new Map();
    if (ids.length) {
      const [items] = await knex.raw(
        `SELECT id, title FROM inventory WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
      for (const i of items) inventoryTitles.set(i.id, i.title);
    }

    return rows.map((r) => {
      const closeReason = clean(r.close_reason);
      return {
        started_at: r.started_at,
        last_updated_at: r.last_updated_at,
        profile_name: r.profile_name ?? null,
        game: r.game ?? null,
        game_mode: label(clean(r.session_type)),
        status: STATUS_LABELS[r.status] ?? label(r.status),
        close_reason:
          closeReason && !HIDDEN_CLOSE_REASONS.has(closeReason)
            ? label(closeReason)
            : null,
        duration_seconds: r.duration_seconds ?? null,
        score: r.score ?? null,
        result: label(r.result),
        paid: yesNo(r.paid),
        payment_mode: formatPaymentMode(r.payment_mode),
        prizes: formatPrizes(r.prize, inventoryTitles),
        device_make: clean(r.device_make),
        device_model: clean(r.device_model),
        device_type: clean(r.device_type),
        device_os: clean(r.device_os),
        app_version: clean(r.app_version),
        ip_address: clean(r.ip_address),
        city: clean(r.city),
        region: clean(r.region),
        isp: clean(r.isp),
        poor_network_seconds: asNumber(r.poor_network_seconds),
      };
    });
  },
};
