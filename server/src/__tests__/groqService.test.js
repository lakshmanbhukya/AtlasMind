'use strict';

const {
    QuotaExhaustedError,
    consumeQuota,
    refundQuota,
    recordActualUsage,
    probeJsonModeSupport,
    jsonModeCache,
    estimatePromptTokens,
    getBucket,
} = require('../services/quotaLimiter');
const { generateMQL } = require('../services/groqService');

describe('A3: groqService & quotaLimiter', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jsonModeCache.clear();
    });

    describe('quotaLimiter unit tests', () => {
        const testModel = 'test/model-quota';
        const limits = {
            rpm: 2,
            tpm: 1000,
            tpd: 10000,
            maxTokens: 500,
        };

        test('fail-fast when single request estimated tokens exceeds TPM', async () => {
            await expect(consumeQuota(testModel, 1500, limits)).rejects.toThrow(
                /exceeds model TPM limit/
            );
        });

        test('consumeQuota decrements available quota and refundQuota restores it', async () => {
            const bucket = getBucket(testModel);
            bucket.rpmCount = 0;
            bucket.tpmTokens = 0;
            bucket.rpmWindowStart = Date.now();
            bucket.tpmWindowStart = Date.now();

            const consumed = await consumeQuota(testModel, 200, limits);
            expect(consumed).toBe(200);
            expect(bucket.rpmCount).toBe(1);
            expect(bucket.tpmTokens).toBe(200);

            refundQuota(testModel, consumed);
            expect(bucket.rpmCount).toBe(0);
            expect(bucket.tpmTokens).toBe(0);
        });

        test('estimatePromptTokens estimates based on char count / 3.5 + maxTokens', () => {
            const messages = [
                { role: 'system', content: '1234567' }, // 7 chars -> 2 tokens
                { role: 'user', content: '1234567' },   // 7 chars -> 2 tokens
            ];
            const est = estimatePromptTokens(messages, 100);
            expect(est).toBe(Math.ceil(14 / 3.5) + 100); // 4 + 100 = 104
        });

        test('recordActualUsage throws QuotaExhaustedError when TPD hits 90%', () => {
            const tightLimits = { rpm: 10, tpm: 10000, tpd: 1000 };
            expect(() => {
                recordActualUsage('test/tpd-model', 500, 910, tightLimits);
            }).toThrow(QuotaExhaustedError);
        });
    });

    describe('probeJsonModeSupport', () => {
        test('caches true when probe succeeds', async () => {
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({ choices: [{ message: { content: '{}' } }] }),
                    },
                },
            };

            const supported = await probeJsonModeSupport(mockClient, 'test/model-json-ok');
            expect(supported).toBe(true);
            expect(jsonModeCache.get('test/model-json-ok')).toBe(true);

            // Second call uses cache
            await probeJsonModeSupport(mockClient, 'test/model-json-ok');
            expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
        });

        test('marks unsupported only on 400 error mentioning response_format', async () => {
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockRejectedValue({
                            status: 400,
                            message: 'Model does not support response_format: json_object',
                        }),
                    },
                },
            };

            const supported = await probeJsonModeSupport(mockClient, 'test/model-no-json');
            expect(supported).toBe(false);
            expect(jsonModeCache.get('test/model-no-json')).toBe(false);
        });

        test('re-throws on 429 without marking unsupported in cache', async () => {
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockRejectedValue({
                            status: 429,
                            message: 'Rate limit exceeded',
                        }),
                    },
                },
            };

            await expect(probeJsonModeSupport(mockClient, 'test/model-429')).rejects.toEqual(
                expect.objectContaining({ status: 429 })
            );
            expect(jsonModeCache.has('test/model-429')).toBe(false);
        });
    });

    describe('generateMQL returns rich diagnostics and respects STRICT_MODEL', () => {
        const { setGroqClient } = require('../services/groqService');

        afterEach(() => {
            setGroqClient(null);
        });

        test('returns usage, model, rawText, timings, retries and jsonModeUsed', async () => {
            const mockCreate = jest.fn().mockResolvedValue({
                id: 'chatcmpl-test',
                model: 'openai/gpt-oss-120b',
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                pipeline: [{ $match: { status: 'active' } }],
                                collection: 'users',
                                chartType: 'table',
                                explanation: 'Find active users',
                            }),
                        },
                    },
                ],
                usage: {
                    prompt_tokens: 120,
                    completion_tokens: 45,
                    total_tokens: 165,
                },
            });

            setGroqClient({
                chat: { completions: { create: mockCreate } },
            });

            process.env.GROQ_API_KEY = 'gsk_test';
            const result = await generateMQL('find active users', 'Database: db', []);

            expect(result.pipeline).toEqual([{ $match: { status: 'active' } }]);
            expect(result.collection).toBe('users');
            expect(result.usage).toEqual({
                prompt_tokens: 120,
                completion_tokens: 45,
                total_tokens: 165,
            });
            expect(result.model).toBe('openai/gpt-oss-120b');
            expect(typeof result.rawText).toBe('string');
            expect(typeof result.timings.llmMs).toBe('number');
            expect(result.retries).toBe(0);
            expect(result.jsonModeUsed).toBe(true);
        });

        test('STRICT_MODEL=1 throws original error instead of fallback', async () => {
            const customModelError = new Error('Custom model unavailable');
            const mockCreate = jest.fn().mockRejectedValue(customModelError);

            setGroqClient({
                chat: { completions: { create: mockCreate } },
            });

            process.env.GROQ_API_KEY = 'gsk_test';
            process.env.EVAL_MODE = '1';
            process.env.STRICT_MODEL = '1';
            jsonModeCache.set('custom/test-model', true);

            await expect(
                generateMQL('find active users', 'Database: db', [], 'custom/test-model')
            ).rejects.toThrow('Custom model unavailable');

            // Did NOT attempt fallback to DEFAULT_MODEL (only 1 call to custom model)
            expect(mockCreate).toHaveBeenCalledTimes(1);
        });
    });
});
