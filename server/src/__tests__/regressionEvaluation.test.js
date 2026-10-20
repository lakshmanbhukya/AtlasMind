const regressionData = require('../data/ambiguity-regression.json');
const { hasWriteIntent, checkDeterministicAmbiguity } = require('../services/ambiguityGate');

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

    test('Regression evaluation against ambiguity detector', () => {
        let correctCount = 0;
        let totalEvaluated = 0;

        for (const item of regressionData) {
            totalEvaluated++;
            const isWrite = hasWriteIntent(item.query);

            if (item.expected === 'WRITE') {
                expect(isWrite).toBe(true);
                correctCount++;
            } else if (item.expected === 'AMBIGUOUS') {
                // Ambiguous queries should NOT have write intent
                expect(isWrite).toBe(false);
                const ambiguityResult = checkDeterministicAmbiguity(item.query, mockSchema);
                if (ambiguityResult && ambiguityResult.needsClarification) {
                    correctCount++;
                }
            } else if (item.expected === 'CLEAR') {
                expect(isWrite).toBe(false);
                // Clear queries should not trigger false positives
                const ambiguityResult = checkDeterministicAmbiguity(item.query, mockSchema);
                if (!ambiguityResult) {
                    correctCount++;
                }
            }
        }

        const accuracy = (correctCount / totalEvaluated) * 100;
        console.log(`📊 Ambiguity Regression Suite Accuracy: ${accuracy.toFixed(1)}% (${correctCount}/${totalEvaluated})`);
        expect(accuracy).toBeGreaterThanOrEqual(90);
    });
});
