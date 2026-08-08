/**
 * THE LANGUAGE LAYER - and nothing else.
 *
 * This takes a verdict that has ALREADY been decided by the engine and turns it
 * into a sentence. It is allowed to fail. When it does, the worker still hears
 * the correct answer, because resolve() already produced `templateSpeech`.
 *
 * Read that again, because it is the answer to the hardest question a judge
 * will ask you: the model never decides anything. It only speaks.
 *
 * Model-agnostic on purpose - point BASE_URL at any OpenAI-compatible endpoint.
 */
import type { Resolution } from '../engine/types';

const BASE_URL = process.env.EXPO_PUBLIC_LLM_URL ?? '';
const API_KEY = process.env.EXPO_PUBLIC_LLM_KEY ?? '';
const MODEL = process.env.EXPO_PUBLIC_LLM_MODEL ?? 'claude-sonnet-5';
const TIMEOUT_MS = 2500;

const SYSTEM = `You are Witness, speaking into a construction worker's earpiece on a live site.

You will be given a verdict that has already been decided by a deterministic
check against the approved submittal record. Your ONLY job is to say it out loud
in a way a worker with their hands full can act on.

Rules:
- One or two sentences. Under 30 words. They are on a beam, not at a desk.
- Lead with the action: stop, or go ahead.
- Never invent a revision, date, part number or fact not present in the input.
- Never soften a STOP. Never add hedging to a MATCH.
- No pleasantries, no "I think", no restating the question.
- Plain spoken English. This is heard, not read.`;

function userPrompt(r: Resolution): string {
  return JSON.stringify({
    verdict: r.verdict,
    authority: r.authority,
    part: r.sku,
    description: r.description,
    serial: r.serial,
    location: r.zone_id,
    installed_revision: r.installedRev,
    approved_revision: r.approvedRev,
    superseded_through: r.supersededChain,
    record_age_hours: r.staleness.ageHours,
    record_is_stale: r.staleness.stale,
    prior_identical_failures_here: r.memory?.priorCount ?? 0,
    ncr_will_be_drafted: r.requiresNcr,
  });
}

export interface Spoken {
  text: string;
  source: 'model' | 'template';
}

/**
 * Always resolves. Never throws. Degrades to the deterministic template on any
 * failure - no network, timeout, bad key, rate limit, malformed response.
 */
export async function phrase(r: Resolution): Promise<Spoken> {
  if (!BASE_URL || !API_KEY) return { text: r.templateSpeech, source: 'template' };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,          // identical wording on every take
        max_tokens: 80,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt(r) },
        ],
      }),
    });
    if (!res.ok) return { text: r.templateSpeech, source: 'template' };
    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content?.trim();

    // Cheap guard: if the model returned something implausible for a spoken
    // line, fall back rather than read it out.
    if (!text || text.length < 8 || text.length > 240) {
      return { text: r.templateSpeech, source: 'template' };
    }
    return { text, source: 'model' };
  } catch {
    return { text: r.templateSpeech, source: 'template' };
  } finally {
    clearTimeout(timer);
  }
}
