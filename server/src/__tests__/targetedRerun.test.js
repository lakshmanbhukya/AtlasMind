'use strict';

const { runTargetedRerun, checkLiveModelId } = require('../../../eval2/runners/run_targeted_reeval');

describe('A5: Targeted Rerun & Estimation Guard', () => {
    test('without --confirm, safely returns estimates and does not invoke LLMs', async () => {
        // Save argv
        const originalArgv = process.argv;
        process.argv = ['node', 'run_targeted_reeval.js'];

        const res = await runTargetedRerun();

        expect(res.confirmed).toBe(false);
        expect(res.totalPrimaryCalls).toBe(187);
        expect(res.totalPrimaryTokens).toBe(187 * 1900);
        expect(res.gpt20bLive).toBe(true);
        expect(res.qwenLive).toBe(true);

        process.argv = originalArgv;
    }, 15000);
});
