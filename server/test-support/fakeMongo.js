'use strict';

/**
 * A tiny in-memory stand-in for a MongoDB collection, for tests only. It
 * implements the filter and update operators the provider stores use
 * (equality, $ne, $gt/$gte/$lt/$lte, $not, $type, $exists; $set, $setOnInsert,
 * $inc; upsert; unique indexes). Each operation yields once before running and
 * then applies atomically, like a single-document MongoDB write, so parallel
 * calls interleave the way concurrent requests do.
 */

function getPath(doc, path) {
    return path.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), doc);
}

function setPath(doc, path, value) {
    const keys = path.split('.');
    let cur = doc;
    for (const k of keys.slice(0, -1)) {
        if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k];
    }
    cur[keys[keys.length - 1]] = value;
}

const cmp = (v) => (v instanceof Date ? v.valueOf() : v);

function isOperatorObject(cond) {
    return cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)
        && Object.keys(cond).length > 0 && Object.keys(cond).every((k) => k.startsWith('$'));
}

function matchValue(value, cond) {
    if (!isOperatorObject(cond)) return cmp(value) === cmp(cond);
    return Object.entries(cond).every(([op, arg]) => {
        switch (op) {
            case '$ne': return cmp(value) !== cmp(arg);
            case '$gt': return value !== undefined && value !== null && cmp(value) > cmp(arg);
            case '$gte': return value !== undefined && value !== null && cmp(value) >= cmp(arg);
            case '$lt': return value !== undefined && value !== null && cmp(value) < cmp(arg);
            case '$lte': return value !== undefined && value !== null && cmp(value) <= cmp(arg);
            case '$not': return !matchValue(value, arg);
            case '$type': return arg === 'string' ? typeof value === 'string' : false;
            case '$exists': return (value !== undefined) === Boolean(arg);
            default: throw new Error(`fakeMongo: unsupported operator ${op}`);
        }
    });
}

function matches(doc, filter) {
    return Object.entries(filter).every(([path, cond]) => matchValue(getPath(doc, path), cond));
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function createFakeCollection({ unique = [] } = {}) {
    /** @type {Record<string, any>[]} */
    const docs = [];

    function violatesUnique(candidate, self) {
        return unique.some((keys) => docs.some((d) => d !== self
            && keys.every((k) => cmp(getPath(d, k)) === cmp(getPath(candidate, k)))));
    }

    function applyUpdate(doc, update, inserting) {
        for (const [p, v] of Object.entries(update.$set || {})) setPath(doc, p, v);
        if (inserting) for (const [p, v] of Object.entries(update.$setOnInsert || {})) setPath(doc, p, v);
        for (const [p, v] of Object.entries(update.$inc || {})) setPath(doc, p, (getPath(doc, p) || 0) + v);
    }

    return {
        docs,
        createIndex: async () => 'ok',
        async findOne(filter) {
            await tick();
            const doc = docs.find((d) => matches(d, filter));
            return doc ? structuredClone(doc) : null;
        },
        async updateOne(filter, update, options = {}) {
            await tick();
            const doc = docs.find((d) => matches(d, filter));
            if (doc) {
                const next = structuredClone(doc);
                applyUpdate(next, update, false);
                if (violatesUnique(next, doc)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
                Object.keys(doc).forEach((k) => delete doc[k]);
                Object.assign(doc, next);
                return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
            }
            if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
            const fresh = {};
            for (const [p, cond] of Object.entries(filter)) {
                if (!isOperatorObject(cond)) setPath(fresh, p, cond);
            }
            applyUpdate(fresh, update, true);
            if (violatesUnique(fresh, null)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
            docs.push(fresh);
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        },
    };
}

module.exports = { createFakeCollection, matches };
