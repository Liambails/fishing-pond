import sys
import types
import unittest
from datetime import datetime, timezone

# Pure helper tests do not require live Supabase/Playwright.
sys.modules.setdefault('dotenv', types.SimpleNamespace(load_dotenv=lambda: None))
sys.modules.setdefault(
    'playwright.sync_api',
    types.SimpleNamespace(sync_playwright=None, TimeoutError=TimeoutError),
)
sys.modules.setdefault('playwright', types.ModuleType('playwright'))
sys.modules.setdefault('db', types.SimpleNamespace(client=lambda: None))

from search_watches import (
    LISTING_RX,
    choose_next_pagination_candidate,
    initial_due,
    search_url,
    listing_prices,
    whole_vehicle_url,
    discovery_rejection,
)


class SearchWatchTests(unittest.TestCase):
    def test_generic_query_only_builds_first_page(self):
        u = search_url('Toyota Aqua NHP10', None)
        self.assertIn('search_string=Toyota+Aqua+NHP10', u)
        self.assertNotIn('page=', u)

    def test_non_automotive_query_is_category_agnostic(self):
        u = search_url('2.2m beach umbrella', None)
        self.assertIn('2.2m+beach+umbrella', u)
        self.assertNotIn('page=', u)

    def test_category_path_keeps_search_term(self):
        u = search_url('umbrella', '/a/marketplace/home-living')
        self.assertTrue(u.startswith('https://www.trademe.co.nz/a/marketplace/home-living?'))
        self.assertIn('search_string=umbrella', u)

    def test_listing_ids(self):
        self.assertEqual(
            LISTING_RX.search('https://www.trademe.co.nz/a/x/listing/6121979829').group(1),
            '6121979829',
        )

    def test_rel_next_wins_without_css_class(self):
        current = 'https://www.trademe.co.nz/a/search?search_string=Aqua&page=1'
        c = choose_next_pagination_candidate(
            [
                {'index': 0, 'href': '/a/search?search_string=Aqua&page=2', 'text': '2', 'rel': '', 'aria': '', 'title': '', 'nav': 'Pagination 1 2 3', 'disabled': False},
                {'index': 1, 'href': '/a/search?search_string=Aqua&page=2', 'text': 'Next', 'rel': 'next', 'aria': 'Next page', 'title': '', 'nav': 'Pagination', 'disabled': False},
            ],
            1,
            current,
        )
        self.assertEqual(c['reason'], 'rel=next')
        self.assertIn('page=2', c['href'])

    def test_numeric_increment_is_found(self):
        current = 'https://www.trademe.co.nz/a/search?search_string=Aqua'
        c = choose_next_pagination_candidate(
            [
                {'index': 0, 'href': '/a/search?search_string=Aqua&page=1', 'text': '1', 'rel': '', 'aria': '', 'title': '', 'nav': 'Pagination 1 2 3', 'disabled': False},
                {'index': 1, 'href': '/a/search?search_string=Aqua&page=2', 'text': '2', 'rel': '', 'aria': '', 'title': '', 'nav': 'Pagination 1 2 3', 'disabled': False},
                {'index': 2, 'href': '/a/search?search_string=Aqua&page=3', 'text': '3', 'rel': '', 'aria': '', 'title': '', 'nav': 'Pagination 1 2 3', 'disabled': False},
            ],
            1,
            current,
        )
        self.assertIn(c['reason'], ('href increments page', 'incrementing page number'))
        self.assertIn('page=2', c['href'])

    def test_semantic_next_button_without_href(self):
        current = 'https://www.trademe.co.nz/a/search?search_string=Aqua&page=3'
        c = choose_next_pagination_candidate(
            [
                {'index': 7, 'href': '', 'text': '', 'rel': '', 'aria': 'Next page', 'title': '', 'nav': 'Search pagination 1 2 3 4', 'disabled': False},
            ],
            3,
            current,
        )
        self.assertEqual(c['index'], 7)
        self.assertEqual(c['reason'], 'semantic next control')

    def test_listing_link_is_never_pagination(self):
        current = 'https://www.trademe.co.nz/a/search?search_string=Aqua&page=1'
        c = choose_next_pagination_candidate(
            [
                {'index': 0, 'href': '/a/x/listing/6121979829?page=2', 'text': '2', 'rel': '', 'aria': '', 'title': '', 'nav': 'Pagination', 'disabled': False},
            ],
            1,
            current,
        )
        self.assertIsNone(c)

    def test_disabled_next_is_ignored(self):
        current = 'https://www.trademe.co.nz/a/search?search_string=Aqua&page=3'
        c = choose_next_pagination_candidate(
            [
                {'index': 0, 'href': '/a/search?search_string=Aqua&page=4', 'text': 'Next', 'rel': 'next', 'aria': '', 'title': '', 'nav': 'Pagination', 'disabled': True},
            ],
            3,
            current,
        )
        self.assertIsNone(c)


    def test_vehicle_url_is_rejected_silently(self):
        item = {
            'url': 'https://www.trademe.co.nz/a/motors/cars/toyota/aqua/listing/6121979829',
            'listing_title': '2014 Toyota Aqua NHP10',
            'card_text': '2014 Toyota Aqua Hybrid Automatic 121,000 km $8,990',
        }
        self.assertTrue(whole_vehicle_url(item['url']))
        self.assertEqual(discovery_rejection(item), 'whole_vehicle_url')

    def test_expensive_non_vehicle_result_is_rejected(self):
        item = {
            'url': 'https://www.trademe.co.nz/a/marketplace/listing/6121979829',
            'listing_title': 'Toyota Aqua NHP10 complete engine',
            'card_text': 'Buy now $6,250.00',
        }
        self.assertEqual(discovery_rejection(item), 'price_ceiling')

    def test_normal_part_is_allowed(self):
        item = {
            'url': 'https://www.trademe.co.nz/a/motors/car-parts-accessories/toyota/listing/6121979829',
            'listing_title': 'Toyota Aqua NHP10 master window switch',
            'card_text': 'Buy now $79.00 Auckland',
        }
        self.assertIsNone(discovery_rejection(item))

    def test_fitment_year_does_not_make_part_a_vehicle(self):
        item = {
            'url': 'https://www.trademe.co.nz/a/motors/car-parts-accessories/listing/6121979829',
            'listing_title': '2012-2017 Aqua NHP10 headlight left',
            'card_text': 'Toyota Aqua NHP10 headlight $189',
        }
        self.assertIsNone(discovery_rejection(item))

    def test_low_price_vehicle_text_is_still_rejected(self):
        item = {
            'url': 'https://www.trademe.co.nz/a/marketplace/listing/6121979829',
            'listing_title': '2012 Toyota Aqua NHP10',
            'card_text': 'Hybrid automatic hatchback 218,000 km $3,900',
        }
        self.assertEqual(discovery_rejection(item), 'whole_vehicle_text')

    def test_price_parser_prefers_detection_not_display_assumptions(self):
        self.assertEqual(listing_prices('Reserve $1, finance from $89, buy now $12,990'), [1.0, 89.0, 12990.0])

    def test_price_ceiling_is_configurable(self):
        item = {
            'url': 'https://www.trademe.co.nz/a/marketplace/listing/6121979829',
            'listing_title': 'Aqua NHP10 inverter',
            'card_text': '$5,500',
        }
        self.assertEqual(discovery_rejection(item, max_price_nzd=5000), 'price_ceiling')
        self.assertIsNone(discovery_rejection(item, max_price_nzd=6000))

    def test_first_observation_is_within_hour_and_stable(self):
        a = initial_due('6121979829')
        b = initial_due('6121979829')
        self.assertEqual(a.minute, b.minute)
        self.assertGreaterEqual((a - datetime.now(timezone.utc)).total_seconds(), -1)
        self.assertLess((a - datetime.now(timezone.utc)).total_seconds(), 3601)


if __name__ == '__main__':
    unittest.main()
