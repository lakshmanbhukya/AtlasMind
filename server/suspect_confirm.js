const { checkDeterministicAmbiguity } = require('./src/services/ambiguityGate');

const mockSchema = {
    collections: [{
        name: 'internships',
        fields: [
            { name: 'stipend', type: 'number' },
            { name: 'duration_weeks', type: 'number' },
            { name: 'slots_available', type: 'number' },
            { name: 'posted_date', type: 'date' }
        ]
    }]
};

const suspects = [
    // Expected: write-intent false positives (should NOT trigger write gate)
    ['dataset statistics',       'EXPECT_CLEAR (false-positive? substring=set)'],
    ['created accounts list',    'EXPECT_CLEAR (false-positive? substring=create)'],
    ['company addresses',        'EXPECT_CLEAR (false-positive? substring=addresses)'],
    ['stock exchange tips',      'EXPECT_CLEAR (false-positive? substring=set/exchange)'],
    ['dropout rate analysis',    'EXPECT_CLEAR'],
    // Expected: date queries that may wrongly get numeric card
    ['latest internship',        'EXPECT_CLEAR (date query, no numeric card wanted)'],
    ['most recent posts',        'EXPECT_CLEAR (date query, no numeric card wanted)'],
    // Expected: false-positive clarification card
    ['total revenue by region',  'EXPECT_CLEAR (explicit metric named)'],
    // Expected: hard positives - ambiguous with NO trigger word
    ['which internships matter most?',  'EXPECT_AMBIGUOUS (no vague term)'],
    ['how are we doing by sector?',     'EXPECT_AMBIGUOUS (no vague term)'],
    // Expected: real WRITE
    ['delete old internships',   'EXPECT_WRITE'],
    ['update the stipend',       'EXPECT_WRITE'],
    // Expected: real AMBIGUOUS with trigger word
    ['top internships by stipend',      'EXPECT_AMBIGUOUS (vague=top)'],
    ['highest paying internships',      'EXPECT_AMBIGUOUS (vague=highest)'],
    // CLEAR: explicit metric
    ['sum of stipend by sector',        'EXPECT_CLEAR (explicit agg named)'],
    ['average duration_weeks per company', 'EXPECT_CLEAR (explicit field named)'],
];

console.log('\n=== DETERMINISTIC GATE SUSPECT CONFIRMATION ===');
console.log('Schema: internship_db.internships (stipend:number, duration_weeks:number, slots_available:number, posted_date:date)\n');

let writeTriggered = 0, clarTriggered = 0, nothingTriggered = 0;

for (const [q, tag] of suspects) {
    const r = checkDeterministicAmbiguity(q, mockSchema);
    const needsClar = r && r.needsClarification;
    // Check write intent separately
    const { hasWriteIntent } = require('./src/services/ambiguityGate');
    const isWrite = hasWriteIntent ? hasWriteIntent(q) : false;

    let outcome;
    if (isWrite) {
        outcome = 'WRITE_INTENT';
        writeTriggered++;
    } else if (needsClar) {
        outcome = 'CLARIFICATION_CARD';
        clarTriggered++;
    } else {
        outcome = 'PASS_THROUGH';
        nothingTriggered++;
    }

    const firstQ = r && r.questions && r.questions[0] ? r.questions[0].question : null;
    console.log(`[${outcome.padEnd(20)}] "${q}"`);
    console.log(`  Tag: ${tag}`);
    if (firstQ) console.log(`  Card asks: "${firstQ}"`);
    console.log();
}

console.log(`Summary: WRITE=${writeTriggered}, CLARIFICATION=${clarTriggered}, PASS_THROUGH=${nothingTriggered}`);
