# Ingestion report

Generated 2026-08-12T23:55:57.515Z by `tools/ingest.mjs`.

A model reads the documents. `server/ingest.mjs` decides what is allowed to
become an approved revision. Every row is accounted for — nothing is silently
dropped, and nothing ambiguous is silently accepted.

| | |
|---|---|
| Rows read | **24** |
| Accepted into the record | **13** |
| Held for a human | **2** |
| Refused | **9** |
| Supersession notes found in prose | **3** |

## Documents

| File | Text extracted via | Read by | Rows | Notes | Reads agreed |
|---|---|---|---|---|---|
| L-895_Appendix_A_Rev_0.pdf | built-in reader (no dependencies) | 2x model (gemini-3.5-flash) | 5 | 0 | 100% |
| submittal-register-A.pdf | built-in reader (no dependencies) | 2x model (gemini-3.5-flash) | 8 | 1 | 100% |
| submittal-register-B.pdf | built-in reader (no dependencies) | 2x model (gemini-3.5-flash) | 5 | 1 | 100% |
| submittal-register-C-hanford-format.pdf | built-in reader (no dependencies) | 2x model (gemini-3.5-flash) | 6 | 1 | 100% |

## Refused — never enters the approved record

| Ref | Part | Zone | Rev | Why |
|---|---|---|---|---|
| 354825-001-SUB-004 | AHU-04 | ZONE-C | B | review action "C" means revise and resubmit — this was never approved for installation |
| SUB-0005 | PNL-08 | ZONE-C | B | review action "PENDING" means pending — this was never approved for installation |
| SUB-0013 | GT-12 | ZONE-A | B | superseded by SUB-0001 — "SUB-0013 (GT-12 Rev B, Zone A) is SUPERSEDED BY SUB-0001 Rev C dated 31-Jul-2026." |
| SUB-0015 | DMP-15 | ZONE-C | B | review action "REJECTED" means rejected — this was never approved for installation |
| XXXXXX-XXX-SUB-001 |  | — | — | no reference or no part number could be read |
| XXXXXX-XXX-SUB-002 |  | — | — | no reference or no part number could be read |
| XXXXXX-XXX-SUB-003 |  | — | — | no reference or no part number could be read |
| XXXXXX-XXX-SUB-004 |  | — | — | no reference or no part number could be read |
| XXXXXX-XXX-SUB-005 |  | — | — | no reference or no part number could be read |

## Held — readable, not verifiable, sent to a human

| Ref | Part | Zone | Rev | Why |
|---|---|---|---|---|
| SUB-0006 | DMP-15 | - | A | no location given — an approval that does not say where cannot be applied |
| SUB-0008 | GT-l2 | ZONE-D | C | "GT-l2" is not a part on this project — did you mean GT-12? (not applied automatically) |

## Accepted

| Ref | Part | Zone | Rev | Approved |
|---|---|---|---|---|
| 354825-001-SUB-001 | GT-12 | ZONE-A | C |  |
| 354825-001-SUB-002 | GT-12 | ZONE-B | C |  |
| 354825-001-SUB-003 | VLV-22 | ZONE-D | C |  |
| 354825-001-SUB-005 | PNL-08 | ZONE-D | C |  |
| 354825-001-SUB-006 | DMP-05 | ZONE-C | A |  |
| SUB-0001 | GT-12 | ZONE-A | C | 31-Jul-2026 |
| SUB-0002 | GT-12 | ZONE-B | C | 31/07/2026 |
| SUB-0003 | VLV-22 | ZONE-B | C | 2026-07-28 |
| SUB-0004 | AHU-04 | ZONE-C | D | 28-Jul-2026 |
| SUB-0007 | VLV-22 | ZONE-D | C | 28-Jul-2026 |
| SUB-0011 | AHU-04 | ZONE-A | D | 28-Jul-2026 |
| SUB-0012 | AHU-04 | ZONE-B | D | 28-Jul-2026 |
| SUB-0014 | PNL-08 | ZONE-D | C | 01-Aug-2026 |

## Questions raised

- **RFI-001** — SUB-0008 — part number not recognised (GT-l2) _(SKU_UNKNOWN)_
- **RFI-002** — SUB-0006 — location not stated for DMP-15 _(ZONE_UNKNOWN)_

Full drafts in [RFI_DRAFTS.md](RFI_DRAFTS.md). None have been sent.

## Notes found in prose

- **SUB-0013 superseded by SUB-0001** — "SUB-0013 (GT-12 Rev B, Zone A) is SUPERSEDED BY SUB-0001 Rev C dated 31-Jul-2026."
- **AHU-04 Rev C superseded by AHU-04 Rev D** — "AHU-04 Rev D supersedes Rev C across all zones."
- **354825-001-SUB-004 superseded by 354825-001-SUB-011** — "354825-001-SUB-004 (AHU-04 Rev B, Zone C) is SUPERSEDED BY 354825-001-SUB-011 Rev C."

---

The row worth looking at is any marked `NOT_APPROVED`. Those are rows sitting in
the same table as the approved ones, still awaiting consultant approval. A
pipeline that reads the table into JSON turns them into approved revisions, and
from that point the app is confidently wrong out loud to a worker. This is the
failure the gate exists to prevent.
