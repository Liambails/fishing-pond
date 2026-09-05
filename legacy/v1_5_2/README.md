# Fishing Pond V1.5.2

V1.5.2 hardens product interpretation without changing the current-page-only capture model.

Key fixes:
- Part type uses an evidence hierarchy: listing title first, explicit ITEM/auction subject second, opening description third. Generic seller inventory lists cannot override the actual item.
- Seat-belt listings are classified as Seat belt rather than being contaminated by generic text such as "window master switch" elsewhere in the seller description.
- Part numbers are parsed within the same DOM block/paragraph as the Part Number / Part No / PART # label.
- Empty part-number labels no longer consume the next sentence (for example "Part Number:" followed by a new paragraph beginning "Please...").
- Part-number validation rejects seller tags such as TAG4018 and connector specs such as 15 PIN while preserving codes such as 046-1U51, 42130-17F473, 6226483-P and PBT-GF30.
- Chassis/engine/year labels support both CHASSIS CODE / ENGINE CODE and simpler CHASSIS / ENGINE seller formats.
- Snapshot schema now stores engine_code.
- Python validates part numbers again server-side, so stale/older extension output is less likely to poison the dataset.
- Migration re-runs deterministic part classification and cleans known legacy derived-field errors.
- safety_critical remains blank/unknown unless deliberately classified later.

The extension captures only the Trade Me listing the user currently has open after a click/shortcut. It does not crawl or auto-navigate Trade Me.
