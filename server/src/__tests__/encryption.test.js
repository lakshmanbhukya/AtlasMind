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

    describe('AES-256-GCM (v2) format', () => {
        const crypto = require('crypto');
        const secret = 'mongodb+srv://user:p%40ss@cluster0.example.net/shop';
        let encryption;

        beforeEach(() => {
            process.env.ENCRYPTION_KEY = validKey;
            jest.isolateModules(() => {
                encryption = require('../utils/encryption');
            });
        });

        /** Flip the last hex digit of part `index` of a "v2:iv:tag:ct" string. */
        const tamper = (value, index) => {
            const parts = value.split(':');
            const p = parts[index];
            parts[index] = p.slice(0, -1) + (p.endsWith('0') ? '1' : '0');
            return parts.join(':');
        };

        test('encrypt writes v2:<12-byte iv>:<16-byte tag>:<ciphertext> and round-trips', () => {
            const encrypted = encryption.encrypt(secret);
            expect(encrypted).toMatch(/^v2:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
            expect(encryption.decrypt(encrypted)).toBe(secret);
            expect(encryption.encrypt(secret)).not.toBe(encrypted); // fresh IV each time
        });

        test('a legacy CBC "iv:ct" value still decrypts', () => {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(validKey, 'hex'), iv);
            const legacy = `${iv.toString('hex')}:${cipher.update(secret, 'utf8', 'hex')}${cipher.final('hex')}`;
            expect(encryption.decrypt(legacy)).toBe(secret);
        });

        test('a modified ciphertext throws', () => {
            expect(() => encryption.decrypt(tamper(encryption.encrypt(secret), 3))).toThrow();
        });

        test('a modified auth tag throws', () => {
            expect(() => encryption.decrypt(tamper(encryption.encrypt(secret), 2))).toThrow();
        });

        test('a truncated tag or malformed v2 value throws', () => {
            const [, iv, tag, ct] = encryption.encrypt(secret).split(':');
            expect(() => encryption.decrypt(`v2:${iv}:${tag.slice(0, 8)}:${ct}`)).toThrow('Invalid encrypted format');
            expect(() => encryption.decrypt(`v2:${iv}:${ct}`)).toThrow('Invalid encrypted format');
        });

        test('a value encrypted with another key does not decrypt', () => {
            const encrypted = encryption.encrypt(secret);
            process.env.ENCRYPTION_KEY = 'f'.repeat(64);
            let other;
            jest.isolateModules(() => {
                other = require('../utils/encryption');
            });
            expect(() => other.decrypt(encrypted)).toThrow();
        });
    });
});
