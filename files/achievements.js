"use strict";
/**
 * Achievements: current tier, stored progress and next tier target. NOT product or tenant specific.
 *
 * 1. Rules: every rule in Mongo event_rules with a parameters.metadata.achievementType, ACTIVE OR
 *    INACTIVE (a rule switched off doesn't erase the user's progress).
 * 2. Progress: the user's event_data records for all of those rules (index_id = userId), one query.
 *    Every rule the user has a record for becomes a row. product = the rule's
 *    metadata.achievementProductId (productLabel), empty for generic rules.
 *    The progress value is one field of data, chosen by ruleType. Unknown ruleType / non-numeric
 *    value -> blank progress, unit "Unknown", warning logged.
 * 3. Current tier: MySQL item_buckets, SUM(balance) of unexpired achievement buckets per type.
 * 4. Tier-only: an achievementType with a tier but no progress record for any rule still gets a row
 *    (name + tier; product, progress and target empty).
 *
 * Next tier target: the rule's rewardDistribution sorted by threshold, entry at index currentTier
 * (tier 0 -> first threshold). Blank when there is no next tier.
 *
 * WARNING: current tier is NOT product-specific. item_buckets has no product column, so the tier is
 * the user's total for the achievementType across all products. If the user has records for several
 * rules of the same type (e.g. an aaa rule and a generic one), each row shows the same tier, and each
 * row's next target applies that shared tier to its own rule's thresholds.
 */
const { label, productLabel } = require("../lib/format");

const PROGRESS = {
  REWARD_FOR_PLAY: { unit: "Plays", value: (d) => d.playCount },
  REWARD_FOR_WIN: { unit: "Wins", value: (d) => d.winCount },
  REWARD_FOR_LOGIN: { unit: "Days", value: (d) => d.loginStreak },
  TRACK_BATTLE_STREAK: {
    unit: "Consecutive wins",
    value: (d) => d.battleStreak,
  },
  REWARD_FOR_TIME_PLAYED: {
    unit: "Seconds",
    value: (d) => d.timePlayedInSeconds,
  },
  REWARD_FOR_VIEW_CONTENT: { unit: "Views", value: (d) => d.viewCount },
  REWARD_FOR_LEADERBOARD: {
    unit: "Qualifying leaderboard finishes",
    value: (d) => d.qualifiedCount,
  },
  REWARD_FOR_FOLLOWERS: {
    unit: "Followers",
    value: (d) => listLength(d.userFollowers),
  },
  CHALLENGE_COMPLETION: {
    unit: "Challenges",
    value: (d) => listLength(d.momentIds),
  },
  GAME_CHALLENGE_COMPLETION: {
    unit: "Completed games",
    value: (d) => listLength(d.completedGameIds),
  },
};

const MALFORMED = Symbol("malformed");
function listLength(v) {
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v.length : MALFORMED;
}

function progressFor(rule, record, userId) {
  const def = PROGRESS[rule.ruleType];
  if (!def) {
    console.warn("achievements: unknown ruleType", {
      userId,
      ruleId: rule.id,
      ruleType: rule.ruleType,
    });
    return { progress: null, unit: "Unknown" };
  }
  const v = def.value(record.data ?? {});
  if (v === undefined || v === null) return { progress: 0, unit: def.unit };
  if (v === MALFORMED || typeof v !== "number" || !Number.isFinite(v)) {
    console.warn("achievements: malformed progress value", {
      userId,
      ruleId: rule.id,
      ruleType: rule.ruleType,
    });
    return { progress: null, unit: "Unknown" };
  }
  return { progress: v, unit: def.unit };
}

function nextTarget(rule, currentTier) {
  const tiers = (rule.parameters?.rewardDistribution ?? [])
    .filter((t) => typeof t?.threshold === "number")
    .sort((a, b) => a.threshold - b.threshold);
  return tiers[currentTier]?.threshold ?? null;
}

async function* source({ knex, mongo, userId }) {
  // 1. every achievement rule, active or not
  const rules = await mongo
    .collection("event_rules")
    .find(
      { "parameters.metadata.achievementType": { $type: "string", $ne: "" } },
      {
        projection: {
          _id: 0,
          id: 1,
          ruleType: 1,
          "parameters.metadata": 1,
          "parameters.rewardDistribution": 1,
        },
      },
    )
    .toArray();
  const ruleById = new Map(rules.filter((r) => r.id).map((r) => [r.id, r]));

  // 2. the user's progress records for those rules
  const records = ruleById.size
    ? await mongo
        .collection("event_data")
        .find(
          { index_id: userId, rule_id: { $in: [...ruleById.keys()] } },
          { projection: { _id: 0, rule_id: 1, data: 1 } },
        )
        .toArray()
    : [];

  // 3. current tier per achievement type (all products)
  const [buckets] = await knex.raw(
    `SELECT item_type, SUM(balance) AS current_tier
       FROM item_buckets
      WHERE user_id = ?
        AND wallet_type = 'achievement'
        AND (expiry_date IS NULL OR expiry_date > NOW())
        AND balance > 0
      GROUP BY item_type`,
    [userId],
  );
  const tierByType = new Map(
    buckets.map((b) => [b.item_type, Number(b.current_tier)]),
  );

  const rows = [];
  const typesWithRows = new Set();

  for (const record of records) {
    const rule = ruleById.get(record.rule_id);
    if (!rule) continue;
    const meta = rule.parameters?.metadata ?? {};
    const type = meta.achievementType;
    const currentTier = tierByType.get(type) ?? 0;
    const { progress, unit } = progressFor(rule, record, userId);
    typesWithRows.add(type);
    rows.push({
      product: productLabel(meta.achievementProductId || null),
      name: label(type),
      current_tier: currentTier,
      progress,
      progress_unit: unit,
      next_tier_target: nextTarget(rule, currentTier),
    });
  }

  // 4. tier but no progress record for any rule of that type
  for (const [type, currentTier] of tierByType) {
    if (typesWithRows.has(type) || !(currentTier > 0)) continue;
    rows.push({
      product: null,
      name: label(type),
      current_tier: currentTier,
      progress: null,
      progress_unit: null,
      next_tier_target: null,
    });
  }

  rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.product ?? "").localeCompare(b.product ?? ""),
  );
  yield* rows;
}

module.exports = {
  name: "achievements.csv",
  columns: [
    "product",
    "name",
    "current_tier",
    "progress",
    "progress_unit",
    "next_tier_target",
  ],
  source,
};
