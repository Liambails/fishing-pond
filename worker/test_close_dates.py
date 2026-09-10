import unittest
from close_date import normalize_close_date

REF='2026-09-09T18:00:00Z'

class CloseDateTests(unittest.TestCase):
    def test_trademe_variants(self):
        cases={
            'Wed 9 Sep, 4:00 pm':'2026-09-09T04:00:00+00:00',
            'Tue 8th Sep, 6:20pm':'2026-09-08T06:20:00+00:00',
            'Closed: Mon 7th Sep, 9:54am':'2026-09-06T21:54:00+00:00',
            'Fri 11 Sep, 12:41 pm':'2026-09-11T00:41:00+00:00',
            '8:30pm, Sun 6 Sep':'2026-09-06T08:30:00+00:00',
        }
        for raw,want in cases.items():
            with self.subTest(raw=raw): self.assertEqual(normalize_close_date(raw,REF),want)

    def test_new_year_rollover_only_when_far_behind(self):
        self.assertEqual(normalize_close_date('2 Jan, 8:00 pm','2026-12-30T00:00:00Z'),'2027-01-02T07:00:00+00:00')
        self.assertTrue(normalize_close_date('6 Sep, 8:30 pm',REF).startswith('2026-09-06'))

    def test_invalid(self):
        self.assertIsNone(normalize_close_date(None,REF))
        self.assertIsNone(normalize_close_date('Closes soon',REF))

class ClosureTimingTests(unittest.TestCase):
    def test_sold_early_requires_explicit_sale(self):
        from close_date import closure_timing_evidence
        hist=[
            {'captured_at':'2026-09-10T00:00:00+00:00','close_date':'2026-09-10T12:00:00+00:00'},
            {'captured_at':'2026-09-10T03:00:00+00:00','close_date':'2026-09-10T12:00:00+00:00'},
        ]
        e=closure_timing_evidence(hist,'2026-09-10T05:00:00+00:00',True)
        self.assertTrue(e['closed_before_scheduled_close'])
        self.assertTrue(e['sold_early'])
        e2=closure_timing_evidence(hist,'2026-09-10T05:00:00+00:00',False)
        self.assertTrue(e2['closed_before_scheduled_close'])
        self.assertFalse(e2['sold_early'])

if __name__=='__main__': unittest.main()
