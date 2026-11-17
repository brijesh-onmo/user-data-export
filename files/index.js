'use strict';
/**
 * Every CSV in the zip, in this order. To add one: create files/<name>.js and list it here.
 *
 * A file definition:
 *  name     file name inside the zip
 *  columns  optional: CSV header + column order (default: keys of first row)
 *  query    (ctx) => [sql, bindings]           raw MySQL, streamed row by row
 *  source   (ctx) => async iterable | array    use instead of `query` for
 *                                              Mongo-only / Redis-only files
 *  enrich   optional async (rows, ctx) => rows
 *           runs once per batch of rows. Do ONE redis/mongo call per batch
 *           (mget / pipeline / $in), never one call per row.
 *
 *  ctx = { userId, event, knex, redis, mongo }
 */
module.exports = [
  require('./account'),
];
