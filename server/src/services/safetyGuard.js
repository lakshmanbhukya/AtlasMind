// @ts-check
/**
 * Safety Guard — validates generated MQL pipelines before execution.
 *
 * Blocks destructive write operations ($out, $merge, $delete, $drop, $set for writes).
 * Recursively enforces the stage allowlist on nested stages ($facet, $lookup.pipeline, $unionWith.pipeline).
 * Validates document-form $lookup.from ({ coll, [db] }) by checking database and collection separately.
 * Rejects malformed or unsupported forms safely (fail-closed).
 * Injects a result limit if none is present.
 *
 * NOTE: $replaceRoot and $replaceWith are intentionally ALLOWED — they are
 * read-only reshaping stages, not write operations.
 */

const { classifyExecution, describeWrite } = require('./safety/verdict');
const { describeCollectionBlock, validateCollectionName } = require('./safety/names');
const { validatePipeline } = require('./safety/pipeline');

module.exports = {
    classifyExecution,
    describeCollectionBlock,
    describeWrite,
    validatePipeline,
    validateCollectionName,
};
