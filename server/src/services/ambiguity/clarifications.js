// @ts-check
/** Ambiguity Gate: validating clarification questions and answers, and building the enriched query. */

const { toLabel } = require('./vagueTerms');

/**
 * Validate an LLM-returned clarification questions array against structural rules
 * and the actual database schema (fail-open safety).
 *
 * Rules enforced:
 *  - 1 to 3 questions maximum
 *  - Each question has id, question, and 2–4 real options (+ optional __other__)
 *  - Option values (other than __other__) must exist in schemaObject when schema fields exist
 *
 * @param {Array} questions
 * @param {Record<string, any>|null} schemaObject
 * @returns {{ valid: boolean, questions: Array, reason?: string }}
 */
function validateModelClarification(questions, schemaObject = null) {
    if (!Array.isArray(questions) || questions.length === 0) {
        return { valid: false, questions: [], reason: 'questions must be a non-empty array' };
    }

    if (questions.length > 3) {
        return { valid: false, questions: [], reason: 'too many clarification questions (max 3)' };
    }

    const allFieldNames = new Set();
    if (schemaObject?.collections) {
        for (const col of schemaObject.collections) {
            for (const field of col.fields || []) {
                allFieldNames.add(field.name);
            }
        }
    }

    const normalizedQuestions = [];

    for (const q of questions) {
        if (!q || typeof q.id !== 'string' || typeof q.question !== 'string' || !Array.isArray(q.options)) {
            return { valid: false, questions: [], reason: 'malformed question structure' };
        }

        const realOptions = q.options.filter((o) => o && typeof o.value === 'string' && o.value !== '__other__');
        if (realOptions.length < 2 || realOptions.length > 4) {
            return { valid: false, questions: [], reason: 'each question must have between 2 and 4 schema options' };
        }

        // Verify all option values exist in schema if schema has fields
        if (allFieldNames.size > 0) {
            for (const opt of realOptions) {
                if (!allFieldNames.has(opt.value)) {
                    return {
                        valid: false,
                        questions: [],
                        reason: `invented schema field "${opt.value}" in clarification options`,
                    };
                }
            }
        }

        const sanitizedOptions = realOptions.map((opt, idx) => ({
            value: opt.value,
            label: typeof opt.label === 'string' && opt.label.trim() ? opt.label.trim() : toLabel(opt.value),
            ...(opt.recommended || idx === 0 ? { recommended: Boolean(opt.recommended || idx === 0) } : {}),
        }));

        // Ensure at least one option is marked recommended
        if (!sanitizedOptions.some((o) => o.recommended)) {
            sanitizedOptions[0].recommended = true;
        }

        sanitizedOptions.push({ value: '__other__', label: 'Other (type it)' });

        normalizedQuestions.push({
            id: q.id,
            question: q.question,
            type: q.type === 'multiple' || q.type === 'multi' ? 'multiple' : 'single',
            options: sanitizedOptions,
        });
    }

    return { valid: true, questions: normalizedQuestions };
}

const MAX_MULTI_VALUES = 10;

/**
 * Validate incoming clarification answers against the live schema and offered options.
 * Rejects prompt-injection attempts by requiring all values (including custom "Other" text)
 * to resolve to real schema field names, and rejects values not in offered options when provided.
 *
 * @param {Array<{ id: string, value: string, customText?: string }>} clarifications
 * @param {Record<string, any>} schemaObject - The raw profileSchema() result
 * @param {Array<Record<string, any>>|Record<string, any>} [offeredQuestions=null] - Optional list of offered questions/options
 * @returns {{ valid: boolean, sanitized: Array, errors: string[] }}
 */
function validateClarifications(clarifications, schemaObject, offeredQuestions = null) {
    if (!Array.isArray(clarifications) || clarifications.length === 0) {
        return { valid: false, sanitized: [], errors: ['clarifications must be a non-empty array'] };
    }

    let questionsList = null;
    if (offeredQuestions) {
        questionsList = Array.isArray(offeredQuestions)
            ? offeredQuestions
            : (Array.isArray(offeredQuestions.questions) ? offeredQuestions.questions : null);
    }

    // Build lookup maps of known schema field names and their human labels
    const allFieldNames = new Set();
    const labelToFieldMap = new Map();
    if (schemaObject?.collections) {
        for (const col of schemaObject.collections) {
            for (const field of col.fields || []) {
                allFieldNames.add(field.name);
                labelToFieldMap.set(field.name.toLowerCase(), field.name);
                labelToFieldMap.set(toLabel(field.name).toLowerCase(), field.name);
            }
        }
    }

    const sanitized = [];
    const errors = [];

    for (const c of clarifications) {
        // Multi-select answer: validate every entry exactly like a single value.
        if (c && typeof c.id === 'string' && Array.isArray(c.value)) {
            const entries = c.value;
            if (entries.length === 0 || entries.length > MAX_MULTI_VALUES || entries.some((v) => typeof v !== 'string')) {
                errors.push(`Invalid multi-select clarification for "${c.id}": expected 1-${MAX_MULTI_VALUES} strings`);
                continue;
            }
            const sub = validateClarifications(
                entries.map((v) => ({ id: c.id, value: v, customText: v === '__other__' ? c.customText : undefined })),
                schemaObject,
                offeredQuestions
            );
            if (!sub.valid) {
                errors.push(...sub.errors);
                continue;
            }
            const values = Array.from(new Set(
                sub.sanitized.map((s) => s.value).filter((v) => v && v !== '__other__')
            ));
            if (values.length === 0) {
                sanitized.push({ id: sub.sanitized[0].id, value: '__other__', customText: '' });
            } else {
                sanitized.push({ id: sub.sanitized[0].id, value: values });
            }
            continue;
        }

        // Structural check
        if (!c || typeof c.id !== 'string' || typeof c.value !== 'string') {
            errors.push(`Invalid clarification entry: ${JSON.stringify(c)}`);
            continue;
        }

        const cleanId = c.id.trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (!cleanId) {
            errors.push('Invalid clarification id');
            continue;
        }

        const rawValue = c.value.trim();

        // Handle __other__ escape hatch: if customText is provided, validate customText against schema
        if (rawValue === '__other__') {
            const custom = typeof c.customText === 'string' ? c.customText.trim() : '';
            if (!custom) {
                sanitized.push({ id: cleanId, value: '__other__', customText: '' });
                continue;
            }
            const resolvedCustom = allFieldNames.has(custom)
                ? custom
                : labelToFieldMap.get(custom.toLowerCase());
            if (!resolvedCustom) {
                errors.push(`Custom clarification value "${custom}" is not a valid schema field`);
                continue;
            }
            sanitized.push({ id: cleanId, value: resolvedCustom });
            continue;
        }

        // When offered options are provided, reject values that were not offered
        if (questionsList) {
            const targetQ = questionsList.find((q) => q && q.id === cleanId);
            if (targetQ && Array.isArray(targetQ.options)) {
                const offeredValues = new Set(
                    targetQ.options
                        .map((opt) => opt && opt.value)
                        .filter((v) => v && v !== '__other__')
                );
                const offeredLabels = new Set(
                    targetQ.options
                        .map((opt) => opt && opt.label && opt.label.toLowerCase())
                        .filter(Boolean)
                );
                const matchesValue = offeredValues.has(rawValue);
                const matchesLabel = offeredLabels.has(rawValue.toLowerCase());
                if (!matchesValue && !matchesLabel) {
                    errors.push(`Clarification value "${rawValue}" was not among the offered options for question "${cleanId}"`);
                    continue;
                }
            }
        }

        // Strict allowlist: value MUST match an exact schema field name or its human-readable label
        const resolvedField = allFieldNames.has(rawValue)
            ? rawValue
            : labelToFieldMap.get(rawValue.toLowerCase());

        if (!resolvedField) {
            errors.push(`Clarification value "${rawValue}" is not a valid schema field`);
            continue;
        }

        sanitized.push({ id: cleanId, value: resolvedField });
    }

    return {
        valid: errors.length === 0,
        sanitized,
        errors,
    };
}

/**
 * Build an enriched query string from the original query + sanitized clarifications.
 * Only schema-approved field values are injected — __other__ entries are excluded.
 *
 * The resulting string is safe to pass to the LLM as the user message.
 *
 * @param {string} originalQuery
 * @param {Array<{ id: string, value: string, customText?: string }>} sanitizedClarifications
 * @returns {string}
 */
function buildEnrichedQuery(originalQuery, sanitizedClarifications) {
    if (!sanitizedClarifications || sanitizedClarifications.length === 0) {
        return originalQuery;
    }

    const clarificationLines = sanitizedClarifications
        .filter((c) => c.value && c.value !== '__other__' && !(Array.isArray(c.value) && c.value.length === 0))
        .map((c) => `${c.id}:\n${Array.isArray(c.value) ? c.value.join(', ') : c.value}`);

    if (clarificationLines.length === 0) return originalQuery;

    return `${originalQuery}\n\nValidated user clarification:\n\n${clarificationLines.join('\n\n')}`;
}

module.exports = {
    buildEnrichedQuery,
    validateClarifications,
    validateModelClarification,
};
