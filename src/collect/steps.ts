import type { Page } from 'playwright';
import type { Step } from '../types.ts';
import { waitForSettled } from './settle.ts';

const STEP_TIMEOUT = 5000;

export interface StepOutcome {
  via: 'pointer' | 'dispatch' | 'keyboard' | 'none';
  note?: string;
}

// The call-log line that says why the action could not proceed.
function callLogReason(err: unknown): string {
  const lines = String((err as Error).message).split('\n').map((l) => l.trim().replace(/^-\s*/, ''));
  const cause = [...lines]
    .reverse()
    .find((l) => /intercepts pointer events|not visible|outside of the viewport|not stable|not enabled|detached|not attached/.test(l));
  return cause ?? lines[0];
}

export async function runStep(page: Page, step: Step): Promise<StepOutcome> {
  let outcome: StepOutcome = { via: 'pointer' };
  switch (step.action) {
    case 'click': {
      const loc = page.locator(step.selector).first();
      try {
        await loc.click({ timeout: STEP_TIMEOUT });
      } catch (err) {
        // The state is still worth capturing when a real pointer click cannot land (for example,
        // when overflowing content makes another element intercept the pointer). The fallback is
        // recorded so the step log shows the control was not hittable.
        await loc.dispatchEvent('click', undefined, { timeout: STEP_TIMEOUT });
        outcome = {
          via: 'dispatch',
          note: `A pointer click on ${step.selector} could not land at its on-screen position (${callLogReason(err)}), so the click was dispatched programmatically to reach this state.`,
        };
      }
      break;
    }
    case 'fill':
      await page.locator(step.selector).first().fill(step.value, { timeout: STEP_TIMEOUT });
      break;
    case 'select':
      await page.locator(step.selector).first().selectOption(step.value, { timeout: STEP_TIMEOUT });
      break;
    case 'check':
      await page.locator(step.selector).first().check({ timeout: STEP_TIMEOUT });
      break;
    case 'uncheck':
      await page.locator(step.selector).first().uncheck({ timeout: STEP_TIMEOUT });
      break;
    case 'press':
      if (step.selector) await page.locator(step.selector).first().press(step.key, { timeout: STEP_TIMEOUT });
      else await page.keyboard.press(step.key);
      outcome = { via: 'keyboard' };
      break;
    case 'hover':
      await page.locator(step.selector).first().hover({ timeout: STEP_TIMEOUT });
      break;
    case 'focus':
      await page.locator(step.selector).first().focus({ timeout: STEP_TIMEOUT });
      outcome = { via: 'keyboard' };
      break;
    case 'scrollTo':
      await page.locator(step.selector).first().scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
      outcome = { via: 'none' };
      break;
    case 'wait':
      await page.waitForTimeout(step.ms);
      outcome = { via: 'none' };
      break;
    case 'waitFor':
      await page.locator(step.selector).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
      outcome = { via: 'none' };
      break;
  }
  await waitForSettled(page, null, true);
  return outcome;
}
