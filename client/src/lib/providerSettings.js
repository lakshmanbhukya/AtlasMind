import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from './models';

/**
 * Provider settings (GET /api/provider-settings) → what the UI shows: who pays,
 * what is left of the AtlasMind allowance, and which models may be picked.
 * Pure (no `window`, no `import.meta.env`), so node unit tests can import it.
 */

/** The payer to send as `expectedPayer`: only once settings have loaded. */
export function expectedPayerOf(settings) {
    return settings?.mode === 'managed' || settings?.mode === 'personal' ? settings.mode : undefined;
}

/** 18400 → "18K", 950 → "950", 1_250_000 → "1.3M". */
export function formatTokens(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1000) return `${Math.floor(n / 1000)}K`;
    return String(Math.max(0, Math.round(n)));
}

/** 540 → "9 min", 45 → "45 s". */
export function formatAudioSeconds(s) {
    if (typeof s !== 'number' || !Number.isFinite(s)) return '';
    if (s >= 60) return `${Math.floor(s / 60)} min`;
    return `${Math.max(0, Math.round(s))} s`;
}

/** An ISO instant as a local 24-hour clock time ("05:30"); '' when it is not a date. */
export function formatClock(iso, locale) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** An ISO instant as a short local date ("Nov 29"); '' when it is not a date. */
export function formatShortDate(iso, locale) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * The sidebar's payer summary.
 * @returns {{ payer: 'managed' | 'personal', title: string, detail: string, exhausted: boolean } | null}
 */
export function payerSummary(settings, locale) {
    if (!settings) return null;
    if (settings.mode === 'personal') {
        const until = formatShortDate(settings.keyExpiresAt, locale);
        return {
            payer: 'personal',
            title: settings.keyLast4 ? `Your Groq key (…${settings.keyLast4})` : 'Your Groq key',
            detail: until ? `Active until ${until}` : 'Active for this sign-in',
            exhausted: false,
        };
    }
    const a = settings.managedAllowance || {};
    const reset = formatClock(a.resetAt, locale);
    let detail;
    let exhausted = false;
    if (a.mode === 'off') {
        detail = 'Shared AtlasMind key';
    } else if (a.tokensRemaining == null || a.audioSecondsRemaining == null) {
        detail = 'Usage unavailable right now';
    } else {
        exhausted = a.tokensRemaining <= 0;
        const parts = [`${formatTokens(a.tokensRemaining)} tokens`, `${formatAudioSeconds(a.audioSecondsRemaining)} voice left`];
        detail = parts.join(' / ') + (reset ? `, resets ${reset}` : '');
    }
    return { payer: 'managed', title: 'AtlasMind allowance', detail, exhausted };
}

/**
 * The models the composer offers: AVAILABLE_MODELS in its order, limited to
 * `allowedModels` when settings have loaded. An allowed id the client doesn't
 * know (an operator's MANAGED_MODELS entry) is shown by its id.
 */
export function modelsFor(allowedModels) {
    if (!Array.isArray(allowedModels) || allowedModels.length === 0) return AVAILABLE_MODELS;
    const known = AVAILABLE_MODELS.filter((m) => allowedModels.includes(m.id));
    const unknown = allowedModels
        .filter((id) => typeof id === 'string' && !AVAILABLE_MODELS.some((m) => m.id === id))
        .map((id) => ({ id, name: id, vendor: '', speed: '' }));
    return [...known, ...unknown];
}

/** `selected` if it is offered; otherwise the default model, or the first one offered. */
export function pickModel(selected, models) {
    if (models.some((m) => m.id === selected)) return selected;
    if (models.some((m) => m.id === DEFAULT_MODEL_ID)) return DEFAULT_MODEL_ID;
    return models[0]?.id || DEFAULT_MODEL_ID;
}
