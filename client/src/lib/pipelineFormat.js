/**
 * Formats an aggregation pipeline as mongosh-style lines:
 *
 *   db.orders.aggregate([
 *     { $match: { status: "paid" } },
 *     { $lookup: {
 *         from: "customers",
 *         ...
 *     } },
 *   ])
 *
 * Each line remembers which top-level stage it belongs to, so turns can mark
 * the write stage or the blocked reference.
 */

const MAX_INLINE = 132;
const EXPANDED_STAGES = new Set(['$lookup', '$graphLookup', '$unionWith', '$facet']);
const BARE_KEY = /^[A-Za-z_$][\w$]*$/;

function formatKey(key) {
  return BARE_KEY.test(key) ? key : JSON.stringify(key);
}

/** One-line JS-ish rendering of a value. */
function formatValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.map(formatValue).join(', ')}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$date') return `ISODate(${JSON.stringify(String(value.$date))})`;
  if (keys.length === 1 && keys[0] === '$oid') return `ObjectId(${JSON.stringify(String(value.$oid))})`;
  if (keys.length === 0) return '{}';
  return `{ ${keys.map((k) => `${formatKey(k)}: ${formatValue(value[k])}`).join(', ')} }`;
}

/**
 * @param {string} collection
 * @param {object[]} pipeline
 * @returns {{ text: string, stageIndex: number|null }[]}
 */
export function formatPipelineLines(collection, pipeline) {
  const stages = Array.isArray(pipeline) ? pipeline : [];
  const coll = collection && BARE_KEY.test(collection) ? `db.${collection}` : `db.getCollection(${JSON.stringify(collection || 'collection')})`;
  const lines = [{ text: `${coll}.aggregate([`, stageIndex: null }];

  stages.forEach((stage, i) => {
    const comma = i < stages.length - 1 ? ',' : '';
    const inline = `  ${formatValue(stage)}${comma}`;
    const keys = stage && typeof stage === 'object' ? Object.keys(stage) : [];
    const op = keys[0];
    const body = op ? stage[op] : undefined;

    // Join stages always expand (one option per line) so a blocked `from` can be marked on its own line.
    const expand = inline.length > MAX_INLINE || EXPANDED_STAGES.has(op);
    if (!expand || keys.length !== 1 || !body || typeof body !== 'object' || Array.isArray(body)) {
      lines.push({ text: inline, stageIndex: i });
      return;
    }

    lines.push({ text: `  { ${formatKey(op)}: {`, stageIndex: i });
    const entries = Object.keys(body);
    entries.forEach((k, j) => {
      const sep = j < entries.length - 1 ? ',' : '';
      lines.push({ text: `      ${formatKey(k)}: ${formatValue(body[k])}${sep}`, stageIndex: i });
    });
    lines.push({ text: `  } }${comma}`, stageIndex: i });
  });

  lines.push({ text: '])', stageIndex: null });
  return lines;
}

/** The pipeline as copyable text. */
export function pipelineToText(collection, pipeline) {
  return formatPipelineLines(collection, pipeline).map((l) => l.text).join('\n');
}

/**
 * Index of the line to mark for a stage, preferring the line that mentions `reference`.
 * @returns {number} -1 when nothing matches
 */
export function findMarkedLine(lines, { stageIndex = null, reference = null } = {}) {
  const needle = reference ? JSON.stringify(String(reference)) : null;
  const bare = reference && BARE_KEY.test(reference) ? reference : null;
  const mentions = (text) => (needle && text.includes(needle)) || (bare && new RegExp(`(^|[^\\w$])${bare.replace(/\$/g, '\\$')}\\b`).test(text));

  if (stageIndex !== null && stageIndex !== undefined) {
    const inStage = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.stageIndex === stageIndex);
    const hit = inStage.find(({ l }) => mentions(l.text));
    if (hit) return hit.i;
    if (inStage.length) return inStage[0].i;
  }
  if (reference) {
    const idx = lines.findIndex((l) => l.stageIndex !== null && mentions(l.text));
    if (idx >= 0) return idx;
  }
  return -1;
}
