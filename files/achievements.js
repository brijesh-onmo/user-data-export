"use strict";
/**
 * Achievements: current tier, stored progress and next tier target.
 *
 * Rules (Mongo event_rules, active only): kept when parameters.metadata.achievementType is set.
 *
 *   RULE HIERARCHY — one rule is chosen per achievementType:
 *
 *   Step 1. Exclude rules that don't apply to this user:
 *           - metadata.achievementTenantId is set and is not the user's tenant (users.tenant_id)
 *           - metadata.achievementProductId is set and is not the input productId
 *
 *   Step 2. From what's left, pick the most specific (1 = highest):
 *           1. Tenant + product  both achievementTenantId and achievementProductId set (and matching)
 *           2. Tenant only       achievementTenantId set, no achievementProductId
 *           3. Product only      achievementProductId set, no achievementTenantId
 *           4. Generic           neither set
 *
 *   Step 3. Tie at the same level: the rule with the lowest `id` wins (so the result is repeatable;
 *           Mongo's return order isn't guaranteed).
 *
 *   If no rule survives for an achievementType, that achievement is not exported.
 *
 * Progress (Mongo event_data, index_id = userId): one field of data, chosen by ruleType.
 *   No record -> 0 (same as the API). Unknown ruleType / non-numeric value -> blank progress,
 *   unit "Unknown", warning logged.
 * Current tier (MySQL item_buckets): SUM(balance) of unexpired achievement buckets per type.
 *   WARNING: not product-specific (see the note above the item_buckets query).
 * Next tier target: rewardDistribution sorted by threshold, entry at index currentTier
 *   (tier 0 -> first threshold). Blank when there is no next tier.
 * Only achievements relevant to the user: a progress record or a tier above 0.
 */
const { label } = require("../lib/format");

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

// Rule hierarchy level (see header): 1 = tenant + product, 2 = tenant only, 3 = product only,
// 4 = generic, null = rule doesn't apply to this user
function ruleLevel(meta, tenantId, productId) {
  const ruleTenant = meta.achievementTenantId || null;
  const ruleProduct = meta.achievementProductId || null;
  if (ruleTenant && ruleTenant !== tenantId) return null;
  if (ruleProduct && ruleProduct !== productId) return null;
  if (ruleTenant && ruleProduct) return 1;
  if (ruleTenant) return 2;
  if (ruleProduct) return 3;
  return 4;
}

function pickRules(rules, tenantId, productId) {
  const best = new Map(); // achievementType -> { rule, level }
  for (const rule of rules) {
    const meta = rule.parameters?.metadata ?? {};
    const type = meta.achievementType;
    if (typeof type !== "string" || !type) continue;
    const level = ruleLevel(meta, tenantId, productId);
    if (level === null) continue;
    const current = best.get(type);
    const better =
      !current ||
      level < current.level ||
      (level === current.level && String(rule.id) < String(current.rule.id));
    if (better) best.set(type, { rule, level });
  }
  return best;
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
  if (!record) return { progress: 0, unit: def.unit };
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

async function* source({ knex, mongo, userId, productId }) {
  const [[user]] = await knex.raw("SELECT tenant_id FROM users WHERE id = ?", [
    userId,
  ]);
  const tenantId = user?.tenant_id ?? null;

  const rules = await mongo
    .collection("event_rules")
    .find(
      { active: true },
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
  const selected = pickRules(rules, tenantId, productId);
  if (!selected.size) return;

  const ruleIds = [...selected.values()].map(({ rule }) => rule.id);
  const records = await mongo
    .collection("event_data")
    .find(
      { $or: ruleIds.map((id) => ({ rule_id: id, index_id: userId })) },
      { projection: { _id: 0, rule_id: 1, data: 1 } },
    )
    .toArray();
  const recordByRule = new Map(records.map((r) => [r.rule_id, r]));

  // WARNING: current tier is NOT product-specific. item_buckets has no product column, so the tier is
  // the user's total for the achievementType across all products, while progress and next tier target
  // come from the rule selected for the input product. If the same achievementType has different
  // rules per product, the tier and the target can come from different products' achievements.
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
  for (const [type, { rule }] of selected) {
    const record = recordByRule.get(rule.id);
    const currentTier = tierByType.get(type) ?? 0;
    if (!record && currentTier === 0) continue; // not relevant to this user

    const { progress, unit } = progressFor(rule, record, userId);
    rows.push({
      name: label(type),
      current_tier: currentTier,
      progress,
      progress_unit: unit,
      next_tier_target: nextTarget(rule, currentTier),
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  yield* rows;
}

module.exports = {
  name: "achievements.csv",
  columns: [
    "name",
    "current_tier",
    "progress",
    "progress_unit",
    "next_tier_target",
  ],
  source,
};
