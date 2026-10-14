import type { Locator, Page } from 'playwright';
import { QUIESCE } from '../config.ts';
import type { Step } from '../types.ts';
import { quiesce, quietCall } from './settle.ts';

const STEP_TIMEOUT = QUIESCE.actionTimeoutMs;

export interface StepOutcome {
  via: 'pointer' | 'dispatch' | 'keyboard' | 'none';
  note?: string;
}

// Evidence text names no wall-clock durations: they differ between machines.
export function withoutDurations(text: string): string {
  return text.replace(/Timeout \d+ms exceeded/g, 'Timeout exceeded');
}

// The call-log line that says why the action could not proceed.
export function callLogReason(err: unknown): string {
  const lines = String((err as Error).message).split('\n').map((l) => l.trim().replace(/^-\s*/, ''));
  const cause = [...lines]
    .reverse()
    .find((l) => /intercepts pointer events|not visible|outside of the viewport|not stable|not enabled|detached|not attached|not editable/.test(l));
  return withoutDurations(cause ?? lines[0]);
}

// Why a pointer click on the element cannot land, or null when it can. Decided on the quiet page in
// one pass (the alignments Playwright retries with included), so the outcome does not depend on
// how long Playwright would keep retrying.
export async function pointerBlocked(page: Page, selector: string): Promise<string | null> {
  try {
    return await quietCall<string | null>(page, '__djHitCheck', selector);
  } catch {
    return null;
  }
}

// A real pointer click where one can land, otherwise a dispatched click. Returns why the pointer
// could not be used, or null.
export async function clickOrDispatch(page: Page, loc: Locator, selector: string): Promise<string | null> {
  const blocked = await pointerBlocked(page, selector);
  if (!blocked) {
    try {
      await loc.click({ timeout: STEP_TIMEOUT });
      return null;
    } catch (err) {
      await loc.dispatchEvent('click', undefined, { timeout: STEP_TIMEOUT });
      return callLogReason(err);
    }
  }
  await loc.dispatchEvent('click', undefined, { timeout: STEP_TIMEOUT });
  return blocked;
}

export async function runStep(page: Page, step: Step): Promise<StepOutcome> {
  let outcome: StepOutcome = { via: 'pointer' };
  switch (step.action) {
    case 'click': {
      // The state is still worth capturing when a real pointer click cannot land (for example,
      // when overflowing content makes another element intercept the pointer). The fallback is
      // recorded so the step log shows the control was not hittable.
      const reason = await clickOrDispatch(page, page.locator(step.selector).first(), step.selector);
      if (reason) {
        outcome = {
          via: 'dispatch',
          note: `A pointer click on ${step.selector} could not land at its on-screen position (${reason}), so the click was dispatched programmatically to reach this state.`,
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
      // A declared wait is page time.
      await quiesce(page, step.ms);
      outcome = { via: 'none' };
      return outcome;
    case 'waitFor':
      await waitForVisible(page, step.selector);
      outcome = { via: 'none' };
      break;
  }
  await quiesce(page, 'action');
  return outcome;
}

// Gives the page action-sized slices of page time until the element shows, up to the action timeout
// in page time.
async function waitForVisible(page: Page, selector: string): Promise<void> {
  const loc = page.locator(selector).first();
  for (let spent = 0; ; ) {
    if (await loc.isVisible().catch(() => false)) return;
    if (spent >= STEP_TIMEOUT) throw new Error(`${selector} did not become visible within ${STEP_TIMEOUT / 1000} s of page time`);
    const r = await quiesce(page, 'brief');
    spent += r.pageMs ?? 0;
    if (!r.pageMs) spent = STEP_TIMEOUT;
  }
}
