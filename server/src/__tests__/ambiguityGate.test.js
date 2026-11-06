'use strict';

const {
    analyzeAmbiguity,
    checkDeterministicAmbiguity,
    validateClarifications,
    extractNumericFields,
    DEFAULT_VAGUE_TERMS,
} = require('../services/ambiguityGate');

describe('A2: ambiguityGate diagnostics and refinements', () => {
    const multiMetricSchema = {
        database: 'test_db',
        collections: [
            {
                name: 'orders',
                fields: [
                    { name: 'order_id', type: 'string' },
                    { name: 'sales_amount', type: 'number', sample: 120.5 },
                    { name: 'profit', type: 'number', sample: 45.2 },
                    { name: 'quantity', type: 'int', sample: 3 },
                    { name: 'discount', type: 'decimal', sample: 10.0 },
                    { name: 'order_date', type: 'date' },
                ],
            },
        ],
    };

    const singleMetricSchema = {
        database: 'test_db',
        collections: [
            {
                name: 'orders',
                fields: [
                    { name: 'order_id', type: 'string' },
                    { name: 'sales_amount', type: 'number', sample: 120.5 },
                    { name: 'customer_name', type: 'string' },
                ],
            },
        ],
    };

    // 1. Diagnostics reason codes
    describe('analyzeAmbiguity diagnostics reason', () => {
        test('reason is "write_intent" for write queries', () => {
            const { result, diagnostics } = analyzeAmbiguity('delete from orders where id=1', multiMetricSchema);
            expect(result).toBeNull();
            expect(diagnostics.reason).toBe('write_intent');
        });

        test('reason is "lt2_numeric" when schema has < 2 numeric fields', () => {
            const { result, diagnostics } = analyzeAmbiguity('get top orders', singleMetricSchema);
            expect(result).toBeNull();
            expect(diagnostics.reason).toBe('lt2_numeric');
            expect(diagnostics.numericCandidateCount).toBe(1);
        });

        test('reason is "no_vague_term" when query has no vague terms', () => {
            const { result, diagnostics } = analyzeAmbiguity('find all orders for customer John', multiMetricSchema);
            expect(result).toBeNull();
            expect(diagnostics.reason).toBe('no_vague_term');
            expect(diagnostics.matchedTerms).toEqual([]);
        });

        test('reason is "explicit_binding" when compound field is explicitly named as token', () => {
            const { result, diagnostics } = analyzeAmbiguity('show top orders by sales_amount', multiMetricSchema);
            expect(result).toBeNull();
            expect(diagnostics.reason).toBe('explicit_binding');
            expect(diagnostics.explicitBindingFound).toBe(true);
        });

        test('reason is "asked" when query is genuinely ambiguous with 2+ metrics', () => {
            const { result, diagnostics } = analyzeAmbiguity('show me the top products', multiMetricSchema);
            expect(result).not.toBeNull();
            expect(result.needsClarification).toBe(true);
            expect(diagnostics.reason).toBe('asked');
            expect(diagnostics.matchedTerms).toContain('top');
            expect(diagnostics.numericCandidateCount).toBeGreaterThanOrEqual(2);
        });
    });

    // 2. Removal of temporal terms 'recent' and 'latest'
    describe('temporal terms exclusion', () => {
        test('DEFAULT_VAGUE_TERMS contains exact 15 non-temporal terms as a Set', () => {
            expect(DEFAULT_VAGUE_TERMS).toBeInstanceOf(Set);
            expect(DEFAULT_VAGUE_TERMS.size).toBe(15);
            expect(DEFAULT_VAGUE_TERMS.has('top')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('best')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('highest')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('lowest')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('largest')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('smallest')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('most')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('least')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('popular')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('performance')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('sales')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('revenue')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('growth')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('worst')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('biggest')).toBe(true);
            expect(DEFAULT_VAGUE_TERMS.has('recent')).toBe(false);
            expect(DEFAULT_VAGUE_TERMS.has('latest')).toBe(false);
        });

        test('queries with only "recent" or "latest" do not trigger ambiguity', () => {
            const recentRes = analyzeAmbiguity('show recent orders', multiMetricSchema);
            expect(recentRes.result).toBeNull();
            expect(recentRes.diagnostics.reason).toBe('no_vague_term');

            const latestRes = analyzeAmbiguity('get latest orders', multiMetricSchema);
            expect(latestRes.result).toBeNull();
            expect(latestRes.diagnostics.reason).toBe('no_vague_term');
        });
    });

    // 3. isMetricCandidate integration in extractNumericFields
    describe('isMetricCandidate in extractNumericFields', () => {
        test('excludes id-like and year-like numeric fields from candidate metrics', () => {
            const schemaWithIdAndYear = {
                collections: [
                    {
                        name: 'sales',
                        fields: [
                            { name: 'year', type: 'int', sample: 2024 },
                            { name: 'customerId', type: 'int', sample: 101 },
                            { name: 'revenue', type: 'number', sample: 5000 },
                        ],
                    },
                ],
            };
            const candidates = extractNumericFields(schemaWithIdAndYear);
            const fieldNames = candidates.map((c) => c.field);
            expect(fieldNames).toContain('revenue');
            expect(fieldNames).not.toContain('year');
            expect(fieldNames).not.toContain('customerId');
        });
    });

    // 4. Whole-token matching for compound names vs plain names
    describe('queryAlreadyNamesSpecificField binding rules', () => {
        const schemaWithPlainAndCompound = {
            collections: [
                {
                    name: 'items',
                    fields: [
                        { name: 'price', type: 'number' },
                        { name: 'sales_amount', type: 'number' },
                    ],
                },
            ],
        };

        test('plain name like "price" in query suppresses ambiguity via inline proximity or "by price"', () => {
            // "top price items" has vague term "top" followed directly by leaf metric "price"
            const res = analyzeAmbiguity('top price items', schemaWithPlainAndCompound);
            expect(res.diagnostics.reason).toBe('explicit_binding');

            // With "by price", it also suppresses
            const byRes = analyzeAmbiguity('top items by price', schemaWithPlainAndCompound);
            expect(byRes.diagnostics.reason).toBe('explicit_binding');
        });

        test('compound name "sales_amount" suppresses as a standalone token', () => {
            const res = analyzeAmbiguity('top items with sales_amount', schemaWithPlainAndCompound);
            expect(res.diagnostics.reason).toBe('explicit_binding');
        });
    });

    // 5. validateClarifications rejects values not in OFFERED options
    describe('validateClarifications with offered options', () => {
        const offeredQuestions = [
            {
                id: 'metric',
                options: [
                    { value: 'sales_amount', label: 'Sales Amount' },
                    { value: 'profit', label: 'Profit' },
                    { value: '__other__', label: 'Other' },
                ],
            },
        ];

        test('accepts offered option', () => {
            const res = validateClarifications(
                [{ id: 'metric', value: 'sales_amount' }],
                multiMetricSchema,
                offeredQuestions
            );
            expect(res.valid).toBe(true);
            expect(res.sanitized[0].value).toBe('sales_amount');
        });

        test('rejects schema field that was NOT among offered options', () => {
            // "discount" is in multiMetricSchema, but NOT in offeredQuestions
            const res = validateClarifications(
                [{ id: 'metric', value: 'discount' }],
                multiMetricSchema,
                offeredQuestions
            );
            expect(res.valid).toBe(false);
            expect(res.errors[0]).toContain('not among the offered options');
        });

        test('allows valid schema field via __other__ customText', () => {
            const res = validateClarifications(
                [{ id: 'metric', value: '__other__', customText: 'discount' }],
                multiMetricSchema,
                offeredQuestions
            );
            expect(res.valid).toBe(true);
            expect(res.sanitized[0].value).toBe('discount');
        });
    });

    // 6. Enhanced binding heuristic (C2+BindFix)
    describe('enhanced binding heuristic (C2+BindFix)', () => {
        const mflixSchema = {
            collections: [
                {
                    name: 'movies',
                    fields: [
                        { name: 'runtime', type: 'number' },
                        { name: 'tomatoes.rotten', type: 'number' },
                        { name: 'tomatoes.fresh', type: 'number' },
                        { name: 'imdb.rating', type: 'number' },
                        { name: 'imdb.votes', type: 'number' },
                        { name: 'awards.wins', type: 'number' },
                    ],
                },
            ],
        };

        const suppliesSchema = {
            collections: [
                {
                    name: 'sales',
                    fields: [
                        { name: 'items.price', type: 'number' },
                        { name: 'items.quantity', type: 'number' },
                        { name: 'customer.age', type: 'number' },
                        { name: 'customer.satisfaction', type: 'number' },
                    ],
                },
            ],
        };

        test('handles "at least" without falsely matching vague term "least"', () => {
            // "at least" is an idiomatic collocation, so "least" is stripped or resolved to null
            const res = analyzeAmbiguity('Show transactions with at least one item priced at 40.01.', suppliesSchema, { enableBindFix: true });
            expect(res.result).toBeNull();
            expect(res.diagnostics.reason === 'no_vague_term' || res.diagnostics.explicitBindingFound === true).toBe(true);
        });

        test('handles compound field tomatoes.rotten via spaced and reversed names', () => {
            const res1 = analyzeAmbiguity('Find films with highest Rotten Tomatoes rotten count', mflixSchema, { enableBindFix: true });
            expect(res1.result).toBeNull();
            expect(res1.diagnostics.reason).toBe('explicit_binding');

            const res2 = analyzeAmbiguity('Find movies with highest rotten tomatoes count', mflixSchema, { enableBindFix: true });
            expect(res2.result).toBeNull();
            expect(res2.diagnostics.reason).toBe('explicit_binding');
        });

        test('handles explicit bounds on numeric fields (e.g., rating of 4, aged 42)', () => {
            const res1 = analyzeAmbiguity('Retrieve transactions with a customer satisfaction rating of 4.', suppliesSchema, { enableBindFix: true });
            expect(res1.result).toBeNull();

            const res2 = analyzeAmbiguity('Show purchases made by male customers who are 42 years old.', suppliesSchema, { enableBindFix: true });
            expect(res2.result).toBeNull();
        });

        test('handles leaf token with metric descriptor (e.g., quantity purchased, price values)', () => {
            const res1 = analyzeAmbiguity('Find the 3 items with the highest quantity purchased.', suppliesSchema, { enableBindFix: true });
            expect(res1.result).toBeNull();
            expect(res1.diagnostics.reason).toBe('explicit_binding');

            const res2 = analyzeAmbiguity('Identify the 3 items with the largest price values.', suppliesSchema, { enableBindFix: true });
            expect(res2.result).toBeNull();
            expect(res2.diagnostics.reason).toBe('explicit_binding');
        });

        test('preserves genuine ambiguity when no explicit field or bound is provided', () => {
            const res = analyzeAmbiguity('Which items have the highest sales?', suppliesSchema, { enableBindFix: true });
            expect(res.result).not.toBeNull();
            expect(res.result.needsClarification).toBe(true);
            expect(res.diagnostics.reason).toBe('asked');
        });
    });
});
