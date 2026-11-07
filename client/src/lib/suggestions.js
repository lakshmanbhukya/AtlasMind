/**
 * Starter questions for the empty state, derived from the connected schema
 * (collection and field names). Falls back to generic prompts.
 */

const FALLBACK_SUGGESTIONS = [
  { text: 'Show total sales by region', icon: 'bar' },
  { text: 'Find top 10 customers by order value', icon: 'table' },
  { text: 'Analyze monthly revenue trends', icon: 'line' },
  { text: 'Count documents by status', icon: 'list' },
];

const MEASURE = /(revenue|sales|amount|total|price|cost|spend|value|quantity|qty|units|score|duration|count)/i;
const CATEGORY = /(status|type|category|region|country|channel|segment|carrier|tier|state|city|plan|source)/i;
const DATE = /(created|date|time|at$|on$|placed|ordered|signup|joined)/i;

const human = (s) =>
  String(s)
    .split('.')
    .pop()
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();

function pick(fields, type, re, prefer = []) {
  const typed = fields.filter((f) => f.type === type && !f.name.includes('.'));
  for (const p of prefer) {
    const hit = typed.find((f) => f.name.toLowerCase() === p);
    if (hit) return hit;
  }
  return typed.find((f) => re.test(f.name)) || null;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const singular = (s) => (s.endsWith('ies') ? `${s.slice(0, -3)}y` : s.endsWith('s') ? s.slice(0, -1) : s);
const GENERIC_MEASURE = /^(total|amount|value|price|cost)$/i;

/** "total" on orders → "order total"; "revenue" stays "revenue". */
function measureName(collHuman, measure) {
  const m = human(measure.name);
  return GENERIC_MEASURE.test(measure.name) ? `${singular(collHuman)} ${m}` : m;
}

/**
 * @param {{ collections?: Array<{ name: string, documentCount?: number, fields?: Array<{ name: string, type: string }> }> }} schema
 * @param {number} [max=4]
 * @returns {{ text: string, icon: 'bar'|'line'|'table'|'list' }[]}
 */
export function suggestionsFromSchema(schema, max = 4, now = new Date()) {
  const collections = (schema?.collections || [])
    .filter((c) => !c.name.startsWith('system.'))
    .sort((a, b) => (b.documentCount || 0) - (a.documentCount || 0));
  const out = [];
  const seen = new Set();
  const add = (text, icon) => {
    if (!seen.has(text) && out.length < max) {
      seen.add(text);
      out.push({ text, icon });
    }
  };

  for (const c of collections) {
    const fields = c.fields || [];
    const measure = pick(fields, 'number', MEASURE, ['revenue', 'total', 'amount']);
    const grouping = pick(fields, 'string', CATEGORY, ['region', 'country', 'channel', 'category']);
    const status = pick(fields, 'string', CATEGORY, ['status', 'type', 'state', 'category']);
    const date = pick(fields, 'date', DATE) || fields.find((f) => f.type === 'date');
    const coll = human(c.name);

    if (measure && grouping) add(cap(`${measureName(coll, measure)} by ${human(grouping.name)}`), 'bar');
    if (date) add(`${cap(coll)} per month in ${now.getFullYear()}`, 'line');
    if (measure) add(`Top 10 ${coll} by ${human(measure.name)}`, 'table');
    if (status && status !== grouping) add(`${cap(coll)} by ${human(status.name)}`, 'list');
    if (out.length >= max) break;
  }

  for (const f of FALLBACK_SUGGESTIONS) add(f.text, f.icon);
  return out;
}
