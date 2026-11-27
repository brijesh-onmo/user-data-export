"use strict";
/**
 * Coin transactions + subscription payments in one file, newest first.
 *
 * Coins (item_transactions, wallet_type = 'coin'): all products. amount is stored signed
 *   (debits negative). Status is always Success.
 * Subscription (payment_transactions): ALL products, every status. `product` column filled
 * (productLabel). Coins don't belong to a product, so their `product` is empty.
 *   payment_method comes from the mandate for MANDATE_ACT / MANDATE_REN (by mandate_id, or the
 *   user's latest mandate for that tenant + product created before the payment, since mandate_id
 *   isn't always filled). Vouchers get VOUCHER_PAYMENT_METHOD; one-time payments stay blank.
 *
 * item: what the transaction was for: game title (gameplay), inventory item title (coin
 *   transactions of type 'inventory', via ref_id), or plan title (subscription payments).
 *
 * Merge: subscription payments are few, so they're loaded up front; coin rows are streamed and the
 * payments are slotted in by date (both are formatted as "YYYY-MM-DD HH:MM:SS", so strings compare).
 */
const { label, coinLabel, productLabel } = require("../lib/format");

// coins
const COIN_SOURCE_BY_TYPE = {
  subscription: "Onmopay",
  subscription_cancel: "Onmopay",
};

// subscription payments
const PAYMENT_TYPE_LABELS = {
  MANDATE_ACT: "Autopay Activation",
  MANDATE_REN: "Autopay Renewal",
  ONETIME: "One-time Purchase",
  VOUCHER: "Voucher Redemption",
};
const MANDATE_TYPES = new Set(["MANDATE_ACT", "MANDATE_REN"]);
const GATEWAY_LABELS = { RAZORPAY: "Razorpay", JUSPAY: "Juspay" };
const VOUCHER_PAYMENT_METHOD = "Voucher purchased offline";

const money = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v).toFixed(2);
const jsonText = (v) =>
  v === null || v === undefined || v === "null" ? null : v;

function paidVia(r) {
  if (r.transaction_type === "VOUCHER") return "Voucher";
  if (!r.gateway) return null;
  return GATEWAY_LABELS[String(r.gateway).toUpperCase()] ?? label(r.gateway);
}

function paymentMethod(r) {
  if (r.transaction_type === "VOUCHER") return VOUCHER_PAYMENT_METHOD;
  if (MANDATE_TYPES.has(r.transaction_type))
    return r.mandate_payment_method ?? null; // as stored
  return null; // ONETIME and anything else
}

function paymentRow(r) {
  return {
    product: productLabel(r.product_id),
    date: r.date,
    category: "Subscription",
    type: PAYMENT_TYPE_LABELS[r.transaction_type] ?? label(r.transaction_type),
    amount: money(r.payment_amount),
    currency: jsonText(r.currency),
    status: label(r.status),
    item: jsonText(r.plan_title),
    source: null,
    paid_via: paidVia(r),
    payment_method: paymentMethod(r),
    invoice_number: r.invoice_id ?? null,
    valid_until: r.valid_until,
  };
}

function coinRow(r) {
  return {
    product: null,
    date: r.date,
    category: "Coins",
    type: label(r.transaction_type),
    amount: r.amount,
    currency: coinLabel(r.item_type),
    status: "Success",
    item: r.item ?? null,
    source: COIN_SOURCE_BY_TYPE[r.transaction_type] ?? null,
    paid_via: null,
    payment_method: null,
    invoice_number: null,
    valid_until: null,
  };
}

async function* source({ knex, userId }) {
  const [payments] = await knex.raw(
    `SELECT
       pt.product_id,
       DATE_FORMAT(pt.created_at,  '%Y-%m-%d %H:%i:%s') AS date,
       pt.transaction_type,
       pt.payment_amount,
       pt.status,
       pt.gateway,
       pt.invoice_id,
       DATE_FORMAT(pt.valid_until, '%Y-%m-%d %H:%i:%s') AS valid_until,
       JSON_UNQUOTE(JSON_EXTRACT(sp.labels,   '$.en.title')) AS plan_title,
       JSON_UNQUOTE(JSON_EXTRACT(sp.metadata, '$.currency')) AS currency,
       COALESCE(
         m.payment_method,
         (SELECT m2.payment_method
            FROM subscription_mandates m2
           WHERE m2.user_id = pt.user_id AND m2.tenant_id = pt.tenant_id
             AND m2.product_id = pt.product_id AND m2.created_at <= pt.created_at
           ORDER BY m2.created_at DESC
           LIMIT 1)
       ) AS mandate_payment_method
     FROM payment_transactions pt
     LEFT JOIN subscription_plans sp    ON sp.id = pt.reference_id
     LEFT JOIN subscription_mandates m  ON m.id = pt.mandate_id
     WHERE pt.user_id = ?
     ORDER BY pt.created_at DESC`,
    [userId],
  );

  const coins = knex
    .raw(
      `SELECT
         DATE_FORMAT(t.create_date, '%Y-%m-%d %H:%i:%s') AS date,
         t.transaction_type,
         t.amount,
         t.item_type,
         COALESCE(inv.title, g.title) AS item
       FROM item_transactions t
       LEFT JOIN games g       ON g.id = t.game_id
       LEFT JOIN inventory inv ON t.transaction_type = 'inventory' AND inv.id = t.ref_id
       WHERE t.user_id = ? AND t.wallet_type = 'coin'
       ORDER BY t.create_date DESC, t.sequence DESC`,
      [userId],
    )
    .stream();

  let i = 0;
  for await (const c of coins) {
    while (i < payments.length && payments[i].date >= c.date)
      yield paymentRow(payments[i++]);
    yield coinRow(c);
  }
  while (i < payments.length) yield paymentRow(payments[i++]);
}

module.exports = {
  name: "transactions.csv",
  columns: [
    "product",
    "date",
    "category",
    "type",
    "amount",
    "currency",
    "status",
    "item",
    "source",
    "paid_via",
    "payment_method",
    "invoice_number",
    "valid_until",
  ],
  source,
};
