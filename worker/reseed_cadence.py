#!/usr/bin/env python3
"""
One-off COBALT cadence reseed for listings that existed before V3.7.

Default mode is DRY RUN. Nothing is written until --apply is supplied.

Rules:
- 0 observations: due now for a baseline capture.
- 1 observation: next check 6h after latest observation.
- 2 observations: next check 6h after latest observation.
- 3 observations: next check 12h after latest observation.
- 4+ observations: use the normal V3.7 adaptive cadence.
- If the calculated due time is already in the past, make it due now.
- Never unpause listings that are awaiting manual recovery / have 3+ failures.
- Never touch inactive/finalized listings.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

from db import client, adaptive_cadence_hours  # noqa: E402


def parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def recent_observations(db, listing_uuid, limit=12):
    return (
        db.table("observations")
        .select("captured_at,views,watchers,bids")
        .eq("listing_uuid", listing_uuid)
        .order("captured_at", desc=True)
        .limit(limit)
        .execute().data
        or []
    )


def priority_for(listing, hours):
    own = str((listing.get("metadata") or {}).get("ownership") or "").lower() == "own"
    if own:
        return 95
    if hours <= 6:
        return 88
    if hours <= 8:
        return 80
    if hours <= 12:
        return 68
    return 50


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write the recalculated cadence to Supabase. Without this flag, only print changes.",
    )
    args = parser.parse_args()

    db = client()
    now = datetime.now(timezone.utc)

    listings = (
        db.table("listings")
        .select("*")
        .eq("active", True)
        .order("priority", desc=True)
        .execute().data
        or []
    )

    changed = 0
    skipped = 0
    overdue = 0

    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"COBALT V3.7 cadence reseed — {mode}")
    print(f"Active listings found: {len(listings)}\n")

    for listing in listings:
        lid = listing["id"]
        display_id = listing.get("listing_id") or lid

        failures = int(listing.get("consecutive_failures") or 0)
        cadence_reason = str(listing.get("cadence_reason") or "")
        paused_for_recovery = (
            failures >= 3
            or "manual recovery" in cadence_reason.lower()
            or (
                listing.get("next_observation_at") is None
                and listing.get("last_error")
            )
        )

        if paused_for_recovery:
            skipped += 1
            print(f"SKIP  {display_id}: manual recovery/failure pause remains in place")
            continue

        observations = recent_observations(db, lid)
        n = len(observations)

        if n == 0:
            hours = 0
            reason = "learning phase · baseline needed"
            desired_due = now
            evidence = {"observation_count": 0}
        else:
            hours, reason, evidence = adaptive_cadence_hours(listing, observations)
            latest = max(
                (parse_dt(o.get("captured_at")) for o in observations),
                default=None,
            )
            if latest is None:
                desired_due = now
                reason = f"{reason} · invalid latest timestamp; due now"
            else:
                desired_due = latest + timedelta(hours=hours)

        if desired_due <= now:
            desired_due = now
            overdue += 1

        priority = priority_for(listing, hours if hours else 6)
        next_iso = desired_due.isoformat()

        current_next = parse_dt(listing.get("next_observation_at"))
        current_hours = listing.get("observation_interval_hours")
        needs_change = (
            current_next is None
            or abs((current_next - desired_due).total_seconds()) > 60
            or current_hours != hours
            or listing.get("cadence_reason") != reason
            or listing.get("priority") != priority
        )

        velocity = evidence.get("views_per_day")
        velocity_txt = "—" if velocity is None else f"{velocity:+.2f}/day"
        status = "UPDATE" if needs_change else "OK"
        print(
            f"{status:6} {display_id}: obs={n}, velocity={velocity_txt}, "
            f"cadence={hours}h, next={next_iso}, reason={reason}"
        )

        if needs_change:
            changed += 1
            if args.apply:
                db.table("listings").update(
                    {
                        "observation_interval_hours": hours,
                        "next_observation_at": next_iso,
                        "cadence_reason": reason,
                        "priority": priority,
                    }
                ).eq("id", lid).execute()

    print("\nSummary")
    print(f"  mode: {mode}")
    print(f"  active listings: {len(listings)}")
    print(f"  would update / updated: {changed}")
    print(f"  already overdue under V3.7: {overdue}")
    print(f"  skipped manual-recovery listings: {skipped}")

    if not args.apply:
        print("\nNo database rows were changed.")
        print("If the preview looks correct, run again with: python3 reseed_cadence.py --apply")


if __name__ == "__main__":
    main()
