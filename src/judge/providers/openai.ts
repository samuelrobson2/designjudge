import fs from 'node:fs';
import https from 'node:https';
import type { JudgeRequest } from '../../categories/layout/prompt.ts';
import type { CallOptions, Provider, ProviderResult, Usage } from './types.ts';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 15 * 60 * 1000;

// Node's fetch negotiates HTTP/2 and, once a shared session breaks, fails every later request
// on it (ERR_HTTP2_INVALID_SESSION), retries included. Requests go over HTTP/1.1 instead.
const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

interface HttpResult {
  status: number;
  ok: boolean;
  retryAfter: string | null;
  json: any;
}

function postJson(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', agent, headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        clearTimeout(timer);
        let json: any = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          json = null;
        }
        const status = res.statusCode ?? 0;
        const retryAfter = res.headers['retry-after'];
        resolve({ status, ok: status >= 200 && status < 300, retryAfter: typeof retryAfter === 'string' ? retryAfter : null, json });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(body);
  });
}

function buildBody(req: JudgeRequest, opts: CallOptions, detailOverride?: 'high', withSummary = true) {
  const content: unknown[] = [];
  const redacted: unknown[] = [];
  const pushImage = (img: JudgeRequest['images'][number]) => {
    const detail = detailOverride ?? img.detail;
    content.push({ type: 'input_image', image_url: `data:image/png;base64,${fs.readFileSync(img.path).toString('base64')}`, detail });
    redacted.push({ type: 'input_image', image_url: `<png sha256=${img.sha256} ${img.width}x${img.height}>`, detail });
  };
  if (req.userParts) {
    // Text-rendered prompts interleave screenshots at their place in the message.
    const byId = new Map(req.images.map((i) => [i.id, i]));
    for (const part of req.userParts) {
      if (part.type === 'text') {
        content.push({ type: 'input_text', text: part.text });
        redacted.push({ type: 'input_text', text: part.text });
      } else {
        const img = byId.get(part.id);
        if (!img) throw new Error(`Image ${part.id} is referenced in the message but missing from the packet`);
        pushImage(img);
      }
    }
  } else {
    content.push({ type: 'input_text', text: req.userText });
    redacted.push({ type: 'input_text', text: req.userText });
    for (const img of req.images) {
      const caption = { type: 'input_text', text: `Screenshot ${img.id}: ${img.caption}` };
      content.push(caption);
      redacted.push(caption);
      pushImage(img);
    }
  }
  const common = {
    model: opts.model,
    instructions: req.instructions,
    text: { format: { type: 'json_schema', name: req.schemaName, strict: true, schema: req.schema } },
    // A summary of the model's reasoning, kept as the judgment's reasoning trace.
    reasoning: withSummary ? { effort: opts.effort, summary: 'auto' } : { effort: opts.effort },
    store: false,
    max_output_tokens: 64_000,
  };
  return {
    body: { ...common, input: [{ role: 'user', content }] },
    redacted: { ...common, input: [{ role: 'user', content: redacted }] },
  };
}

function extractText(resp: any): { text: string | null; refusal: string | null } {
  let text = '';
  let refusal: string | null = null;
  for (const item of resp.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text') text += part.text;
      if (part.type === 'refusal') refusal = part.refusal;
    }
  }
  return { text: text || null, refusal };
}

// The model's reasoning summaries, in order (empty when the model returned none).
function extractReasoning(resp: any): string | null {
  const parts: string[] = [];
  for (const item of resp.output ?? []) {
    if (item.type !== 'reasoning') continue;
    for (const s of item.summary ?? []) if (s?.text) parts.push(String(s.text).trim());
  }
  return parts.length ? parts.join('\n\n') : null;
}

function usageOf(resp: any): Usage | null {
  const u = resp?.usage;
  if (!u) return null;
  return {
    inputTokens: u.input_tokens ?? 0,
    cachedInputTokens: u.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const openaiProvider: Provider = {
  name: 'openai',
  async call(req, opts): Promise<ProviderResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    const notes: string[] = [];
    if (!apiKey) {
      return {
        status: 'error',
        outputText: null,
        usage: null,
        latencyMs: 0,
        modelReported: null,
        rawRequest: null,
        rawResponse: null,
        error: 'OPENAI_API_KEY is not set. Add it to .env in the project root.',
        notes,
      };
    }
    let detailOverride: 'high' | undefined;
    let withSummary = true;
    let lastError = '';
    const start = Date.now();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { body, redacted } = buildBody(req, opts, detailOverride, withSummary);
      const t0 = Date.now();
      let res: HttpResult;
      try {
        res = await postJson(ENDPOINT, { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, JSON.stringify(body), TIMEOUT_MS);
      } catch (err) {
        const code = (err as { code?: string }).code;
        lastError = `Network error: ${(err as Error).message}${code ? ` (${code})` : ''}`;
        await sleep(2000 * attempt);
        continue;
      }
      const latencyMs = Date.now() - t0;
      const json = res.json;
      if (res.ok && json) {
        const { text, refusal } = extractText(json);
        const status = refusal ? 'refusal' : json.status === 'incomplete' ? 'incomplete' : 'ok';
        return {
          status,
          outputText: text,
          reasoningSummary: extractReasoning(json),
          usage: usageOf(json),
          latencyMs,
          modelReported: json.model ?? null,
          rawRequest: redacted,
          rawResponse: json,
          error: refusal ?? (json.status === 'incomplete' ? `Incomplete: ${json.incomplete_details?.reason ?? 'unknown'}` : undefined),
          notes: [...notes, ...(attempt > 1 ? [`Succeeded on attempt ${attempt}; total ${Date.now() - start} ms`] : [])],
        };
      }
      const message = json?.error?.message ?? `HTTP ${res.status}`;
      lastError = `HTTP ${res.status}: ${message}`;
      if (res.status === 400 && withSummary && /summar/i.test(message)) {
        withSummary = false;
        notes.push(`Model rejected a reasoning summary (${message}); retried without one, so this judgment has no reasoning trace.`);
        continue;
      }
      if (res.status === 400 && !detailOverride && /detail/i.test(message)) {
        detailOverride = 'high';
        notes.push(`Model rejected an image detail level (${message}); retried with detail "high" for all images.`);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.retryAfter);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1));
        continue;
      }
      return {
        status: 'error',
        outputText: null,
        usage: usageOf(json),
        latencyMs,
        modelReported: null,
        rawRequest: redacted,
        rawResponse: json,
        error: lastError,
        notes,
      };
    }
    return {
      status: 'error',
      outputText: null,
      usage: null,
      latencyMs: Date.now() - start,
      modelReported: null,
      rawRequest: null,
      rawResponse: null,
      error: lastError,
      notes,
    };
  },
};
