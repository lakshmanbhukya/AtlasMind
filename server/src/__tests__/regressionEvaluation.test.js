const regressionData = require('../data/ambiguity-regression.json');
const { decide } = require('../services/ambiguityGate');

describe('Ambiguity Regression Evaluation Dataset Tests', () => {
    // Representative schema with multiple numerical fields
    const mockSchema = {
        database: 'analytics_db',
        collections: [
            {
                name: 'sales',
                fields: [
                    { name: 'sales_amount', type: 'number', sample: 500 },
                    { name: 'quantity', type: 'int', sample: 10 },
                    { name: 'profit', type: 'number', sample: 120 },
                    { name: 'discount', type: 'number', sample: 15 },
                    { name: 'order_date', type: 'date', sample: '2026-01-01' },
                    { name: 'product_name', type: 'string', sample: 'Widget' },
                    { name: 'category', type: 'string', sample: 'Electronics' },
                ],
            },
        ],
    };

    test('Regression dataset contains 50+ benchmark test cases', () => {
        expect(regressionData.length).toBeGreaterThanOrEqual(50);
    });

    test('Regression evaluation through the gate interface (decide)', () => {
        let correctCount = 0;

        for (const item of regressionData) {
            const decision = decide({ query: item.query, schema: mockSchema });

            if (item.expected === 'WRITE') {
                expect(decision.diagnostics.reason).toBe('write_intent');
                expect(decision.isClarificationPass).toBe(true);
                correctCount++;
            } else if (item.expected === 'AMBIGUOUS') {
                expect(decision.diagnostics.reason).not.toBe('write_intent');
                if (decision.action === 'ask') correctCount++;
            } else if (item.expected === 'CLEAR') {
                expect(decision.diagnostics.reason).not.toBe('write_intent');
                if (decision.action === 'proceed') correctCount++;
            }
        }

        const accuracy = (correctCount / regressionData.length) * 100;
        console.log(`📊 Ambiguity Regression Suite Accuracy: ${accuracy.toFixed(1)}% (${correctCount}/${regressionData.length})`);
        expect(accuracy).toBeGreaterThanOrEqual(90);
    });
});
