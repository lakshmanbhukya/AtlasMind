/**
 * Small, pure helpers the chat turns use to present results.
 */

const LEADING_VERBS = /^(please\s+)?(show( me)?|list|get|give me|find|display|what (is|are|was|were)|how many|which|count|compute|calculate|plot|chart)\s+/i;
const LEADING_ARTICLES = /^(the|all|my|our)\s+/i;
const MONTHS = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';
const DATE_PHRASES = [
  new RegExp(`\\b(in|for|during)?\\s*${MONTHS}\\s+\\d{4}\\b`, 'gi'),
  new RegExp(`\\b(in|for|during)?\\s*${MONTHS}\\b`, 'gi'),
  /\b(in|for|during)\s+(19|20)\d{2}\b/gi,
  /^(19|20)\d{2}\s+/i,
];

/** "Show October 2026 revenue by region." → "Revenue by region" (falls back to the question). */
export function answerTitle(question) {
  const raw = String(question || '').trim().replace(/[.?!]+$/, '');
  if (!raw) return 'Result';
  let t = raw.replace(LEADING_VERBS, '').replace(LEADING_ARTICLES, '');
  for (const re of DATE_PHRASES) t = t.replace(re, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  if (t.length < 3) t = raw;
  if (t.length > 64) t = `${t.slice(0, 61).trimEnd()}…`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Flattens a Mongo extended-JSON value (`$oid`, `$date`, nested object) to a displayable scalar. */
export function flattenValue(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object') return val.$oid || val.$date || val.name || val._id || JSON.stringify(val);
  return val;
}

/** Label column + numeric columns of a result set (same rules as ChartRenderer). */
export function resultShape(results) {
  if (!Array.isArray(results) || results.length === 0) return { labelKey: null, valueKeys: [], columns: [] };
  const first = results[0];
  const columns = Object.keys(first);
  const valueKeys = columns.filter((k) => typeof first[k] === 'number');
  let labelKey = null;
  if (typeof first._id === 'string' || typeof first._id === 'number' || (first._id && typeof first._id === 'object')) labelKey = '_id';
  if (!labelKey || valueKeys.includes(labelKey)) labelKey = columns.find((k) => typeof first[k] === 'string') || null;
  return { labelKey, valueKeys: valueKeys.filter((k) => k !== labelKey), columns };
}

const MONEY_KEY = /(revenue|sales|amount|total|price|cost|spend|value|gmv|income|paid|profit)/i;

function isMoneyKey(key) {
  return MONEY_KEY.test(String(key || ''));
}

export function formatNumber(n, { money = false } = {}) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '—');
  const digits = Number.isInteger(n) ? 0 : 2;
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return money ? `$${s}` : s;
}

/** $1.28M, $942K, 12.5K */
export function formatCompact(n, { money = false } = {}) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '');
  const abs = Math.abs(n);
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  let out = null;
  for (const [v, u] of units) {
    if (abs >= v) {
      out = `${parseFloat((n / v).toFixed(2))}${u}`;
      break;
    }
  }
  if (!out) out = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return money ? `$${out}` : out;
}

/** Bars for the horizontal bar chart, or null when the result does not suit it. */
export function barSeries(results, chartType) {
  if (chartType && !['bar', 'table'].includes(chartType)) return null;
  if (!Array.isArray(results) || results.length === 0 || results.length > 12) return null;
  const { labelKey, valueKeys } = resultShape(results);
  if (!labelKey || valueKeys.length !== 1) return null;
  const valueKey = valueKeys[0];
  const rows = results.map((r) => ({ label: String(flattenValue(r[labelKey]) ?? '—'), value: Number(r[valueKey]) || 0 }));
  if (rows.some((r) => r.value < 0)) return null;
  return { labelKey, valueKey, rows, money: isMoneyKey(valueKey) };
}

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 7.5, 8, 10];

/** Axis max and 5 ticks (0..max) for a positive maximum. */
export function niceTicks(max, steps = 4) {
  if (!(max > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / steps;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE.find((m) => m * pow >= raw) || 10) * pow;
  const ticks = Array.from({ length: steps + 1 }, (_, i) => i * step);
  return { max: step * steps, ticks };
}

/** Single numeric column → its total, e.g. for "Total $3,449,495". */
export function singleColumnTotal(results) {
  const { valueKeys } = resultShape(results);
  if (valueKeys.length !== 1) return null;
  const key = valueKeys[0];
  const total = results.reduce((sum, r) => sum + (typeof r[key] === 'number' ? r[key] : 0), 0);
  return { key, total, money: isMoneyKey(key) };
}

/** "revenue" → "Revenue", "avg_order_value" → "Avg order value" */
export function humanizeKey(key) {
  const s = String(key || '').replace(/^_id$/, 'value').replace(/[_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Field names a pipeline references ("$total", "$customer.region") — used to code-format the explanation. */
export function pipelineFieldNames(pipeline) {
  const names = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (/^\$[A-Za-z_][\w.]*$/.test(v) && !v.startsWith('$$')) names.add(v.slice(1));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (!k.startsWith('$') && /^[A-Za-z_][\w.]*$/.test(k) && k !== '_id') names.add(k);
        walk(val);
      }
    }
  };
  walk(pipeline);
  return [...names].filter((n) => n.length > 1);
}

export function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function timeLabel(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** First Date value found in a $match (for the approval card's "Cutoff date"). */
export function findMatchDate(pipeline) {
  const stages = Array.isArray(pipeline) ? pipeline : [];
  const isoish = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
  let found = null;
  const walk = (v) => {
    if (found) return;
    if (typeof v === 'string' && isoish.test(v)) {
      found = v;
      return;
    }
    if (v && typeof v === 'object') {
      if (typeof v.$date === 'string') {
        found = v.$date;
        return;
      }
      Object.values(v).forEach(walk);
    }
  };
  for (const s of stages) {
    if (s && s.$match) walk(s.$match);
  }
  if (!found) return null;
  const d = new Date(found);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
}

/** Initials for the profile avatar: "Lakshman Bhukya" → "LB", "analytics_prod" → "AP". */
export function initials(label) {
  const parts = String(label || '').split(/[\s_\-.]+/).filter(Boolean);
  if (parts.length === 0) return 'AM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
