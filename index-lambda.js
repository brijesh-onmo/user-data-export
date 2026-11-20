"use strict";
/**
 * User data export Lambda (handler: index-lambda.handler)
 *
 * Invoke with: { "userId": "<users.id>", "productId": "<products.id>" }  (both required)
 * Produces:    s3://onmo-<ENVIRONMENT>-data/private/user-data-export/<userId>/<exportId>.zip  (one CSV per entry in files/index.js)
 */
const { getConnections } = require("./lib/connections");
const { writeZip } = require("./lib/zip-writer");
const { uploadStream, downloadUrl } = require("./lib/s3");
const config = require("./lib/config");
const FILES = require("./files");

// onmo-data-export-2026-11-17-143205 (UTC) — also the zip's file name the user sees
function makeExportId(now = new Date()) {
  const ts = now.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, ""); // 2026-11-17-143205
  return `onmo-data-export-${ts}`;
}

exports.handler = async (event = {}) => {
  const { userId, productId } = event;
  if (!userId) throw new Error("userId is required");
  if (!productId) throw new Error("productId is required");

  const exportId = makeExportId();
  const key = `${config.exportPrefix}/${userId}/${exportId}.zip`;

  const { knex, redis, mongo, s3 } = await getConnections();
  const ctx = { userId, productId, event, knex, redis, mongo };

  try {
    const files = await uploadStream(s3, key, "application/zip", (out) =>
      writeZip(FILES, ctx, out),
    );
    const url = await downloadUrl(s3, key);

    console.log("export done", { userId, key, files });
    return { exportId, bucket: config.bucket, key, url, files }; // files = { 'account.csv': rowCount, ... }
  } catch (err) {
    console.error("export failed", { userId, productId, exportId, err });
    throw err;
  }
};
