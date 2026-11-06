'use strict';

const { generateMQL, setGroqClient } = require('../services/groqService');

function completion(content, extra = {}) {
    return {
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        ...extra,
    };
}

describe('groqService.generateMQL', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        setGroqClient(null);
    });

    describe('rich diagnostics and LLM hooks', () => {
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

        test('llm.strictModel throws the original error instead of falling back', async () => {
            const mockCreate = jest.fn().mockRejectedValue(new Error('Custom model unavailable'));
            setGroqClient({ chat: { completions: { create: mockCreate } } });

            await expect(
                generateMQL('find active users', 'Database: db', [], 'custom/test-model', {
                    llm: { strictModel: true },
                })
            ).rejects.toThrow('Custom model unavailable');
            expect(mockCreate).toHaveBeenCalledTimes(1);
        });

        test('EVAL_MODE / STRICT_MODEL env vars have no effect', async () => {
            process.env.EVAL_MODE = '1';
            process.env.STRICT_MODEL = '1';
            const mockCreate = jest.fn()
                .mockRejectedValueOnce(new Error('Custom model unavailable'))
                .mockResolvedValueOnce(completion({ pipeline: [], collection: 'users' }));
            setGroqClient({ chat: { completions: { create: mockCreate } } });

            await generateMQL('find users', 'Database: db', [], 'custom/test-model');
            expect(mockCreate).toHaveBeenCalledTimes(2);
            expect(mockCreate.mock.calls[1][0].model).toBe('openai/gpt-oss-120b');
        });

        test('default-model fallback sends the normalized query text', async () => {
            const mockCreate = jest.fn()
                .mockRejectedValueOnce(new Error('Custom model unavailable'))
                .mockResolvedValueOnce(completion({ pipeline: [], collection: 'users' }));
            setGroqClient({ chat: { completions: { create: mockCreate } } });

            await generateMQL({ query: 'find users' }, 'Database: db', [], 'custom/test-model');
            const fallbackMessages = mockCreate.mock.calls[1][0].messages;
            expect(fallbackMessages[1].content).toBe('find users');
        });

        test('runs beforeCall / afterCall hooks around a successful call', async () => {
            const mockCreate = jest.fn().mockResolvedValue(completion({ pipeline: [], collection: 'users' }));
            setGroqClient({ chat: { completions: { create: mockCreate } } });
            const beforeCall = jest.fn().mockResolvedValue('ticket-1');
            const afterCall = jest.fn();
            const onFailure = jest.fn();

            await generateMQL('find users', 'Database: db', [], 'm', {
                llm: { beforeCall, afterCall, onFailure, maxTokens: 321, extraParams: { reasoning_effort: 'low' } },
            });

            expect(beforeCall).toHaveBeenCalledWith(expect.objectContaining({ model: 'm', maxTokens: 321 }));
            expect(afterCall).toHaveBeenCalledWith('ticket-1', expect.objectContaining({ total_tokens: 15 }));
            expect(onFailure).not.toHaveBeenCalled();
            expect(mockCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
                max_tokens: 321,
                reasoning_effort: 'low',
            }));
        });

        test('runs onFailure with the ticket when the call fails', async () => {
            const failure = new Error('bad request');
            const mockCreate = jest.fn().mockRejectedValue(failure);
            setGroqClient({ chat: { completions: { create: mockCreate } } });
            const onFailure = jest.fn();

            await expect(generateMQL('find users', 'Database: db', [], undefined, {
                llm: { beforeCall: async () => 'ticket-2', onFailure },
            })).rejects.toThrow('bad request');
            expect(onFailure).toHaveBeenCalledWith('ticket-2', failure);
        });

        test('resolveJsonMode=false drops response_format and adds a JSON instruction', async () => {
            const mockCreate = jest.fn().mockResolvedValue(completion({ pipeline: [], collection: 'users' }));
            setGroqClient({ chat: { completions: { create: mockCreate } } });

            const result = await generateMQL('find users', 'Database: db', [], 'm', {
                llm: { resolveJsonMode: async () => false },
            });

            const params = mockCreate.mock.calls[0][0];
            expect(params.response_format).toBeUndefined();
            expect(params.messages[0].content).toContain('Return ONLY a raw JSON object');
            expect(result.jsonModeUsed).toBe(false);
        });
    });
});
