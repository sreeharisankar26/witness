/**
 * The one place that talks to a model.
 *
 * Two reasons this exists rather than a fetch inline at each call site.
 *
 * First, provider shape. The app was written against OpenAI's
 * `/chat/completions`, but the free tiers a student can actually get are not
 * all that shape — Anthropic's native API is `/v1/messages` with a different
 * auth header and a different response envelope. Rather than pick one and lock
 * the project to a paid account, this detects the shape from the URL and
 * speaks whichever is in front of it. Google's Gemini exposes an
 * OpenAI-compatible endpoint, so a free Google AI Studio key works here with no
 * special case at all.
 *
 * Second, and more important: EVERY model call in this system is optional. Not
 * one of them is on the safety path. So they all share the same discipline —
 * a hard timeout, one retry, and a failure that returns a reason instead of
 * throwing. A model being down must degrade the product, never break it.
 *
 * Node core only.
 */

/** Anything longer than this and a worker has already moved on. */
const DEFAULT_TIMEOUT_MS = 45000;

/**
 * Which API is at the other end?
 *
 * Detected from the URL rather than configured separately, because one more
 * setting is one more thing to get wrong at 2am before a demo.
 */
export function providerOf(url = '') {
  const u = String(url);
  if (/api\.anthropic\.com/i.test(u) || /\/v1\/messages\/?$/i.test(u)) return 'anthropic';
  return 'openai';           // OpenAI, Gemini's compat layer, Groq, OpenRouter, Together, Ollama
}

/** Strip a ```json fence a model added despite being told not to. */
export function unfence(text) {
  return String(text ?? '').trim()
    .replace(/^```(?:json|JSON)?\s*/, '')
    .replace(/```$/, '')
    .trim();
}

/**
 * The first well-formed JSON object or array in a string.
 *
 * Models preface JSON with "Here is the extraction:" often enough that failing
 * on it would make the pipeline flaky for a reason that has nothing to do with
 * whether the extraction was any good.
 */
export function parseJsonLoose(text) {
  const clean = unfence(text);
  try { return JSON.parse(clean); } catch { /* fall through */ }
  const start = clean.search(/[[{]/);
  if (start === -1) throw new Error('no JSON in the response');
  const open = clean[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(clean.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in the response');
}

function endpoint(baseUrl, provider) {
  const base = String(baseUrl).replace(/\/+$/, '');
  if (provider === 'anthropic') {
    return /\/v1\/messages$/.test(base) ? base : `${base}/v1/messages`;
  }
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

/**
 * Ask a model.
 *
 * `images` are base64 JPEG payloads; passing any makes this a vision call.
 * Returns `{ ok, text, ms, model, error }` — never throws, because no caller
 * of this is important enough to be allowed to take the app down.
 */
export async function ask({
  url, key, model, prompt, images = [], maxTokens = 4000,
  temperature = 0, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2,
  /** Called when we are waiting out a rate limit, so a CLI can say so. */
  onRetry = null,
}) {
  if (!url || !key) return { ok: false, error: 'no model configured', ms: 0 };

  const provider = providerOf(url);
  const target = endpoint(url, provider);
  const started = Date.now();

  const body = provider === 'anthropic'
    ? {
        model, max_tokens: maxTokens, temperature,
        messages: [{
          role: 'user',
          content: [
            ...images.map(b64 => ({
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
            })),
            { type: 'text', text: prompt },
          ],
        }],
      }
    : {
        model, max_tokens: maxTokens, temperature,
        messages: [{
          role: 'user',
          content: images.length
            ? [
                ...images.map(b64 => ({
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${b64}` },
                })),
                { type: 'text', text: prompt },
              ]
            : prompt,
        }],
      };

  const headers = provider === 'anthropic'
    ? { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };

  let lastError = '', lastStatus = 0, lastQuota = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(target, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 600);
        lastStatus = res.status;
        lastError = `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`;
        // 401/403 is the key. No amount of retrying fixes it.
        if (res.status === 401 || res.status === 403) break;

        /**
         * 429 is the free tier, and there are two completely different kinds.
         *
         * PER MINUTE is a pacing problem and waiting fixes it. Ingesting four
         * documents at two reads each fires eight calls in a couple of seconds,
         * so the later ones get refused — and because every model path here
         * degrades silently by design, the run "succeeds" having used a model
         * for one document and patterns for the rest. The ensemble then has a
         * single read, nothing to compare, and reports no agreement at all.
         *
         * PER DAY is not a pacing problem. The quota is gone until it resets,
         * and every second spent backing off is wasted. Worse, the two produce
         * the same status code and nearly the same message, so a tool that
         * treats them alike sits there sleeping through a wall it cannot get
         * past. Tell them apart, and stop immediately on the second.
         */
        lastQuota = quotaScopeOf(detail);
        if (res.status === 429 && lastQuota === 'daily') break;

        if (res.status === 429 && attempt < retries) {
          const after = Number(res.headers.get('retry-after'));
          const waitMs = Number.isFinite(after) && after > 0
            ? Math.min(after * 1000, 65000)
            : 6000 * (attempt + 1);
          onRetry?.({ status: 429, waitMs, quota: lastQuota });
          await new Promise(r => setTimeout(r, waitMs));
        }
        continue;
      }
      const json = await res.json();
      const text = provider === 'anthropic'
        ? (json.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('')
        : json.choices?.[0]?.message?.content ?? '';
      return { ok: true, text, ms: Date.now() - started, model, provider };
    } catch (e) {
      lastError = e.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : e.message;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    ok: false, error: lastError, status: lastStatus, quota: lastQuota,
    ms: Date.now() - started, model, provider,
  };
}

/**
 * Which kind of 429 is this?
 *
 * Providers do not give you a machine-readable answer, so this reads the prose.
 * Google says "GenerateRequestsPerDayPerProjectPerModel" in the quota metric and
 * "per day" in the message; OpenAI says "requests per day (RPD)". Anything that
 * mentions a minute is pacing. Returns 'daily', 'minute' or 'unknown', and
 * 'unknown' is treated as pacing because backing off is the safe guess.
 */
export function quotaScopeOf(detail = '') {
  const s = String(detail);
  if (/per[\s_-]*day|perday|\bRPD\b|daily\s+(quota|limit)/i.test(s)) return 'daily';
  if (/per[\s_-]*minute|perminute|\bRPM\b/i.test(s)) return 'minute';
  return 'unknown';
}

/**
 * One short, true sentence about a failed model call, for a CLI to print.
 *
 * The raw body is 600 characters of nested JSON with a documentation URL in the
 * middle of it. Printed as-is it pushes everything useful off the screen and
 * tells the reader nothing they can act on.
 */
export function explainModelError({ error = '', status = 0, quota = null, model = '' } = {}) {
  if (status === 401 || status === 403) {
    return 'the API key was rejected (401/403) — check it for a stray space';
  }
  if (status === 429 && quota === 'daily') {
    return `the free-tier daily quota for ${model || 'this model'} is used up. `
         + 'It resets at midnight Pacific (12:30 PM IST). Quota is counted per '
         + 'project and per model, so a new key in the same project will not help '
         + '— but a different model usually has its own allowance';
  }
  if (status === 429) return 'rate limited (429) — too many requests too quickly';
  if (status === 404) return `the model name "${model}" was refused (404) — it may be retired`;
  if (/timed out/i.test(error)) return error;
  return error.replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * Which models can this key actually use?
 *
 * Worth having because model names rot. `gemini-2.5-flash` was the documented
 * free-tier recommendation and was then withdrawn from new keys — the request
 * fails with a 404 that reads like a broken URL, and you go looking for the
 * wrong bug. Asking the endpoint is the only answer that stays true.
 */
export async function listModels({ url, key, timeoutMs = 15000 }) {
  if (!url || !key) return { ok: false, error: 'no model configured', models: [] };
  const provider = providerOf(url);
  const base = String(url).replace(/\/+$/, '').replace(/\/(chat\/completions|v1\/messages)$/, '');
  const target = `${base}/models`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      headers: provider === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : { Authorization: `Bearer ${key}` },
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, models: [] };
    const json = await res.json();
    const raw = json.data ?? json.models ?? [];
    const models = raw
      .map(m => String(m.id ?? m.name ?? ''))
      .map(s => s.replace(/^models\//, ''))
      .filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timed out' : e.message, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Things that answer chat requests. Excludes embedding, image and audio models. */
const NOT_CHAT = /embedding|embed|aqa|imagen|image-gen|veo|tts|audio|whisper|moderation|rerank/i;

/**
 * A sensible default from whatever is on offer.
 *
 * Prefers a Flash-class model — on a free tier the rate limits are what bite,
 * and Flash is the one with headroom. Newest version first, and previews only
 * if nothing stable is available.
 */
export function rankModels(models = []) {
  const usable = models.filter(m => !NOT_CHAT.test(m));
  const version = m => {
    const v = /(\d+(?:\.\d+)?)/.exec(m);
    return v ? Number(v[1]) : 0;
  };
  const score = m => (/flash/i.test(m) ? 100 : 0)
                   + (/lite/i.test(m) ? -20 : 0)
                   + (/preview|exp|beta/i.test(m) ? -40 : 0)
                   + version(m);
  return [...usable].sort((a, b) => score(b) - score(a) || a.length - b.length);
}

export function pickModel(models = []) {
  return rankModels(models)[0] ?? null;
}

/**
 * Confirm the configured model actually works, and find a replacement if not.
 *
 * Called ONCE at the start of anything that will make many calls, so a retired
 * model name is discovered in one cheap ping rather than failing on every
 * document in turn. Providers withdraw model names on their own schedule and
 * the resulting 404 reads like a broken URL, which sends you looking for the
 * wrong bug — this turns that into a line of output that says exactly what to
 * change.
 *
 * Never silently substitutes without saying so: `swapped` is set, and callers
 * are expected to print it.
 */
export async function resolveModel({ url, key, model }) {
  if (!url || !key) return { ok: false, model, error: 'no model configured' };

  const probeOne = m => ask({
    url, key, model: m, maxTokens: 8, retries: 0, timeoutMs: 20000,
    prompt: 'Reply with the single word: OK',
  });

  /** Every model that was tried and why it did not work, for the caller to print. */
  const tried = [];
  let first = null;

  if (model) {
    const probe = await probeOne(model);
    if (probe.ok) return { ok: true, model, swapped: null };
    first = probe;
    // 401/403 is the key, not the model — no point listing anything.
    if (probe.status === 401 || probe.status === 403) {
      return { ok: false, model, error: probe.error, status: probe.status };
    }
    tried.push({ model, error: probe.error, status: probe.status, quota: probe.quota });

    /**
     * Only a refused MODEL is worth shopping around for. A 404 means the name
     * is retired; a per-day 429 means this model's own allowance is gone, and
     * on Google that allowance is counted per model, so a sibling usually still
     * has one. Anything else — a timeout, a 500, no network — is a property of
     * the endpoint and trying six more names just wastes six more calls.
     */
    const worthShopping = probe.status === 404 || probe.status === 400
                       || (probe.status === 429 && probe.quota === 'daily');
    if (!worthShopping) {
      return { ok: false, model, error: probe.error, status: probe.status, quota: probe.quota, tried };
    }
  }

  const list = await listModels({ url, key });
  if (!list.ok || !list.models.length) {
    return {
      ok: false, model, tried,
      status: first?.status, quota: first?.quota,
      error: first?.error
        ?? `model "${model}" was refused and the model list is unavailable (${list.error || 'empty'})`,
    };
  }

  // Best first, and never re-probe the one that already failed.
  const candidates = rankModels(list.models).filter(m => m !== model).slice(0, 4);
  for (const candidate of candidates) {
    const r = await probeOne(candidate);
    if (r.ok) {
      return {
        ok: true, model: candidate, swapped: candidate, previous: model,
        available: list.models, tried,
      };
    }
    tried.push({ model: candidate, error: r.error, status: r.status, quota: r.quota });
    // A key-level refusal will not change on the next name either.
    if (r.status === 401 || r.status === 403) break;
  }

  const last = tried[tried.length - 1] ?? {};
  return {
    ok: false, model, available: list.models, tried,
    status: first?.status ?? last.status,
    quota: first?.quota ?? last.quota,
    error: first?.error ?? last.error ?? 'no chat-capable model available to this key',
  };
}

/** Ask for JSON and get it back parsed, or a reason why not. */
export async function askJson(opts) {
  const r = await ask(opts);
  if (!r.ok) return r;
  try {
    return { ...r, data: parseJsonLoose(r.text) };
  } catch (e) {
    return { ...r, ok: false, error: `model did not return usable JSON: ${e.message}` };
  }
}
