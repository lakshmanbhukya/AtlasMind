import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sseEvent, sseStream } from '../../src/lib/__fixtures__/sse.js';

/**
 * Chat thread, one turn of each kind, against a stubbed API (no server needed).
 * Response bodies come from src/lib/__fixtures__, shared with the conversation unit tests.
 */

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../src/lib/__fixtures__/${name}.json`, import.meta.url), 'utf8'));

type Reply = { status?: number; body: unknown };

type ProviderStub = {
  /** GET /api/provider-settings until a PUT, PATCH or DELETE changes it (default: managed). */
  settings?: unknown;
  /** Settings a PUT /key, PATCH { mode } and DELETE /key switch to. */
  personal?: unknown;
  managed?: unknown;
  /** Replies to POST /api/voice, in order. */
  voiceReplies?: Reply[];
};

/**
 * Stub every /api call. `queryReplies` answers text questions in order, on POST /api/query/stream
 * (as an SSE stream: progress events, then one `result` carrying the reply's status and body)
 * or on POST /api/query. The request bodies are recorded so tests can assert what the client sent.
 * Provider settings are a small state machine over the fixtures (`provider`).
 */
async function stubApi(page: Page, queryReplies: Reply[], approveReply?: Reply, provider: ProviderStub = {}) {
  const queryBodies: Record<string, unknown>[] = [];
  const approveBodies: Record<string, unknown>[] = [];
  const settingsBodies: { key: string; body: unknown }[] = [];
  const voiceRequests: string[] = [];
  const replies = [...queryReplies];
  const voiceReplies = [...(provider.voiceReplies ?? [])];
  const personal = provider.personal ?? fixture('provider-settings-personal');
  const managed = provider.managed ?? fixture('provider-settings-managed');
  let settings = provider.settings ?? managed;

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/api\//, '').replace(/\/$/, '');
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const key = `${req.method()} ${path}`;

    switch (key) {
      case 'GET auth/me':
        return json(200, fixture('session'));
      case 'GET schema':
        return json(200, fixture('schema'));
      case 'GET workspaces':
        return json(200, { success: true, data: [] });
      case 'GET dashboard':
        return json(200, { success: true, data: [] });
      case 'GET query/history':
        return json(200, fixture('history'));
      case 'GET provider-settings':
        return json(200, settings);
      case 'PUT provider-settings/key':
        settingsBodies.push({ key, body: req.postDataJSON() });
        settings = personal;
        return json(200, settings);
      case 'PATCH provider-settings': {
        const body = req.postDataJSON();
        settingsBodies.push({ key, body });
        settings = body.mode === 'personal' ? personal : managed;
        return json(200, settings);
      }
      case 'DELETE provider-settings/key':
        settingsBodies.push({ key, body: null });
        settings = managed;
        return json(200, settings);
      case 'POST query':
      case 'POST query/stream': {
        queryBodies.push(req.postDataJSON());
        const next = replies.shift() ?? { status: 500, body: { success: false, error: { code: 'test_no_reply', message: 'No stubbed reply left' } } };
        if (key === 'POST query') return json(next.status ?? 200, next.body);
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseStream({ status: next.status ?? 200, body: next.body }) });
      }
      case 'POST voice': {
        voiceRequests.push(req.postData() ?? '');
        const next = voiceReplies.shift() ?? { status: 500, body: { success: false, error: { code: 'test_no_reply', message: 'No stubbed voice reply left' } } };
        return json(next.status ?? 200, next.body);
      }
      case 'POST query/approve':
        approveBodies.push(req.postDataJSON());
        return json(approveReply?.status ?? 200, approveReply?.body ?? fixture('approve-success'));
      default:
        return json(404, { success: false, error: { code: 'not_stubbed', message: key } });
    }
  });

  return { queryBodies, approveBodies, settingsBodies, voiceRequests };
}

/**
 * The app shell is a lazy chunk that loads after the `load` event, and a cold
 * Vite dev server can take a while to transform it, so wait for the composer
 * with the navigation timeout rather than the 10s action timeout.
 */
async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Question' })).toBeVisible({ timeout: 30_000 });
}

async function ask(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Question' }).fill(text);
  await page.getByRole('button', { name: 'Send question' }).click();
}

const conversation = (page: Page) => page.getByRole('region', { name: 'Conversation' });
const userBubbles = (page: Page) => conversation(page).locator('[id^="msg-"]').filter({ has: page.locator('time') });

test.describe('Chat thread', () => {
  test('stream progress: the stage label shows, then the answer renders', async ({ page }) => {
    await stubApi(page, []);
    // A routed body arrives all at once, so stream from a stubbed fetch that pauses after a
    // progress event until the test releases it (`window.releaseStream()`).
    const progress = JSON.stringify(sseEvent('progress', { stage: 'safety' }));
    const result = JSON.stringify(sseEvent('result', { status: 200, body: fixture('answer') }));
    await page.addInitScript({
      content: `(() => {
        const realFetch = window.fetch.bind(window);
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        window.releaseStream = () => release();
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (!url.includes('/api/query/stream')) return realFetch(input, init);
          const enc = new TextEncoder();
          const body = new ReadableStream({
            async start(controller) {
              controller.enqueue(enc.encode(${progress}));
              await gate;
              controller.enqueue(enc.encode(${result}));
              controller.close();
            },
          });
          return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };
      })();`,
    });

    await openApp(page);
    await ask(page, 'Total revenue by region');

    await expect(page.getByRole('status').getByText('Running safety checks…')).toBeVisible();
    await page.evaluate(() => (window as unknown as { releaseStream: () => void }).releaseStream());
    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    await expect(page.getByText('Running safety checks…')).toHaveCount(0);
  });

  test('answer turn', async ({ page }) => {
    const { queryBodies } = await stubApi(page, [{ body: fixture('answer') }]);
    await openApp(page);
    await ask(page, 'Total revenue by region');

    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    await expect(conversation(page).getByText('Revenue summed per region, highest first.')).toBeVisible();
    expect(queryBodies[0]).toMatchObject({ text: 'Total revenue by region' });
  });

  test('clarification answered with Continue re-asks without a second user turn', async ({ page }) => {
    const { queryBodies } = await stubApi(page, [{ body: fixture('clarification') }, { body: fixture('answer') }]);
    await openApp(page);
    await ask(page, 'Show the top products');

    await expect(conversation(page).getByText('Clarification required')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    await expect(conversation(page).getByText('Answered')).toBeVisible();
    expect(queryBodies[1]).toMatchObject({ text: 'Show the top products' });
    expect(queryBodies[1].clarifications).toBeTruthy();
    await expect(userBubbles(page)).toHaveCount(1);
  });

  test('clarification bypassed', async ({ page }) => {
    const { queryBodies } = await stubApi(page, [{ body: fixture('clarification') }, { body: fixture('answer') }]);
    await openApp(page);
    await ask(page, 'Show the top products');

    await page.getByRole('button', { name: 'Run with assumptions' }).click();
    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    expect(queryBodies[1]).toMatchObject({ text: 'Show the top products', bypassAmbiguity: true });
  });

  test('scope prompt: add and re-run, and run on all collections', async ({ page }) => {
    const { queryBodies } = await stubApi(page, [
      { body: fixture('scope-insufficient') },
      { body: fixture('scope-insufficient') },
      { body: fixture('answer') },
    ]);
    await openApp(page);
    await ask(page, 'Revenue per customer segment');

    await expect(conversation(page).getByText('Collections outside scope')).toBeVisible();
    await page.getByRole('button', { name: 'Add and re-run' }).click();
    await expect.poll(() => queryBodies.length).toBe(2);
    expect(queryBodies[1]).toMatchObject({ text: 'Revenue per customer segment' });
    expect(queryBodies[1].collections).toEqual(expect.arrayContaining(['customers', 'sample_sales']));

    await page.getByRole('button', { name: 'Run on all collections' }).last().click();
    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    expect(queryBodies[2]).toMatchObject({ text: 'Revenue per customer segment', collections: [] });
  });

  test('approval: approve runs the write in place', async ({ page }) => {
    const { approveBodies } = await stubApi(page, [{ body: fixture('approval-required') }]);
    await openApp(page);
    await ask(page, 'Copy paid orders into orders_archive');

    await expect(conversation(page).getByText('Write approval required')).toBeVisible();
    await page.getByRole('button', { name: 'Approve and run' }).click();

    await expect(conversation(page).getByText('Approved write executed')).toBeVisible();
    await expect(conversation(page).getByText('Write approval required')).toHaveCount(0);
    expect(approveBodies[0]).toEqual({ approvalToken: 'test-approval-token' });
  });

  test('approval: discard keeps the card and drops the token', async ({ page }) => {
    const { approveBodies } = await stubApi(page, [{ body: fixture('approval-required') }]);
    await openApp(page);
    await ask(page, 'Copy paid orders into orders_archive');

    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(conversation(page).getByText('Discarded')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and run' })).toHaveCount(0);
    expect(approveBodies).toHaveLength(0);
  });

  test('approval failure shows the reason on the card', async ({ page }) => {
    await stubApi(page, [{ body: fixture('approval-required') }], {
      status: 401,
      body: { success: false, error: { code: 'invalid_approval_token', message: 'Approval token expired' } },
    });
    await openApp(page);
    await ask(page, 'Copy paid orders into orders_archive');

    await page.getByRole('button', { name: 'Approve and run' }).click();
    await expect(conversation(page).getByText('Approval token expired')).toBeVisible();
    await expect(conversation(page).getByText('Write approval required')).toBeVisible();
  });

  test('blocked turn from a 422 safety_violation', async ({ page }) => {
    await stubApi(page, [{ status: 422, body: fixture('blocked-422') }]);
    await openApp(page);
    await ask(page, 'Join users with system users');

    await expect(conversation(page).getByText('Query blocked')).toBeVisible();
    await page.getByRole('button', { name: 'Edit question' }).click();
    await expect(page.getByRole('textbox', { name: 'Question' })).toHaveValue('Join users with system users');
  });

  test('error turn retries the same question', async ({ page }) => {
    const { queryBodies } = await stubApi(page, [{ status: 500, body: fixture('error-500') }, { body: fixture('answer') }]);
    await openApp(page);
    await ask(page, 'Total revenue by region');

    await expect(conversation(page).getByText('Request failed')).toBeVisible();
    await expect(conversation(page).getByText('Failed to execute pipeline')).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    expect(queryBodies[1]).toMatchObject({ text: 'Total revenue by region' });
    await expect(userBubbles(page)).toHaveCount(1);
  });

  test('history selection replays locally and a sidebar refresh preserves follow-ups', async ({ page }) => {
    await stubApi(page, [{ body: fixture('answer') }]);
    const first = fixture('history').data[0];
    const second = { ...first, id: 'second', query: 'Second saved question' };
    let reads = 0;
    await page.route('**/api/query/history', (route) => {
      reads++;
      return route.fulfill({ json: { data: [first, second] } });
    });
    await page.route('**/api/query/history/second', (route) => route.fulfill({ json: { success: true } }));
    await openApp(page);
    const row = (name: string) => page.getByRole('button', { name, exact: true });
    await expect(row(first.query)).toBeVisible();
    const initialReads = reads;
    const composer = page.getByRole('textbox', { name: 'Question' });
    await row(first.query).click();
    await composer.fill('Draft for the first question');
    await row(second.query).click();
    await expect(composer).toHaveValue('');
    await composer.fill('Follow up');
    await row(first.query).click();
    await expect(composer).toHaveValue('Draft for the first question');
    await row(second.query).click();
    await expect(composer).toHaveValue('Follow up');
    const answer = page.locator('#msg-assistant-second');
    await expect(answer).toHaveClass(/ring-2/);
    await expect(answer.getByText('Read-only verified')).toBeVisible();
    expect(reads).toBe(initialReads);

    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    await expect.poll(() => reads).toBeGreaterThan(initialReads);
    await expect(userBubbles(page)).toHaveCount(2);
    await row('New query').click();
    await expect(answer).toHaveCount(0);
    await row(second.query).click();
    await row('Options for ' + second.query).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(answer).toHaveCount(0);
    await expect(row(second.query)).toHaveCount(0);
  });

  test('schema refresh keeps the previous schema on failure and retries with fresh fields', async ({ page }) => {
    await stubApi(page, []);
    let attempts = 0;
    const schema = fixture('schema');
    schema.data.collections[0].fields.push({ name: 'new_field', type: 'string' });
    await page.route('**/api/schema/refresh', (route) => {
      attempts++;
      return attempts === 1
        ? route.fulfill({ status: 500, json: { success: false } })
        : route.fulfill({ json: schema });
    });
    await openApp(page);
    await page.getByRole('button', { name: 'Schema explorer' }).click();
    await page.getByRole('button', { name: /sample_sales/ }).click();
    const refresh = page.getByRole('button', { name: 'Refresh schema' });
    await refresh.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'region' })).toBeVisible();
    await refresh.click();
    await expect(page.getByRole('cell', { name: 'new_field' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(attempts).toBe(2);
  });
});

/** A fake microphone and MediaRecorder: Start records, Send yields a small webm blob. */
async function fakeMicrophone(page: Page, deferPermission = false) {
  await page.addInitScript({
    content: `(() => {
      window.stoppedTracks = 0;
      const stream = { getTracks: () => [{ stop() { window.stoppedTracks++; } }] };
      const permission = new Promise(resolve => { window.grantMicrophone = () => resolve(stream); });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => ${deferPermission} ? permission : stream },
      });
      class FakeRecorder {
        static isTypeSupported() { return true; }
        constructor(s) { this.stream = s; this.state = 'inactive'; }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          this.ondataavailable && this.ondataavailable({ data: new Blob(['fake-audio'], { type: 'audio/webm' }) });
          this.onstop && this.onstop();
        }
      }
      window.MediaRecorder = FakeRecorder;
    })();`,
  });
}

for (const deferPermission of [false, true]) {
  test(`leaving chat releases the microphone with permission ${deferPermission ? 'pending' : 'granted'}`, async ({ page }) => {
    await fakeMicrophone(page, deferPermission);
    const { voiceRequests } = await stubApi(page, []);
    await openApp(page);
    await page.clock.install();
    await page.getByRole('button', { name: 'Start voice question' }).click();
    if (!deferPermission) await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Schema explorer' }).click();
    await expect(page.getByRole('button', { name: 'Refresh schema' })).toBeVisible();
    await page.evaluate(() => (window as unknown as { grantMicrophone(): void }).grantMicrophone());
    await expect.poll(() => page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBe(1);
    await page.clock.fastForward(61_000);
    expect(voiceRequests).toHaveLength(0);
  });
}

test('voice limit sends once and releases the microphone', async ({ page }) => {
  await fakeMicrophone(page);
  const { voiceRequests } = await stubApi(page, [], undefined, { voiceReplies: [{ body: fixture('voice-answer') }] });
  await openApp(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Start voice question' }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
  expect(voiceRequests).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBe(1);
});

test.describe('Groq payer', () => {
  const payerPanel = (page: Page) => page.getByRole('region', { name: 'Groq usage' });

  test('allowance exhausted: save your own key, then the retry is paid by it', async ({ page }) => {
    const { queryBodies, settingsBodies } = await stubApi(
      page,
      [{ status: 429, body: fixture('allowance-exhausted-429') }, { body: fixture('answer') }],
      undefined,
      { settings: fixture('provider-settings-exhausted') }
    );
    await openApp(page);
    await expect(payerPanel(page).getByTestId('payer-title')).toHaveText('AtlasMind allowance');
    await ask(page, 'Total revenue by region');

    await expect(conversation(page).getByText('AtlasMind allowance used up')).toBeVisible();
    await expect(conversation(page).getByText(/Resets at \d{2}:\d{2}/)).toBeVisible();
    expect(queryBodies[0]).toMatchObject({ text: 'Total revenue by region', expectedPayer: 'managed' });

    await conversation(page).getByRole('button', { name: 'Use your own Groq key' }).click();
    const keyInput = payerPanel(page).getByLabel('Groq API key');
    await expect(keyInput).toBeFocused();
    await expect(keyInput).toHaveAttribute('type', 'password');
    await keyInput.fill('gsk_test_SECRET');
    await payerPanel(page).getByRole('button', { name: 'Save and use key' }).click();

    await expect(payerPanel(page).getByTestId('payer-title')).toHaveText('Your Groq key (…CRET)');
    await expect(payerPanel(page).getByLabel('Groq API key')).toHaveCount(0);
    expect(settingsBodies).toEqual([{ key: 'PUT provider-settings/key', body: { apiKey: 'gsk_test_SECRET' } }]);

    await conversation(page).getByRole('button', { name: 'Retry' }).click();
    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    expect(queryBodies[1]).toMatchObject({ text: 'Total revenue by region', expectedPayer: 'personal' });
    await expect(userBubbles(page)).toHaveCount(1);
    // The key never lands in browser storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('gsk_test_SECRET');
  });

  test('invalid personal key: switch to the AtlasMind allowance, then retry', async ({ page }) => {
    const { queryBodies, settingsBodies } = await stubApi(
      page,
      [{ status: 422, body: fixture('provider-key-invalid-422') }, { body: fixture('answer') }],
      undefined,
      { settings: fixture('provider-settings-personal') }
    );
    await openApp(page);
    await expect(payerPanel(page).getByTestId('payer-title')).toHaveText('Your Groq key (…CRET)');
    await ask(page, 'Total revenue by region');

    await expect(conversation(page).getByText('Groq key rejected')).toBeVisible();
    await expect(conversation(page).getByRole('button', { name: 'Update key' })).toBeVisible();
    expect(queryBodies[0]).toMatchObject({ expectedPayer: 'personal' });

    await conversation(page).getByRole('button', { name: 'Switch to AtlasMind allowance' }).click();
    await expect(payerPanel(page).getByTestId('payer-title')).toHaveText('AtlasMind allowance');
    expect(settingsBodies).toEqual([{ key: 'PATCH provider-settings', body: { mode: 'managed' } }]);

    await conversation(page).getByRole('button', { name: 'Retry' }).click();
    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    expect(queryBodies[1]).toMatchObject({ text: 'Total revenue by region', expectedPayer: 'managed' });
  });

  test('removing the key asks first, then switches to the AtlasMind allowance', async ({ page }) => {
    const { settingsBodies } = await stubApi(page, [], undefined, { settings: fixture('provider-settings-personal') });
    await openApp(page);

    await payerPanel(page).getByRole('button', { name: 'Remove key' }).click();
    expect(settingsBodies).toHaveLength(0);
    await payerPanel(page).getByRole('button', { name: 'Remove and switch' }).click();
    await expect(payerPanel(page).getByTestId('payer-title')).toHaveText('AtlasMind allowance');
    expect(settingsBodies).toEqual([{ key: 'DELETE provider-settings/key', body: null }]);
  });

  test('managed models only, and a reconnect note on an old cookie', async ({ page }) => {
    await stubApi(page, [], undefined, { settings: fixture('provider-settings-legacy') });
    await openApp(page);

    await expect(payerPanel(page).getByText(/connect your database again to use your own Groq key/)).toBeVisible();
    await expect(payerPanel(page).getByRole('button', { name: 'Use your own Groq key' })).toHaveCount(0);
    await page.getByRole('button', { name: /Model:/ }).click();
    const menu = page.getByRole('menu', { name: 'Model' });
    await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
    await expect(menu.getByText('Groq Compound')).toHaveCount(0);
  });

  test('error turn actions hide once used; a cancelled key form keeps them; Retry stays', async ({ page }) => {
    const { settingsBodies } = await stubApi(
      page,
      [{ status: 422, body: fixture('provider-key-invalid-422') }],
      undefined,
      { settings: fixture('provider-settings-personal') }
    );
    await openApp(page);
    await ask(page, 'Total revenue by region');
    const updateKey = conversation(page).getByRole('button', { name: 'Update key' });
    await expect(updateKey).toBeVisible();

    // Cancel: nothing changed, so the actions stay.
    await updateKey.click();
    await payerPanel(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(updateKey).toBeVisible();
    await expect(conversation(page).getByRole('button', { name: 'Switch to AtlasMind allowance' })).toBeVisible();

    // Save a new key: still personal, but this turn's actions are done.
    await updateKey.click();
    await payerPanel(page).getByLabel('Groq API key').fill('gsk_test_SECRET');
    await payerPanel(page).getByRole('button', { name: 'Save and use key' }).click();
    await expect(payerPanel(page).getByLabel('Groq API key')).toHaveCount(0);
    expect(settingsBodies).toEqual([{ key: 'PUT provider-settings/key', body: { apiKey: 'gsk_test_SECRET' } }]);
    await expect(updateKey).toHaveCount(0);
    await expect(conversation(page).getByRole('button', { name: 'Switch to AtlasMind allowance' })).toHaveCount(0);
    await expect(conversation(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('a payer change from the sidebar hides the turn actions too', async ({ page }) => {
    await stubApi(page, [{ status: 422, body: fixture('provider-key-invalid-422') }], undefined, {
      settings: fixture('provider-settings-personal'),
    });
    await openApp(page);
    await ask(page, 'Total revenue by region');
    await expect(conversation(page).getByRole('button', { name: 'Update key' })).toBeVisible();

    await payerPanel(page).getByRole('button', { name: 'Use AtlasMind allowance' }).click();
    await expect(payerPanel(page).getByTestId('payer-title')).toHaveText('AtlasMind allowance');
    await expect(conversation(page).getByRole('button', { name: 'Update key' })).toHaveCount(0);
    await expect(conversation(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('voice settings_changed: Resend sends the same recording again', async ({ page }) => {
    await fakeMicrophone(page);
    const { voiceRequests } = await stubApi(page, [], undefined, {
      settings: fixture('provider-settings-personal'),
      voiceReplies: [{ status: 409, body: fixture('settings-changed-409') }, { body: fixture('voice-answer') }],
    });
    await openApp(page);

    await page.getByRole('button', { name: 'Start voice question' }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(conversation(page).getByText('Groq settings changed', { exact: true })).toBeVisible();
    const resend = conversation(page).getByRole('button', { name: 'Resend' });
    await expect(resend).toBeVisible();

    await resend.click();
    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    expect(voiceRequests).toHaveLength(2);
    // Same audio both times (the multipart boundary differs, the recording does not).
    expect(voiceRequests[0]).toContain('fake-audio');
    expect(voiceRequests[1]).toContain('fake-audio');
  });

  test('provider_rate_limited: Retry counts down, then re-enables', async ({ page }) => {
    test.setTimeout(45_000);
    const { queryBodies } = await stubApi(
      page,
      [{ status: 429, body: fixture('provider-rate-limited-429') }, { body: fixture('answer') }],
      undefined,
      { settings: fixture('provider-settings-personal') }
    );
    await openApp(page);
    await ask(page, 'Total revenue by region');

    const wait = conversation(page).getByRole('button', { name: /Try again in \d+ s/ });
    await expect(wait).toBeVisible();
    await expect(wait).toBeDisabled();
    const retry = conversation(page).getByRole('button', { name: 'Retry' });
    await expect(retry).toBeEnabled({ timeout: 20_000 });
    await retry.click();
    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    expect(queryBodies).toHaveLength(2);
  });

  test('phone width: "Use your own Groq key" opens the drawer and the key form', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubApi(page, [{ status: 429, body: fixture('allowance-exhausted-429') }], undefined, {
      settings: fixture('provider-settings-exhausted'),
    });
    await openApp(page);
    await expect(payerPanel(page)).not.toBeInViewport();
    await ask(page, 'Total revenue by region');

    await conversation(page).getByRole('button', { name: 'Use your own Groq key' }).click();
    const keyInput = payerPanel(page).getByLabel('Groq API key');
    await expect(keyInput).toBeVisible();
    await expect(keyInput).toBeInViewport();
    await expect(keyInput).toBeFocused();
    await expect(payerPanel(page).getByRole('button', { name: 'Save and use key' })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
