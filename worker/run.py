import os
import json

from datetime import datetime, timezone
from dotenv import load_dotenv

from collector import collect_listing
from db import (
    client,
    due_listings,
    save_success,
    save_failure,
    log_collection_error
)

load_dotenv()

MAX = int(
    os.getenv('MAX_LISTINGS_PER_RUN', '3')
)

HEADLESS = (
    os.getenv('HEADLESS', 'true').lower()
    not in ('0', 'false', 'no')
)


def main():
    db = client()

    started = datetime.now(
        timezone.utc
    ).isoformat()

    run = (
        db.table('collection_runs')
        .insert({
            'source': 'github-actions/playwright',
            'started_at': started
        })
        .execute()
        .data[0]
    )

    run_id = run['id']

    attempted = 0
    ok = 0
    failed = 0
    details = []

    listings = due_listings(MAX)

    print(
        f'Due listings selected: {len(listings)}'
    )

    for listing in listings:
        attempted += 1

        print(
            f"\nOpening {listing['listing_id']} "
            f"(priority={listing.get('priority')}, "
            f"due={listing.get('next_observation_at')})"
        )

        try:
            raw = collect_listing(
                listing['url'],
                HEADLESS
            )

            save_success(
                listing,
                raw
            )

            ok += 1

            details.append({
                'listing_id': listing['listing_id'],
                'ok': True,
                'views': raw.get('views'),
                'price': (
                    raw.get('buy_now_nzd')
                    or raw.get('asking_price_nzd')
                )
            })

            print(
                f"SUCCESS {listing['listing_id']} "
                f"views={raw.get('views')}"
            )

        except Exception as e:
            failed += 1

            save_failure(
                listing,
                str(e)
            )

            try:
                log_collection_error(
                    listing,
                    e,
                    run_id=run_id
                )
            except Exception as log_error:
                print(
                    'WARNING: failed to write '
                    'collection_errors row:',
                    log_error
                )

            details.append({
                'listing_id': listing['listing_id'],
                'ok': False,
                'error': str(e),
                'error_type': getattr(
                    e,
                    'error_type',
                    type(e).__name__
                )
            })

            print(
                f"FAILED {listing['listing_id']} "
                f"[{getattr(e, 'error_type', type(e).__name__)}] "
                f"{e}"
            )

    db.table('collection_runs').update({
        'finished_at': datetime.now(
            timezone.utc
        ).isoformat(),
        'listings_attempted': attempted,
        'listings_succeeded': ok,
        'listings_failed': failed,
        'details': details
    }).eq('id', run_id).execute()

    print(
        json.dumps({
            'attempted': attempted,
            'succeeded': ok,
            'failed': failed,
            'details': details
        }, indent=2)
    )


if __name__ == '__main__':
    main()
