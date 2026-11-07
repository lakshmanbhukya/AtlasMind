/**
 * Static demo content for the landing page. Nothing here comes from a
 * live cluster; every card that shows it is labelled "demo data".
 */

export const LINKS = {
  github: 'https://github.com/lakshmanbhukya/AtlasMind',
  liveDemo: 'https://atlasmind19.netlify.app/',
  architecture: 'https://lakshmanbhukya.github.io/AtlasMind/',
  benchmark: 'https://github.com/lakshmanbhukya/AtlasMind/tree/research/ambiguity-eval',
  docsBase: 'https://github.com/lakshmanbhukya/AtlasMind/blob/main/',
};

export const NAV_SECTIONS = [
  { id: 'product', label: 'Product' },
  { id: 'safety', label: 'Safety' },
  { id: 'models', label: 'Models' },
  { id: 'source', label: 'Open source' },
];

/* ── Hero answer card ───────────────────────────────────────────── */

export const HERO_QUESTIONS = {
  answer: 'Show October 2026 sales by region using order date.',
  clarify: 'Now compare monthly sales.',
  schema: 'Schema context used for this answer',
  saved: 'Pinned to Regional sales overview',
};

export const HERO_TABS = [
  { id: 'answer', label: 'Answer' },
  { id: 'clarify', label: 'Clarification' },
  { id: 'schema', label: 'Schema context' },
  { id: 'saved', label: 'Saved results' },
];

export const REGION_SALES = [
  { label: 'North America', value: 428400 },
  { label: 'Europe', value: 312600 },
  { label: 'Asia Pacific', value: 246000 },
  { label: 'Latin America', value: 198000 },
];
export const REGION_SCALE = 500000;
export const REGION_TOTAL = 1185000;

export const HERO_STAGES = ['$match', '$group', '$sort', '$project'];

export const HERO_PIPELINE = `[
  { $match: { ordered_at: {
      $gte: ISODate("2026-10-01"),
      $lt:  ISODate("2026-11-01") } } },
  { $group: { _id: "$region",
      sales: { $sum: "$amount" } } },
  { $sort: { sales: -1 } },
  { $project: { _id: 0,
      region: "$_id", sales: 1 } }
]`;

export const HERO_METRICS = [
  { label: 'Execution time', value: '184 ms' },
  { label: 'Result rows', value: '4' },
  { label: 'Model confidence', value: '96%' },
  { label: 'Model', value: 'gpt-oss-120b', code: true },
];

export const SCHEMA_FIELDS = [
  { field: '_id', type: 'objectId', sample: '6720b1f3a91c…', usedIn: null },
  { field: 'region', type: 'string', sample: '"Europe"', usedIn: '$group' },
  { field: 'amount', type: 'double', sample: '184.50', usedIn: '$sum' },
  { field: 'ordered_at', type: 'date', sample: '2026-10-14T09:12:00Z', usedIn: '$match' },
  { field: 'paid_at', type: 'date', sample: '2026-10-15T17:40:00Z', usedIn: null },
  { field: 'status', type: 'string', sample: '"shipped"', usedIn: null },
];

export const SAVED_RESULTS = [
  { title: 'October sales by region', rows: 4, pinned: 'Pinned Nov 6', icon: 'bar' },
  { title: 'Top 10 customers by order value', rows: 10, pinned: 'Pinned Nov 4', icon: 'table' },
  { title: 'Monthly active customers 2026', rows: 10, pinned: 'Pinned Oct 29', icon: 'line' },
  { title: 'Orders by status, last 30 days', rows: 5, pinned: 'Pinned Oct 22', icon: 'pie' },
];

/* ── Clarification section ──────────────────────────────────────── */

export const CLARIFY_FIELDS = [
  { id: 'ordered_at', recommended: true },
  { id: 'paid_at', recommended: false },
];

export const MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

/** Bar heights as % of the 1.2M axis, plus the printed value, per date field. */
export const MONTHLY_SALES = {
  ordered_at: [
    { pct: 85.1, label: '1.02M' },
    { pct: 88.7, label: '1.06M' },
    { pct: 92.7, label: '1.11M' },
    { pct: 91.5, label: '1.10M' },
    { pct: 98.75, label: '1.19M' },
  ],
  paid_at: [
    { pct: 83.7, label: '1.00M' },
    { pct: 87.6, label: '1.05M' },
    { pct: 93.4, label: '1.12M' },
    { pct: 89.95, label: '1.08M' },
    { pct: 96.9, label: '1.16M' },
  ],
};

export const clarifyPipeline = (field) => `{ $group: {
    _id: { $month: "$${field}" },
    sales: { $sum: "$amount" } } },
{ $match: { ${field}: {
    $gte: ISODate("2026-06-01"),
    $lt:  ISODate("2026-11-01") } } }`;

export const CHOICE_TYPES = [
  { term: 'Single choice', desc: 'date fields, grouping keys' },
  { term: 'Multi-select', desc: 'statuses, regions to include' },
  { term: 'Other', desc: 'a field you type in' },
];

/* ── Execution path ─────────────────────────────────────────────── */

export const SCENARIOS = [
  { id: 'read', label: 'Read-only query' },
  { id: 'blocked', label: 'Blocked operator' },
  { id: 'write', label: 'Write request' },
];

export const PATH_STAGES = [
  {
    name: 'Schema profile',
    icon: 'database',
    desc: 'Collections in scope are sampled for field names, BSON types and example values before any MQL is written.',
  },
  {
    name: 'Few-shot examples',
    icon: 'library',
    desc: 'Similar past questions and their working pipelines are added to the prompt.',
  },
  {
    name: 'Clarification',
    icon: 'help',
    desc: 'Ambiguous questions pause here until you choose an option or accept the recommended assumption.',
  },
  {
    name: 'Generated MQL',
    icon: 'braces',
    desc: 'The selected model writes an aggregation pipeline grounded in the profiled fields.',
  },
  {
    name: 'AST validation',
    icon: 'shield',
    desc: 'Every stage and operator is parsed and checked against the safety policy before anything reaches your database.',
  },
  {
    name: 'Execution',
    icon: 'zap',
    desc: "The validated pipeline runs against your cluster with your session's connection.",
  },
  {
    name: 'Result',
    icon: 'chart',
    desc: 'Rows become a chart or table you can pin to a dashboard or export as JSON or CSV.',
  },
];
export const KEY_STAGE = 4;

export const SCHEMA_PROFILE_ROWS = [
  { collection: 'orders', fields: 'region · amount · ordered_at · paid_at · status' },
  { collection: 'customers', fields: 'name · segment · country · created_at' },
  { collection: 'products', fields: 'sku · category · price · stock' },
];

export const GENERATED_MQL = `[{ $match: { ordered_at: { $gte: …, $lt: … } } },
 { $group: { _id: "$region", sales: { $sum: "$amount" } } },
 { $sort: { sales: -1 } },
 { $project: { _id: 0, region: "$_id", sales: 1 } }]`;

/* ── Models & voice ─────────────────────────────────────────────── */

export const VOICE_TRANSCRIPT = 'What were total refunds by product category last quarter?';

export const REFUNDS = [
  { label: 'Electronics', value: 48200 },
  { label: 'Home', value: 31700 },
  { label: 'Apparel', value: 27900 },
  { label: 'Beauty', value: 12400 },
];
export const REFUND_SCALE = 60250;

/* ── Open source ────────────────────────────────────────────────── */

export const DOCS_LEFT = [
  { title: 'Architecture', path: 'docs/ARCHITECTURE.md' },
  { title: 'Setup', path: 'docs/SETUP.md' },
  { title: 'Features', path: 'docs/FEATURES.md' },
];
export const DOCS_RIGHT = [
  { title: 'API', path: 'docs/API.md' },
  { title: 'Development', path: 'docs/DEVELOPMENT.md' },
  { title: 'Deployment', path: 'docs/DEPLOYMENT.md' },
  { title: 'Troubleshooting', path: 'docs/TROUBLESHOOTING.md' },
];

export const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
