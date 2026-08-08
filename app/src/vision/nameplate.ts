/**
 * PERCEPTION.
 *
 * Most equipment on a site has no machine-readable tag - it has a stamped or
 * printed nameplate, often oily, dented, at an angle, half in shadow. This is
 * where a model earns its place: reading a physical object in bad conditions is
 * a problem no amount of deterministic code solves.
 *
 * The boundary that matters:
 *
 *      This file says   "the plate reads GT-12, serial SN-4471, I'm 0.82 sure."
 *      It never says    "that part is not allowed here."
 *
 * The output is a CANDIDATE IDENTITY. It is handed to the deterministic engine,
 * which does the compliance ruling, and anything sourced here comes back as
 * ADVISORY - the worker is shown what the model read and confirms it before
 * anything is filed. Perception can be wrong; the ruling on the approved record
 * cannot be allowed to be.
 *
 * Requires network. When it is unavailable the fallback ladder continues down
 * to manual entry, which always works.
 */
import type { NameplateReading } from '../engine/types';
import { NAMEPLATE_MIN_CONFIDENCE } from '../engine/resolve';

const BASE_URL = process.env.EXPO_PUBLIC_LLM_URL ?? '';
const API_KEY = process.env.EXPO_PUBLIC_LLM_KEY ?? '';
const MODEL = process.env.EXPO_PUBLIC_VLM_MODEL ?? 'claude-sonnet-5';
const TIMEOUT_MS = 12000;

const SYSTEM = `You read equipment nameplates on construction sites.

You are shown one photograph of a piece of installed or delivered equipment.
Find the manufacturer's nameplate, data plate, or printed label and read it.

Return ONLY a JSON object, no prose, no code fence:
{
  "sku": "<the model or part code, e.g. GT-12, AHU-04, PNL-08>" or null,
  "serial": "<the serial number, e.g. SN-4471>" or null,
  "confidence": <0.0 to 1.0>,
  "rawText": "<every line of text you can make out on the plate>"
}

Rules:
- Report ONLY characters you can actually see. Never complete a partially
  legible code from context or from what looks plausible.
- Any character you are unsure of makes the whole field less certain. Lower
  the confidence rather than guessing a digit.
- Oil, rust, glare, paint, and shallow angles are normal. If the plate is
  unreadable, return nulls with confidence 0 and put whatever fragments you
  can see in rawText.
- Serial numbers are often prefixed S/N, SN, SER, or NO.
- If there are several plates, prefer the one on the equipment body over a
  shipping or inspection label.

Being wrong here causes the wrong part to be installed in a building. An honest
"I cannot read it" is a correct and useful answer.`;

function clampConfidence(raw: unknown, sku: string | null, serial: string | null): number {
  let c = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  c = Math.max(0, Math.min(1, c));
  // A reading missing either field cannot be highly confident regardless of
  // what the model claims about itself.
  if (!sku || !serial) c = Math.min(c, 0.35);
  return c;
}

function normalise(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toUpperCase().replace(/\s+/g, '');
  if (!t || t === 'NULL' || t === 'UNKNOWN' || t === 'N/A') return null;
  return t;
}

/** Strips a ```json fence if the model added one despite instructions. */
function extractJson(text: string): any {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in response');
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Reads a nameplate from a base64 JPEG.
 *
 * Always resolves - never throws. Every failure path returns ok:false with a
 * message the worker can act on, because the alternative on a site is a spinner
 * that never ends.
 */
export async function readNameplate(base64Jpeg: string): Promise<NameplateReading> {
  const fail = (error: string): NameplateReading =>
    ({ ok: false, sku: null, serial: null, confidence: 0, rawText: '', error });

  if (!BASE_URL || !API_KEY) {
    return fail('Nameplate reading needs a model connection. Type the serial in instead.');
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this nameplate.' },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Jpeg}` },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      return fail(`Model refused the image (${res.status}). Type the serial in instead.`);
    }

    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(text);

    const sku = normalise(parsed.sku);
    const serial = normalise(parsed.serial);
    const confidence = clampConfidence(parsed.confidence, sku, serial);
    const rawText = typeof parsed.rawText === 'string' ? parsed.rawText.slice(0, 500) : '';

    if (!sku || !serial) {
      return {
        ok: false, sku, serial, confidence, rawText, model: MODEL,
        error: "I couldn't make out both the part code and the serial. Type in what you can read.",
      };
    }

    return { ok: true, sku, serial, confidence, rawText, model: MODEL };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return fail('Reading the plate timed out. Type the serial in instead.');
    }
    return fail('No connection to the model. Type the serial in instead.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this reading good enough to resolve without the worker retyping it?
 * Below the floor we still show it - we just make them confirm the characters.
 */
export function isConfidentEnough(r: NameplateReading): boolean {
  return r.ok && r.confidence >= NAMEPLATE_MIN_CONFIDENCE;
}
