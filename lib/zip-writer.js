'use strict';
// Streams every file definition into one zip: rows -> batch -> enrich -> CSV -> zip entry.
const { once } = require('events');
const archiver = require('archiver');
const { stringify } = require('csv-stringify');
const config = require('./config');

async function* inBatches(iterable, size) {
  let batch = [];
  for await (const row of iterable) {
    batch.push(row);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

function rowsFor(file, ctx) {
  if (file.source) return file.source(ctx);
  const [sql, bindings = []] = file.query(ctx);
  return ctx.knex.raw(sql, bindings).stream();
}

function csvStream(file) {
  return stringify({
    header: true,
    columns: file.columns,
    cast: {
      date: (v) => v.toISOString(),
      boolean: (v) => String(v),
      object: (v) => (v && v._bsontype ? String(v) : JSON.stringify(v)), // ObjectId -> hex string
    },
  });
}

async function addCsv(archive, file, ctx) {
  const csv = csvStream(file);
  const entryDone = once(archive, 'entry'); // archiver writes entries one at a time
  archive.append(csv, { name: file.name });

  let count = 0;
  for await (const batch of inBatches(rowsFor(file, ctx), config.batchSize)) {
    const rows = file.enrich ? await file.enrich(batch, ctx) : batch;
    for (const row of rows) {
      if (!csv.write(row)) await once(csv, 'drain'); // backpressure
      count++;
    }
  }
  csv.end();
  await entryDone;
  return count;
}

/**
 * Writes all files as CSVs into a zip piped to `out` (any writable stream).
 * Returns { 'account.csv': rowCount, ... }
 */
async function writeZip(files, ctx, out) {
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(out);

  const archiveFailed = new Promise((_, reject) => archive.once('error', reject));
  archiveFailed.catch(() => {});

  const counts = {};
  try {
    for (const file of files) {
      counts[file.name] = await Promise.race([addCsv(archive, file, ctx), archiveFailed]);
    }
    await archive.finalize();
  } catch (err) {
    archive.abort();
    throw err;
  }
  return counts;
}

module.exports = { writeZip };
