#!/usr/bin/env python3
"""
Generates witness_seed.json — a synthetic stand-in for Kaya's approved submittal record.

DELIBERATELY deterministic (fixed seed) so the demo behaves identically on every
run and every take. Swap this file for a Kaya API response and nothing downstream
changes: see app/src/data/adapter.ts.
"""
import json, random, datetime as dt, pathlib

random.seed(1729)

OUT = pathlib.Path(__file__).resolve().parents[1] / "app" / "src" / "data" / "witness_seed.json"
OUT.parent.mkdir(parents=True, exist_ok=True)

PROJECT = {"id": "PRJ-4471", "name": "Hillside Tower - Block C", "client": "Kaya AI (demo record)"}

ZONES = [
    {"id": "ZONE-A", "name": "Zone A - Level 3 Mech Room",  "lat": 17.5949, "lng": 78.1229},
    {"id": "ZONE-B", "name": "Zone B - Level 3 Riser",      "lat": 17.5951, "lng": 78.1233},
    {"id": "ZONE-C", "name": "Zone C - Roof Plant Deck",    "lat": 17.5955, "lng": 78.1240},
    {"id": "ZONE-D", "name": "Zone D - Basement Pump Room", "lat": 17.5944, "lng": 78.1221},
]

CATALOG = [
    ("GT-12",  "Grout Termination Unit, 50mm",      "Structural"),
    ("AHU-04", "Air Handling Unit, 4000 CMH",       "Mechanical"),
    ("VLV-22", "Butterfly Valve, DN200 PN16",       "Plumbing"),
    ("PNL-08", "Distribution Panel, 400A TPN",      "Electrical"),
    ("PMP-31", "End-Suction Pump, 30 kW",           "Mechanical"),
    ("FCU-17", "Fan Coil Unit, ceiling concealed",  "Mechanical"),
    ("DMP-05", "Fire Damper, 600x400",              "Fire"),
    ("CBL-90", "LV Cable Tray, 300mm perforated",   "Electrical"),
    ("SPR-14", "Sprinkler Head, pendent K80",       "Fire"),
    ("ISO-02", "Vibration Isolator, spring 25mm",   "Mechanical"),
]

REVS = ["A", "B", "C", "D", "E"]
BASE = dt.date(2026, 5, 4)


def iso(d):
    return d.isoformat()


revisions, submittals, units, installs, ncrs = [], [], [], [], []
rid = 1

# ------------------------------------------------------------------ revisions
sku_history = {}
for sku, desc, disc in CATALOG:
    hist = REVS[:random.choice([2, 3, 3, 4])]
    sku_history[sku] = hist
    for i, rev in enumerate(hist):
        revisions.append({
            "id": f"REV-{rid:04d}", "sku": sku, "rev": rev,
            "superseded_by": hist[i + 1] if i + 1 < len(hist) else None,
            "approved_date": iso(BASE + dt.timedelta(days=14 * i)),
            "change_note": random.choice([
                "Dimensional change to mounting flange",
                "Material substitution approved",
                "Paperwork-only: revised test certificate",
                "Coating spec updated",
                "Vendor change, form/fit identical",
            ]),
        })
        rid += 1

# ----------------------------------------------------------------- submittals
sid = 1
approved_map = {}
for zone in ZONES:
    for sku, desc, disc in CATALOG:
        if random.random() < 0.25 and zone["id"] != "ZONE-A":
            continue
        hist = sku_history[sku]
        approved = hist[-1]
        submittals.append({
            "id": f"SUB-{sid:04d}", "sku": sku, "description": desc, "discipline": disc,
            "zone_id": zone["id"], "approved_rev": approved,
            "approved_date": iso(BASE + dt.timedelta(days=14 * (len(hist) - 1))),
            "doc_ref": f"SUB-{sid:04d}-{sku}-R{approved}.pdf",
        })
        approved_map[(sku, zone["id"])] = approved
        sid += 1

# ---------------------------------------------------------------------- units
uid = 4480
for sku, desc, disc in CATALOG:
    hist = sku_history[sku]
    for _ in range(random.choice([10, 12, 14])):
        rev = random.choices(hist, weights=[1] * (len(hist) - 1) + [4])[0]
        units.append({
            "serial": f"SN-{uid}", "sku": sku, "rev": rev,
            "manufactured_date": iso(BASE - dt.timedelta(days=random.randint(20, 180))),
        })
        uid += 1

# --------------------------------------------------------------- DEMO UNITS
# Hand-placed so every take is identical. These are the tags you print.
DEMO = [
    ("SN-4471", "GT-12",  "B", "HERO MISMATCH - installed Rev B, Zone A approves Rev C"),
    ("SN-4472", "GT-12",  "C", "HERO MATCH - correct unit, clean green verdict"),
    ("SN-4473", "AHU-04", "A", "SUPERSEDED CHAIN - two revisions behind"),
    ("SN-4474", "PNL-08", "D", "MATCH - second clean scan for B-roll"),
    ("SN-9999", "VLV-22", "C", "UNKNOWN UNIT - not in record, graceful-failure shot"),
    ("SN-4475", "SPR-14", "B", "NO APPROVED RECORD in Zone D - advisory path"),
]
demo_serials = {d[0] for d in DEMO}
units = [u for u in units if u["serial"] not in demo_serials]
for serial, sku, rev, note in DEMO:
    if serial == "SN-9999":
        continue  # deliberately absent from the record
    units.append({"serial": serial, "sku": sku, "rev": rev,
                  "manufactured_date": iso(BASE - dt.timedelta(days=90)),
                  "_demo_note": note})

# Force the hero scenario.
sku_history["GT-12"] = ["A", "B", "C"]
revisions = [r for r in revisions if r["sku"] != "GT-12"]
for i, rev in enumerate(["A", "B", "C"]):
    revisions.append({
        "id": f"REV-9{i:03d}", "sku": "GT-12", "rev": rev,
        "superseded_by": ["B", "C", None][i],
        "approved_date": ["2026-06-02", "2026-07-03", "2026-07-31"][i],
        "change_note": [
            "Initial approved issue",
            "Mounting flange thickened to 12mm",
            "Anchor spec revised - 12mm flange retained, M16 anchors mandated",
        ][i],
    })
for s in submittals:
    if s["sku"] == "GT-12" and s["zone_id"] == "ZONE-A":
        s["approved_rev"] = "C"
        s["approved_date"] = "2026-07-31"
        s["doc_ref"] = f"{s['id']}-GT-12-RC.pdf"
approved_map[("GT-12", "ZONE-A")] = "C"

# Remove SPR-14 from Zone D so the no-approved-record path is reachable.
submittals = [s for s in submittals if not (s["sku"] == "SPR-14" and s["zone_id"] == "ZONE-D")]
approved_map.pop(("SPR-14", "ZONE-D"), None)

# ------------------------------------------------------------------- installs
iid = 1
for zone in ZONES:
    zone_units = [u for u in units if (u["sku"], zone["id"]) in approved_map]
    for u in random.sample(zone_units, min(len(zone_units), random.randint(6, 10))):
        approved = approved_map[(u["sku"], zone["id"])]
        roll = random.random()
        if u["rev"] != approved:
            status, verifier = "FLAGGED", random.choice(["M. Nair", "P. Singh"])
        elif roll < 0.22:
            status, verifier = "VERIFIED", random.choice(["M. Nair", "P. Singh", "A. Kumar"])
        else:
            status, verifier = "PENDING", None
        installs.append({
            # Same derivation as app/src/data/db.ts installIdFor(). A phone
            # verifying a seeded unit must REPLACE this row, not add another.
            "id": f'INS-{zone["id"]}-{u["serial"]}', "serial": u["serial"], "sku": u["sku"],
            "zone_id": zone["id"],
            "installed_at": iso(BASE + dt.timedelta(days=random.randint(60, 92))),
            # Most installs have NOT been field-verified. That is the status quo
            # Witness exists to change - so the dashboard must open low and
            # climb as scans come in, not open at 90% and have nowhere to go.
            "verified_by": verifier,
            "status": status,
        })
        iid += 1

# The demo units must be known work items in their zone, otherwise verifying one
# ADDS to the denominator and the coverage number moves in a confusing direction
# on camera. They start PENDING - that is the status quo Witness exists to change.
DEMO_INSTALLS = [
    ("SN-4471", "GT-12",  "ZONE-A"),
    ("SN-4472", "GT-12",  "ZONE-A"),
    ("SN-4474", "PNL-08", "ZONE-A"),
    ("SN-4473", "AHU-04", "ZONE-C"),
]
have = {(i["zone_id"], i["serial"]) for i in installs}
for serial, sku, zone in DEMO_INSTALLS:
    if (zone, serial) in have:
        for i in installs:
            if i["zone_id"] == zone and i["serial"] == serial:
                i["status"], i["verified_by"] = "PENDING", None
        continue
    installs.append({
        "id": f"INS-{zone}-{serial}", "serial": serial, "sku": sku, "zone_id": zone,
        "installed_at": iso(BASE + dt.timedelta(days=88)),
        "verified_by": None, "status": "PENDING",
    })

# ----------------------------------------------------------------- prior NCRs
# THE MEMORY. Three prior GT-12 Rev B/C confusions in Zone A, so the 4th scan
# warns BEFORE the worker installs. This is slide 6, running live.
PRIOR = [
    ("SN-4402", "2026-07-06", "M. Nair",  "Rev B unit installed at grid E4; Rev C approved 31 Jul. Torn out."),
    ("SN-4418", "2026-07-19", "A. Kumar", "Rev B pulled from the same pallet. Caught at inspection."),
    ("SN-4455", "2026-08-01", "P. Singh", "Rev B again - pallet never quarantined after NCR-0028."),
]
for i, (serial, date, who, narrative) in enumerate(PRIOR, start=28):
    ncrs.append({
        "id": f"NCR-{i:04d}", "serial": serial, "sku": "GT-12", "zone_id": "ZONE-A",
        "installed_rev": "B", "approved_rev": "C", "created_at": date,
        "confirmed_by": who, "narrative": narrative,
        "status": "CLOSED" if i < 30 else "OPEN",
    })
# Unrelated NCRs elsewhere, so Zone A's cluster looks earned rather than staged.
ncrs += [
    {"id": "NCR-0031", "serial": "SN-4501", "sku": "VLV-22", "zone_id": "ZONE-B",
     "installed_rev": "A", "approved_rev": "B", "created_at": "2026-07-22",
     "confirmed_by": "M. Nair", "narrative": "Wrong pressure class delivered.", "status": "CLOSED"},
    {"id": "NCR-0032", "serial": "SN-4533", "sku": "AHU-04", "zone_id": "ZONE-C",
     "installed_rev": "B", "approved_rev": "C", "created_at": "2026-08-03",
     "confirmed_by": None, "narrative": "Coil spec superseded.", "status": "OPEN"},
]

seed = {
    "_generated": dt.datetime.now(dt.timezone.utc).isoformat(),
    "_note": "SYNTHETIC. Stands in for Kaya's approved submittal record. See app/src/data/adapter.ts.",
    # NOT a live value. The device stamps record_synced_at when it loads this
    # file (see app/src/data/db.ts ensureSeeded). Kept here only so the file is
    # a valid RecordSnapshot on its own, e.g. for the tests and the server.
    "record_synced_at": "2026-08-08T06:40:00Z",
    "_record_synced_at_note": "overwritten at install time by the device",
    "project": PROJECT,
    "zones": ZONES,
    "revisions": sorted(revisions, key=lambda r: (r["sku"], r["rev"])),
    "submittals": submittals,
    "units": sorted(units, key=lambda u: u["serial"]),
    "installs": installs,
    "ncrs": ncrs,
    "demo_tags": [{"serial": s, "sku": k, "rev": r, "note": n} for s, k, r, n in DEMO],
}

OUT.write_text(json.dumps(seed, indent=2))
print(f"wrote {OUT}")
for k in ("zones", "revisions", "submittals", "units", "installs", "ncrs"):
    print(f"  {k:12s} {len(seed[k])}")
