/**
 * THE QUERY A HELD ROW IMPLIES.
 *
 * Holding a submittal is only half a job. Something is unresolved, and until a
 * person asks the consultant a specific question it stays unresolved — so the
 * held pile grows, nobody reads it, and the gate that was supposed to protect
 * the record becomes a folder of things everyone ignores.
 *
 * So each held row is turned into the request for information it implies:
 * addressed, referenced, quoting the evidence, and asking ONE answerable
 * question. That is the actual unit of work a coordinator does after reading a
 * register, and it is entirely derivable from why the row was held.
 *
 * Two rules.
 *
 * It drafts; it does not send. Every RFI is correspondence on a construction
 * contract and carries commercial weight — an automated system emailing a
 * consultant in a project manager's name is not a feature. The draft is
 * complete and a person presses send.
 *
 * The question is written from the REASON, deterministically. A model could
 * phrase these more smoothly, and phrasing is exactly the part that does not
 * matter; what matters is that the reference, the revision and the ask are
 * carried across without being reinterpreted. Same division as everywhere else
 * in this system — if a model touches this, it may only polish the prose, never
 * choose the question.
 *
 * Pure functions. No clock passed in means no clock used. Node core only.
 */

/**
 * What to ask, per reason a row was held.
 *
 * Each returns a single question with a decidable answer. "Please advise" is
 * not a question and produces a fortnight of silence.
 */
const ASKS = {
  ZONE_UNKNOWN: r => ({
    subject: `${r.id} — location not stated for ${r.sku}`,
    question:
      `${r.id} approves ${r.sku} at Rev ${r.rev ?? '(unstated)'} but does not name a location. `
      + `Please confirm which zone or zones this approval covers, so it can be applied at the point of install.`,
    blocking: `Until this is confirmed, ${r.sku} has no approved revision recorded and the site app will not rule on it.`,
  }),

  SKU_UNKNOWN: r => ({
    subject: `${r.id} — part number not recognised (${r.sku})`,
    question:
      `${r.id} refers to part "${r.sku}", which does not appear on the procurement record for this project.`
      + (r.suggestion
        ? ` The nearest match we hold is "${r.suggestion}". Please confirm whether "${r.sku}" is a typographical `
          + `error for "${r.suggestion}", or a part we have not been issued. We have deliberately not assumed.`
        : ` Please confirm the correct part number.`),
    blocking: `We will not substitute a part number on our own — a corrected part number is a wrong part confidently approved.`,
  }),

  REVISION_UNREADABLE: r => ({
    subject: `${r.id} — revision could not be read`,
    question:
      `The revision field on ${r.id} for ${r.sku} could not be read as a revision `
      + `(it reads ${JSON.stringify(r.rawRev ?? r.rev ?? '')}). Please confirm the approved revision.`,
    blocking: `Without a revision this approval cannot be compared against what is being installed.`,
  }),

  CONFLICT: r => ({
    subject: `${r.id} — conflicting approvals for ${r.sku} in ${r.zone_id}`,
    question:
      `Two approvals are in force for ${r.sku} in ${r.zone_id}: ${r.conflictDetail ?? 'they specify different revisions'}. `
      + `No supersession note resolves them. Please confirm which is current and whether the other is withdrawn.`,
    blocking: `We have not selected one — choosing between two live approvals is not ours to do.`,
  }),

  MODEL_DISAGREEMENT: r => ({
    subject: `${r.id} — please confirm the entry for ${r.sku}`,
    question:
      `The register entry for ${r.id} could not be read reliably: ${r.disputeDetail ?? 'repeated reads produced different values'}. `
      + `Please confirm the part, revision, location and review action for this row in plain text.`,
    blocking: `We have held it rather than take the majority reading.`,
  }),

  STATUS_UNREADABLE: r => ({
    subject: `${r.id} — review action not recognised`,
    question:
      `${r.id} carries review action ${JSON.stringify(r.status ?? '')}, which is not one we recognise. `
      + `Please confirm whether this row is approved for construction.`,
    blocking: `An unrecognised code is not treated as approval.`,
  }),
};

/** House style for a construction RFI. Short, referenced, one question. */
export function draftRfi(held, project = {}, index = 1) {
  const make = ASKS[held.reason?.code];
  if (!make) return null;

  const { subject, question, blocking } = make(held);
  const ref = `RFI-${String(index).padStart(3, '0')}`;
  const projectLine = [project.name, project.id].filter(Boolean).join(' · ');

  const body = [
    `${ref}`,
    projectLine,
    '',
    `Subject: ${subject}`,
    `Reference: ${held.id}${held.doc_ref ? ` (${held.doc_ref})` : ''}`,
    '',
    question,
    '',
    blocking,
    '',
    'Raised automatically by Witness from the submittal register during ingestion.',
    'This row has been held out of the approved record pending your response.',
  ].join('\n');

  return {
    ref,
    subject,
    body,
    submittal: held.id,
    sku: held.sku ?? null,
    zone_id: held.zone_id ?? null,
    reason: held.reason.code,
    /** Nothing is sent. A person reads this and presses send. */
    status: 'DRAFT',
  };
}

/**
 * Every held row, as the correspondence it implies.
 *
 * Sorted so the rows blocking the most work come first — a coordinator has an
 * afternoon, not a week, and the order they work in should not be alphabetical.
 */
export function draftAll(held = [], project = {}) {
  const weight = { CONFLICT: 0, SKU_UNKNOWN: 1, ZONE_UNKNOWN: 2, MODEL_DISAGREEMENT: 3, REVISION_UNREADABLE: 4, STATUS_UNREADABLE: 5 };
  const ordered = [...held].sort(
    (a, b) => (weight[a.reason?.code] ?? 9) - (weight[b.reason?.code] ?? 9)
           || String(a.id).localeCompare(String(b.id)),
  );
  return ordered
    .map((h, i) => draftRfi(h, project, i + 1))
    .filter(Boolean);
}
