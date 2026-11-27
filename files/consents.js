"use strict";
/**
 * Consents across ALL products and tenants (Mongo `consents`), newest first, with a `product` column.
 *
 * Document URL: MySQL documents.assets is keyed by language -> { url, version }.
 * We use the asset for the consent's language. assets only holds the current version, so if
 * the user consented to a different version, the version segment in the URL path
 * (/<lang>/v<N>/) is swapped for the consented one.
 */
const {
  formatUtc,
  label,
  sourceLabel,
  productLabel,
} = require("../lib/format");

function parseAssets(assets) {
  if (!assets) return {};
  if (typeof assets === "string") {
    try {
      return JSON.parse(assets);
    } catch {
      return {};
    }
  }
  return assets;
}

function documentUrl(consent, assetsById) {
  const doc = consent.document;
  if (!doc?.id) return null;
  const asset = assetsById.get(doc.id)?.[consent.language];
  if (!asset?.url) return null;

  const consented =
    doc.version === undefined || doc.version === null
      ? null
      : String(doc.version);
  if (consented === null || String(asset.version) === consented)
    return asset.url;
  return asset.url.replace(
    new RegExp(`/v${asset.version}/`),
    `/v${consented}/`,
  );
}

module.exports = {
  name: "consents.csv",
  columns: [
    "product",
    "consented_on",
    "category",
    "purpose",
    "action",
    "document_url",
    "shown_text",
    "language",
    "source",
  ],

  source: ({ mongo, userId }) =>
    mongo
      .collection("consents")
      .find(
        { userId },
        {
          projection: {
            _id: 0,
            productId: 1,
            category: 1,
            purpose: 1,
            action: 1,
            source: 1,
            consentText: 1,
            language: 1,
            document: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 }),

  // one documents lookup per batch of consents
  enrich: async (consents, { knex }) => {
    const ids = [
      ...new Set(consents.map((c) => c.document?.id).filter(Boolean)),
    ];
    const assetsById = new Map();
    if (ids.length) {
      const [docs] = await knex.raw(
        `SELECT id, assets FROM documents WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
      for (const d of docs) assetsById.set(d.id, parseAssets(d.assets));
    }

    return consents.map((c) => ({
      product: productLabel(c.productId),
      consented_on: formatUtc(c.createdAt),
      category: label(c.category),
      purpose: label(c.purpose),
      action: label(c.action),
      document_url: documentUrl(c, assetsById),
      shown_text: c.consentText ?? null,
      language: c.language ?? null,
      source: sourceLabel(c.source),
    }));
  },
};
