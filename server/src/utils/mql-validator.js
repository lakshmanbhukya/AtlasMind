/**
 * Basic MQL Safety Validator.
 * Prevents destructive commands from being executed via MQL generation.
 */

// List of exact properties that are strictly forbidden.
const FORBIDDEN_KEYS = [
  'drop', 'dropDatabase', 'dropCollection', 'dropIndex', 'dropIndexes',
  'createIndex', 'createIndexes',
  'delete', 'deleteMany', 'deleteOne', 'findOneAndDelete', 'findAndModify',
  'update', 'updateMany', 'updateOne', 'findOneAndUpdate', 'replaceOne',
  'insert', 'insertMany', 'insertOne',
  'renameCollection', 'eval', '$out', '$merge'
];

/**
 * Validates the MQL to ensure it's a read-only query.
 * Throws an error if a forbidden operation is detected.
 * 
 * @param {Object} mqlObject - The parsed JSON Object representing the generated MQL.
 * @returns {boolean} True if the MQL is safe to execute.
 */
function validateMqlSafety(mqlObject) {
  if (!mqlObject || typeof mqlObject !== 'object') {
    return false;
  }

  // 1. Ensure operation is purely read-only (find or aggregate)
  if (!['find', 'aggregate'].includes(mqlObject.operation)) {
    console.warn(`[VALIDATOR] Blocked operation: ${mqlObject.operation}`);
    return false;
  }

  // 2. Validate the query object recursively for forbidden keys or aggregation stages
  const isSafe = checkProperties(mqlObject.query || {});
  if (!isSafe) {
    return false;
  }

  return true;
}

/**
 * Recursively checks keys in an object or array to ensure no forbidden operations exist.
 */
function checkProperties(obj) {
  if (!obj || typeof obj !== 'object') return true;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (!checkProperties(item)) return false;
    }
    return true;
  }

  for (const [key, value] of Object.entries(obj)) {
    // Check if key itself is heavily forbidden
    if (FORBIDDEN_KEYS.includes(key)) {
      console.warn(`[VALIDATOR] Blocked due to forbidden key: ${key}`);
      return false;
    }

    // Check string values that might be trying to execute JavaScript via $where
    if (key === '$where') {
      console.warn(`[VALIDATOR] Blocked $where clause`);
      return false;
    }

    // Recursively check deeper nested objects
    if (typeof value === 'object') {
      if (!checkProperties(value)) return false;
    }
  }

  return true;
}

module.exports = {
  validateMqlSafety
};
