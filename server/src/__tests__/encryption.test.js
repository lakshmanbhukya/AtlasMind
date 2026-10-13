'use strict';

describe('B1: encryption', () => {
    const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    test('encrypt and decrypt roundtrip successfully with valid key', () => {
        process.env.ENCRYPTION_KEY = validKey;
        let encryption;
        jest.isolateModules(() => {
            encryption = require('../utils/encryption');
        });

        const secret = 'mongodb://user:pass@localhost:27017/testdb';
        const encrypted = encryption.encrypt(secret);
        expect(encrypted).not.toBe(secret);
        expect(encrypted).toContain(':');

        const decrypted = encryption.decrypt(encrypted);
        expect(decrypted).toBe(secret);
    });

    test('hashString creates deterministic SHA-256 hash', () => {
        process.env.ENCRYPTION_KEY = validKey;
        let encryption;
        jest.isolateModules(() => {
            encryption = require('../utils/encryption');
        });

        const hash1 = encryption.hashString('my-secret-string');
        const hash2 = encryption.hashString('my-secret-string');
        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
    });

    test('throws at module startup if ENCRYPTION_KEY is missing', () => {
        delete process.env.ENCRYPTION_KEY;
        expect(() => {
            jest.isolateModules(() => {
                require('../utils/encryption');
            });
        }).toThrow(/ENCRYPTION_KEY environment variable is required and must be a 64-character hexadecimal string/);
    });

    test('throws at module startup if ENCRYPTION_KEY is not 64 hex characters', () => {
        const invalidKeys = [
            '',
            'too-short',
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde', // 63 chars
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0', // 65 chars
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg', // 'g' is not hex
        ];

        for (const key of invalidKeys) {
            process.env.ENCRYPTION_KEY = key;
            expect(() => {
                jest.isolateModules(() => {
                    require('../utils/encryption');
                });
            }).toThrow(/ENCRYPTION_KEY environment variable is required and must be a 64-character hexadecimal string/);
        }
    });
});
