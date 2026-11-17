'use strict';
const { PassThrough } = require('stream');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('./config');

/**
 * Gives `write(stream)` a writable stream that uploads to S3 as data arrives.
 * Resolves with whatever `write` returned, once the upload is complete.
 */
async function uploadStream(s3, key, contentType, write) {
  const body = new PassThrough();
  const upload = new Upload({
    client: s3,
    params: { Bucket: config.bucket, Key: key, Body: body, ContentType: contentType },
  });
  const uploaded = upload.done();
  uploaded.catch(() => {}); // awaited below

  try {
    const result = await write(body);
    await uploaded;
    return result;
  } catch (err) {
    body.destroy();
    await upload.abort().catch(() => {});
    throw err;
  }
}

function downloadUrl(s3, key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
    expiresIn: config.linkExpirySeconds,
  });
}

module.exports = { uploadStream, downloadUrl };
