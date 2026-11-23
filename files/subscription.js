"use strict";
/**
 * The user's current subscription(s) for the input product (user_subscription has one row per
 * user + product + tenant). Plan details from subscription_plans; payment details from
 * subscription_mandates when the current period came from a mandate (type = MANDATE).
 * Gateway IDs, tokens and metadata are deliberately not exported.
 */
const { label } = require("../lib/format");

const TYPE_LABELS = {
  VOUCHER: "Voucher",
  MANDATE: "Mandate",
  ONETIME: "One-time",
};
const GATEWAY_LABELS = {
  RAZORPAY: "Razorpay",
  JUSPAY: "Juspay",
  ONMOPAY: "OnmoPay",
};
const PAYMENT_METHOD_LABELS = {
  upi: "UPI",
  card: "Card",
  emandate: "E-mandate",
  wallet: "Wallet",
};

const mapped = (map, value) =>
  value
    ? (map[value] ?? map[String(value).toUpperCase()] ?? label(value))
    : null;
const yesNo = (v) =>
  v === 1 || v === true ? "Yes" : v === 0 || v === false ? "No" : null;

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// { en: { title }, es: { title } } -> "en: Essential Pass; es: Pase esencial"
function planNames(labels) {
  const parsed = parseJson(labels);
  if (!parsed || typeof parsed !== "object") return null;
  const names = Object.entries(parsed)
    .filter(([, v]) => v?.title)
    .map(([lang, v]) => `${lang}: ${v.title}`);
  return names.length ? names.join("; ") : null;
}

// decimal(12,5) comes back as "4999.00000" -> "4999.00"
const money = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v).toFixed(2);

module.exports = {
  name: "subscription.csv",
  columns: [
    "plan_name",
    "status",
    "subscribed_via",
    "price",
    "currency",
    "plan_duration_days",
    "current_period_start",
    "current_period_end",
    "auto_renew",
    "subscribed_on",
    "payment_provider",
    "payment_method",
    "billing_frequency",
    "mandate_cancelled_on",
  ],

  query: ({ userId, productId }) => [
    `SELECT
       sp.labels,
       us.status,
       us.type,
       sp.plan_amount,
       JSON_UNQUOTE(JSON_EXTRACT(sp.metadata, '$.currency'))  AS currency,
       sp.duration,
       DATE_FORMAT(us.valid_from,  '%Y-%m-%d %H:%i:%s')       AS current_period_start,
       DATE_FORMAT(us.valid_until, '%Y-%m-%d %H:%i:%s')       AS current_period_end,
       us.is_auto_renewing,
       DATE_FORMAT(us.created_at,  '%Y-%m-%d %H:%i:%s')       AS subscribed_on,
       m.gateway,
       m.payment_method,
       m.frequency,
       DATE_FORMAT(m.cancelled_at, '%Y-%m-%d %H:%i:%s')       AS mandate_cancelled_on
     FROM user_subscription us
     LEFT JOIN subscription_plans sp    ON sp.id = us.plan_id
     LEFT JOIN subscription_mandates m  ON us.type = 'MANDATE' AND m.id = us.reference_id
     WHERE us.user_id = ? AND us.product_id = ?
     ORDER BY us.valid_until DESC`,
    [userId, productId],
  ],

  enrich: async (rows) =>
    rows.map((r) => ({
      plan_name: planNames(r.labels),
      status: label(r.status),
      subscribed_via: mapped(TYPE_LABELS, r.type),
      price: money(r.plan_amount),
      currency: r.currency && r.currency !== "null" ? r.currency : null,
      plan_duration_days: r.duration ?? null,
      current_period_start: r.current_period_start,
      current_period_end: r.current_period_end,
      auto_renew: yesNo(r.is_auto_renewing),
      subscribed_on: r.subscribed_on,
      payment_provider: mapped(GATEWAY_LABELS, r.gateway),
      payment_method: mapped(PAYMENT_METHOD_LABELS, r.payment_method),
      billing_frequency: label(r.frequency),
      mandate_cancelled_on: r.mandate_cancelled_on,
    })),
};
