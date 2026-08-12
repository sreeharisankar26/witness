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

  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(target, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        lastError = `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`;
        // 401/403 is the key. No amount of retrying fixes it.
        if (res.status === 401 || res.status === 403) break;

        /**
         * 429 is the free tier, and it needs WAITING, not retrying.
         *
         * Free tiers are rated per minute. Ingesting four documents at two
         * reads each fires eight calls in a couple of seconds, so the later
         * ones get refused — and because every model path here degrades
         * silently by design, the run "succeeds" having used a model for one
         * document and patterns for the rest. The ensemble then has a single
         * read, nothing to compare, and reports no agreement at all. That is
         * exactly the number the demo is built on, missing, for a reason
         * nothing on screen explains.
         *
         * Honour Retry-After when the server sends one; otherwise back off.
         */
        if (res.status === 429 && attempt < retries) {
          const after = Number(res.headers.get('retry-after'));
          const waitMs = Number.isFinite(after) && after > 0
            ? Math.min(after * 1000, 65000)
            : 6000 * (attempt + 1);
          onRetry?.({ status: 429, waitMs });
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
  return { ok: false, error: lastError, ms: Date.now() - started, model, provider };
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
export function pickModel(models = []) {
  const usable = models.filter(m => !NOT_CHAT.test(m));
  if (!usable.length) return null;

  const version = m => {
    const v = /(\d+(?:\.\d+)?)/.exec(m);
    return v ? Number(v[1]) : 0;
  };
  const score = m => (/flash/i.test(m) ? 100 : 0)
                   + (/lite/i.test(m) ? -20 : 0)
                   + (/preview|exp|beta/i.test(m) ? -40 : 0)
                   + version(m);

  return [...usable].sort((a, b) => score(b) - score(a) || a.length - b.length)[0];
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

  if (model) {
    const probe = await ask({
      url, key, model, maxTokens: 8, retries: 0, timeoutMs: 20000,
      prompt: 'Reply with the single word: OK',
    });
    if (probe.ok) return { ok: true, model, swapped: null };
    // 401/403 is the key, not the model — no point listing anything.
    if (/40[13]/.test(probe.error || '')) return { ok: false, model, error: probe.error };
    if (!/40[04]/.test(probe.error || '')) return { ok: false, model, error: probe.error };
  }

  const list = await listModels({ url, key });
  if (!list.ok || !list.models.length) {
    return { ok: false, model, error: `model "${model}" was refused and the model list is unavailable (${list.error || 'empty'})` };
  }
  const better = pickModel(list.models);
  if (!better) {
    return { ok: false, model, available: list.models, error: 'no chat-capable model available to this key' };
  }
  const retry = await ask({
    url, key, model: better, maxTokens: 8, retries: 0, timeoutMs: 20000,
    prompt: 'Reply with the single word: OK',
  });
  return retry.ok
    ? { ok: true, model: better, swapped: better, previous: model, available: list.models }
    : { ok: false, model: better, available: list.models, error: retry.error };
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
