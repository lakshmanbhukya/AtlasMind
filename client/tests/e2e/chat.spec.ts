import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Chat thread, one turn of each kind, against a stubbed API (no server needed).
 * Response bodies come from src/lib/__fixtures__, shared with the conversation unit tests.
 */

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../src/lib/__fixtures__/${name}.json`, import.meta.url), 'utf8'));

type Reply = { status?: number; body: unknown };

/**
 * Stub every /api call. `queryReplies` answers POST /api/query in order; the request bodies
 * are recorded in the returned array so tests can assert what the client sent.
 */
async function stubApi(page: Page, queryReplies: Reply[], approveReply?: Reply) {
  const queryBodies: Record<string, unknown>[] = [];
  const approveBodies: Record<string, unknown>[] = [];
  const replies = [...queryReplies];

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
      case 'POST query': {
        queryBodies.push(req.postDataJSON());
        const next = replies.shift();
        if (!next) return json(500, { success: false, error: { code: 'test_no_reply', message: 'No stubbed reply left' } });
        return json(next.status ?? 200, next.body);
      }
      case 'POST query/approve':
        approveBodies.push(req.postDataJSON());
        return json(approveReply?.status ?? 200, approveReply?.body ?? fixture('approve-success'));
      default:
        return json(404, { success: false, error: { code: 'not_stubbed', message: key } });
    }
  });

  return { queryBodies, approveBodies };
}

async function ask(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Question' }).fill(text);
  await page.getByRole('button', { name: 'Send question' }).click();
}

const conversation = (page: Page) => page.getByRole('region', { name: 'Conversation' });
const userBubbles = (page: Page) => conversation(page).locator('[id^="msg-"]').filter({ has: page.locator('time') });

test.describe('Chat thread', () => {
  test('answer turn', async ({ page }) => {
    const { queryBodies } = await stubApi(page, [{ body: fixture('answer') }]);
    await page.goto('/');
    await ask(page, 'Total revenue by region');

    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    await expect(conversation(page).getByText('Revenue summed per region, highest first.')).toBeVisible();
    expect(queryBodies[0]).toMatchObject({ text: 'Total revenue by region' });
  });

  test('clarification answered with Continue re-asks without a second user turn', async ({ page }) => {
    const { queryBodies } = await stubApi(page, [{ body: fixture('clarification') }, { body: fixture('answer') }]);
    await page.goto('/');
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
    await page.goto('/');
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
    await page.goto('/');
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
    await page.goto('/');
    await ask(page, 'Copy paid orders into orders_archive');

    await expect(conversation(page).getByText('Write approval required')).toBeVisible();
    await page.getByRole('button', { name: 'Approve and run' }).click();

    await expect(conversation(page).getByText('Approved write executed')).toBeVisible();
    await expect(conversation(page).getByText('Write approval required')).toHaveCount(0);
    expect(approveBodies[0]).toEqual({ approvalToken: 'test-approval-token' });
  });

  test('approval: discard keeps the card and drops the token', async ({ page }) => {
    const { approveBodies } = await stubApi(page, [{ body: fixture('approval-required') }]);
    await page.goto('/');
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
    await page.goto('/');
    await ask(page, 'Copy paid orders into orders_archive');

    await page.getByRole('button', { name: 'Approve and run' }).click();
    await expect(conversation(page).getByText('Approval token expired')).toBeVisible();
    await expect(conversation(page).getByText('Write approval required')).toBeVisible();
  });

  test('blocked turn from a 422 safety_violation', async ({ page }) => {
    await stubApi(page, [{ status: 422, body: fixture('blocked-422') }]);
    await page.goto('/');
    await ask(page, 'Join users with system users');

    await expect(conversation(page).getByText('Query blocked')).toBeVisible();
    await page.getByRole('button', { name: 'Edit question' }).click();
    await expect(page.getByRole('textbox', { name: 'Question' })).toHaveValue('Join users with system users');
  });

  test('error turn retries the same question', async ({ page }) => {
    const { queryBodies } = await stubApi(page, [{ status: 500, body: fixture('error-500') }, { body: fixture('answer') }]);
    await page.goto('/');
    await ask(page, 'Total revenue by region');

    await expect(conversation(page).getByText('Request failed')).toBeVisible();
    await expect(conversation(page).getByText('Failed to execute pipeline')).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(conversation(page).getByText('Read-only verified')).toBeVisible();
    expect(queryBodies[1]).toMatchObject({ text: 'Total revenue by region' });
    await expect(userBubbles(page)).toHaveCount(1);
  });

  test('history replay renders the stored answer and highlights it', async ({ page }) => {
    await stubApi(page, []);
    const item = fixture('history').data[0];
    await page.goto('/');

    await page.getByRole('button', { name: item.query }).first().click();
    const answer = page.locator(`#msg-assistant-${item.id}`);
    await expect(answer).toBeVisible();
    await expect(answer).toHaveClass(/ring-2/);
    await expect(answer.getByText('Read-only verified')).toBeVisible();
    await expect(page.locator(`#msg-user-${item.id}`)).toContainText(item.query);
  });
});
