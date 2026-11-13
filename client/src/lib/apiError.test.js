import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from './apiError';

describe('apiErrorMessage', () => {
    it('prefers the envelope error message', () => {
        const err = { message: 'Request failed with status code 500', response: { data: { success: false, error: { code: 'x', message: 'Server said no' } } } };
        expect(apiErrorMessage(err)).toBe('Server said no');
    });

    it('accepts a string error in the body', () => {
        expect(apiErrorMessage({ response: { data: { error: 'plain' } } })).toBe('plain');
    });

    it('falls back to the transport message, then the fallback', () => {
        expect(apiErrorMessage({ message: 'Network Error' })).toBe('Network Error');
        expect(apiErrorMessage(undefined, 'fallback')).toBe('fallback');
        expect(apiErrorMessage({})).toBe('An unexpected error occurred');
    });
});
