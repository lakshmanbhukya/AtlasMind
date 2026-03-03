/**
 * Unit tests for systemPrompt.js
 */
const { buildSystemPrompt } = require('../src/prompts/systemPrompt');

describe('buildSystemPrompt', () => {
    const sampleSchema = 'Database: testdb\nCollection: sales (1000 docs)\nFields:\n  - amount (number) e.g. 99.99';

    // ── Core prompt structure ───────────────────────────────────
    describe('core structure', () => {
        it('includes the AggregatorFlow NLP identity', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            expect(prompt).toContain('AggregatorFlow NLP');
        });

        it('includes the schema context', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            expect(prompt).toContain('sales (1000 docs)');
            expect(prompt).toContain('amount (number)');
        });

        it('includes output format requirements', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            expect(prompt).toContain('"pipeline"');
            expect(prompt).toContain('"collection"');
            expect(prompt).toContain('"chartType"');
        });

        it('includes chart type selection rules', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            expect(prompt).toContain('bar');
            expect(prompt).toContain('line');
            expect(prompt).toContain('pie');
            expect(prompt).toContain('area');
            expect(prompt).toContain('table');
        });

        it('includes safety rules', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            expect(prompt).toContain('NEVER');
            expect(prompt).toContain('read-only');
        });

        it('includes pipeline construction rules', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            expect(prompt).toContain('$match');
            expect(prompt).toContain('$group');
            expect(prompt).toContain('$sort');
        });
    });

    // ── Date context ────────────────────────────────────────────
    describe('date context', () => {
        it('includes today\'s date', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            const todayStr = new Date().toISOString().split('T')[0];
            expect(prompt).toContain(todayStr);
        });

        it('includes current month', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            const currentMonth = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
            expect(prompt).toContain(currentMonth);
        });
    });

    // ── Few-shot examples ───────────────────────────────────────
    describe('few-shot examples', () => {
        it('includes examples when provided', () => {
            const examples = [
                {
                    natural_language: 'Show total sales by region',
                    mql_pipeline: [{ $group: { _id: '$region', total: { $sum: '$amount' } } }],
                    collection: 'sales',
                    chart_type: 'bar',
                },
            ];
            const prompt = buildSystemPrompt(sampleSchema, examples);
            expect(prompt).toContain('Reference Examples');
            expect(prompt).toContain('Show total sales by region');
            expect(prompt).toContain('sales');
        });

        it('does not include examples section when empty', () => {
            const prompt = buildSystemPrompt(sampleSchema, []);
            expect(prompt).not.toContain('Reference Examples');
        });

        it('handles string mql_pipeline in examples', () => {
            const examples = [
                {
                    natural_language: 'Count docs',
                    mql_pipeline: '[{"$count": "total"}]',
                    collection: 'items',
                },
            ];
            const prompt = buildSystemPrompt(sampleSchema, examples);
            expect(prompt).toContain('Count docs');
            expect(prompt).toContain('[{"$count": "total"}]');
        });

        it('defaults chart_type and collection in examples', () => {
            const examples = [
                { natural_language: 'Test query', mql_pipeline: [] },
            ];
            const prompt = buildSystemPrompt(sampleSchema, examples);
            expect(prompt).toContain('sample_sales'); // default collection
            expect(prompt).toContain('bar'); // default chart type
        });

        it('numbers multiple examples correctly', () => {
            const examples = [
                { natural_language: 'Query 1', mql_pipeline: [], collection: 'a' },
                { natural_language: 'Query 2', mql_pipeline: [], collection: 'b' },
                { natural_language: 'Query 3', mql_pipeline: [], collection: 'c' },
            ];
            const prompt = buildSystemPrompt(sampleSchema, examples);
            expect(prompt).toContain('Example 1');
            expect(prompt).toContain('Example 2');
            expect(prompt).toContain('Example 3');
        });
    });

    // ── Returns a string ────────────────────────────────────────
    it('returns a non-empty string', () => {
        const prompt = buildSystemPrompt(sampleSchema, []);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(100);
    });
});
