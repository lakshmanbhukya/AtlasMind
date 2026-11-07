/**
 * Query models served through Groq. Shared by the chat composer and the
 * landing page so both always show the same list.
 *
 * `vendor` is the short provider name shown on the landing page.
 */
export const AVAILABLE_MODELS = [
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT OSS 120B',
    vendor: 'OpenAI',
    speed: 'Balanced'
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT OSS 20B',
    vendor: 'OpenAI',
    speed: 'Fastest'
  },
  {
    id: 'groq/compound',
    name: 'Groq Compound',
    vendor: 'Groq',
    speed: 'Sub-150ms'
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    vendor: 'Alibaba Cloud',
    speed: 'Fast'
  },
  {
    id: 'qwen/qwen3.6-27b',
    name: 'Qwen 3.6 27B',
    vendor: 'Alibaba Cloud',
    speed: 'Fast'
  }
];

export const DEFAULT_MODEL_ID = AVAILABLE_MODELS[0].id;
