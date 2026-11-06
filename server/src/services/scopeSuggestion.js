'use strict';

/**
 * Rank a tenant's collections by how relevant they look to a question.
 * Pure: no I/O, so it is tested directly.
 *
 * Signals: collection name mention (+50) or singular mention (+35), a field
 * name matching a question word (+15 per field), and use in similar past
 * queries from Few-Shot Memory (+25 per example). Scores cap at 100.
 *
 * @param {string} question
 * @param {{ collections?: Array<{ name: string, fields?: Array<{ name: string }> }> }} schema
 * @param {Array<{ collection?: string }>} [examples=[]]
 * @returns {Array<{ collection: string, score: number, reasons: string[] }>} best first; zero scores omitted
 */
function suggestCollections(question, schema, examples = []) {
    const qLower = String(question || '').toLowerCase();
    const words = qLower.split(/[^a-z0-9_]+/).filter((w) => w.length > 2);
    const scores = new Map();

    const entryFor = (name) => {
        if (!scores.has(name)) scores.set(name, { collection: name, score: 0, reasons: new Set() });
        return scores.get(name);
    };

    for (const col of (schema && schema.collections) || []) {
        const cName = col.name.toLowerCase();
        const entry = entryFor(col.name);

        if (qLower.includes(cName)) {
            entry.score += 50;
            entry.reasons.add(`Direct collection name mention ("${col.name}")`);
        } else {
            const singular = cName.replace(/s$/, '');
            if (singular.length > 3 && qLower.includes(singular)) {
                entry.score += 35;
                entry.reasons.add(`Collection singular match ("${singular}")`);
            }
        }

        for (const field of col.fields || []) {
            const fName = field.name.toLowerCase();
            if (words.some((word) => fName === word || fName.includes(word))) {
                entry.score += 15;
                entry.reasons.add(`Field match ("${field.name}")`);
            }
        }
    }

    for (const ex of examples) {
        if (ex.collection && scores.has(ex.collection)) {
            const entry = entryFor(ex.collection);
            entry.score += 25;
            entry.reasons.add('Used in similar previous queries');
        }
    }

    return Array.from(scores.values())
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((s) => ({
            collection: s.collection,
            score: Math.min(s.score, 100),
            reasons: Array.from(s.reasons),
        }));
}

module.exports = { suggestCollections };
