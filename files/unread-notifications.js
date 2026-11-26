"use strict";
/**
 * Unread notifications (all stored notifications are unread; read ones are removed), newest first.
 * Not filtered by product.
 *
 * Source: Mongo event_data, rule_id = NOTIFICATIONS_RULE_ID, index_id = userId,
 *         data.notifications[] = { id, flowId, product, isCommon, userNotificationType,
 *                                  userNotificationData, createdAt }
 *
 * details: one readable line per type. Other users are shown by username, games by games.title
 * (invitations carry gameTitle). Internal ids (match, tournament, leaderboard, flow), earnedTags and
 * isEndScreenReward are not exported. Unknown/old types: raw data in details + a warning.
 */
const { formatUtc, label } = require("../lib/format");

const NOTIFICATIONS_RULE_ID = "e3b3e7a1-60e6-44e5-9300-b14b9679115d";
const UNKNOWN_USER = "Unknown user";

const toUtc = (v) =>
  v === null || v === undefined || v === "" ? null : formatUtc(new Date(v));
// ' | ' not ', ': game titles can contain commas
const parts = (...p) =>
  p.filter((x) => x !== null && x !== undefined && x !== "").join(" | ") ||
  null;
const idOf = (x) =>
  x && typeof x === "object" && typeof x.id === "string" ? x.id : null;

// the other player in a battle, from this user's point of view
function otherPlayer(d, userId) {
  const host = idOf(d.host);
  const opponent = idOf(d.opponent);
  if (!host && !opponent) return null; // non-battle match (e.g. tournament)
  return host === userId ? opponent : host;
}

function details(n, userId, names, games) {
  const d = n.userNotificationData ?? {};
  const user = (id) => (id ? (names.get(id) ?? UNKNOWN_USER) : null);
  const game = d.gameTitle || games.get(d.gameId) || null;

  switch (n.userNotificationType) {
    case "BATTLE_INVITATION":
      return parts(game, idOf(d.host) && `invited by ${user(idOf(d.host))}`);
    case "BATTLE_WON":
    case "BATTLE_LOST": {
      const other = otherPlayer(d, userId);
      return parts(game, other && `against ${user(other)}`);
    }
    case "BATTLE_EXPIRING":
    case "BATTLE_EXPIRED": {
      const noOpponent = idOf(d.opponent) && idOf(d.opponent) === idOf(d.host); // opponent = host when none
      const other = noOpponent ? null : otherPlayer(d, userId);
      return parts(
        game,
        noOpponent ? "no opponent" : other && `against ${user(other)}`,
        n.userNotificationType === "BATTLE_EXPIRING" && d.expiryTime
          ? `expires ${toUtc(d.expiryTime)}`
          : null,
      );
    }
    case "TOURNAMENT_COMPLETION":
      return parts(
        game,
        d.title,
        d.rank === -1 || d.rank === undefined
          ? "rank unknown"
          : `rank ${d.rank}`,
      );
    case "GLOBAL_LEADERBOARD_ENDED":
      return parts(
        label(d.timeFrame),
        d.endDate && `ended ${toUtc(d.endDate)}`,
        d.rank !== undefined && d.rank !== null ? `rank ${d.rank}` : null,
        d.score !== undefined && d.score !== null ? `score ${d.score}` : null,
      );
    case "ACHIEVEMENT_REWARD":
      return parts(
        label(d.type),
        d.balance !== undefined && d.balance !== null
          ? `tier ${d.balance}`
          : null,
      );
    case "FOLLOWED_BY_USER":
      return idOf(d.followerUser)
        ? `${user(idOf(d.followerUser))} followed you`
        : null;
    case "SUBSCRIPTION_ACTIVATED":
      return null;
    case "SUBSCRIPTION_BONUS_GRANTED":
      return d.bonusDays !== undefined && d.bonusDays !== null
        ? `${d.bonusDays} bonus days`
        : null;
    default:
      console.warn("unread_notifications: unknown notification type", {
        userId,
        type: n.userNotificationType,
      });
      return Object.keys(d).length ? JSON.stringify(d) : null;
  }
}

// user + game ids referenced by the notifications
function referencedIds(notifications) {
  const users = new Set();
  const games = new Set();
  for (const n of notifications) {
    const d = n.userNotificationData ?? {};
    for (const id of [idOf(d.host), idOf(d.opponent), idOf(d.followerUser)])
      if (id) users.add(id);
    if (typeof d.gameId === "string" && d.gameId && !d.gameTitle)
      games.add(d.gameId);
  }
  return { userIds: [...users], gameIds: [...games] };
}

async function lookup(knex, sql, ids, key, value) {
  const map = new Map();
  if (!ids.length) return map;
  const [rows] = await knex.raw(
    sql.replace("?", ids.map(() => "?").join(",")),
    ids,
  );
  for (const r of rows) map.set(r[key], r[value]);
  return map;
}

async function* source({ knex, mongo, userId }) {
  const doc = await mongo
    .collection("event_data")
    .findOne(
      { rule_id: NOTIFICATIONS_RULE_ID, index_id: userId },
      { projection: { _id: 0, "data.notifications": 1 } },
    );
  const notifications = Array.isArray(doc?.data?.notifications)
    ? doc.data.notifications.filter((n) => n && typeof n === "object")
    : [];
  if (!notifications.length) return;

  const { userIds, gameIds } = referencedIds(notifications);
  const [names, games] = await Promise.all([
    lookup(
      knex,
      "SELECT id, username FROM users WHERE id IN (?)",
      userIds,
      "id",
      "username",
    ),
    lookup(
      knex,
      "SELECT id, title FROM games WHERE id IN (?)",
      gameIds,
      "id",
      "title",
    ),
  ]);

  const time = (n) => {
    const t = new Date(n.createdAt).getTime();
    return Number.isNaN(t) ? -Infinity : t;
  };
  const sorted = [...notifications].sort((a, b) => time(b) - time(a)); // newest first

  for (const n of sorted) {
    yield {
      received_at: toUtc(n.createdAt),
      type: label(n.userNotificationType),
      details: details(n, userId, names, games),
    };
  }
}

module.exports = {
  name: "unread_notifications.csv",
  columns: ["received_at", "type", "details"],
  source,
};
