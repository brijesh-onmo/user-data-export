"use strict";
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
 *           runs once per batch of rows. Mongo: one find with $in per batch.
 *           Redis is a cluster, so DON'T use mget (fails when keys are on
 *           different slots). Use Promise.all(keys.map(k => redis.get(k)))
 *           — auto-pipelining batches these per node, so it's still fast.
 *
 *  ctx = { userId, productId, event, knex, redis, mongo }
 */
module.exports = [
  require("./account"),
  require("./profiles"),
  require("./login-history"),
  require("./items"),
  require("./linked-accounts"),
  require("./friends"),
];
