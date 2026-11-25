"use strict";
/**
 * THE one place that decides which files apply to which product.
 *
 * Files listed for a product are still in the zip, but header-only (nothing is queried).
 * Products not listed use `default`.
 */
const HEADER_ONLY_FILES = {
  default: ["profiles.csv", "linked_accounts.csv"], // profiles + Steam linking are aaa-only
  aaa: ["friends.csv"], // aaa has no friends
};

function isFileEnabled(fileName, productId) {
  const headerOnly = HEADER_ONLY_FILES[productId] ?? HEADER_ONLY_FILES.default;
  return !headerOnly.includes(fileName);
}

// fails fast on a typo in HEADER_ONLY_FILES (called from files/index.js)
function assertKnownFiles(fileNames) {
  for (const [product, names] of Object.entries(HEADER_ONLY_FILES)) {
    for (const name of names) {
      if (!fileNames.includes(name))
        throw new Error(`HEADER_ONLY_FILES.${product}: unknown file "${name}"`);
    }
  }
}

module.exports = { isFileEnabled, assertKnownFiles, HEADER_ONLY_FILES };
