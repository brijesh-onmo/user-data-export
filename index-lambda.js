'use strict';
/**
 * User data export Lambda (handler: index.handler)
 *
 * Invoke with: { "userId": "<users.id>", "exportId": "optional-id" }
 * Produces:    s3://$EXPORT_BUCKET/exports/<userId>/<exportId>.zip  (one CSV per entry in files/index.js)
 */
const { getConnections } = require('./lib/connections');
const { writeZip } = require('./lib/zip-writer');
const { uploadStream, downloadUrl } = require('./lib/s3');
const config = require('./lib/config');
const FILES = require('./files');

exports.handler = async (event = {}) => {
  const { userId } = event;
  if (!userId) throw new Error('userId is required');

  const exportId = event.exportId || new Date().toISOString().replace(/[:.]/g, '-');
  const key = `exports/${userId}/${exportId}.zip`;

  const { knex, redis, mongo, s3 } = await getConnections();
  const ctx = { userId, event, knex, redis, mongo };

  try {
    const files = await uploadStream(s3, key, 'application/zip', (out) => writeZip(FILES, ctx, out));
    const url = await downloadUrl(s3, key);

    console.log('export done', { userId, key, files });
    return { bucket: config.bucket, key, url, files }; // files = { 'account.csv': rowCount, ... }
  } catch (err) {
    console.error('export failed', { userId, exportId, err });
    throw err;
  }
};
