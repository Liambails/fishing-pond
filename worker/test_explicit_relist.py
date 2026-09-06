import unittest
from collector import marketplace_listing_id, find_explicit_relist_link

class FakeLocator:
    def __init__(self, anchors): self.anchors=anchors
    def evaluate_all(self, _): return self.anchors
class FakePage:
    def __init__(self, anchors, url='https://www.trademe.co.nz/a/motors/car-parts-accessories/listing/6110000000'):
        self.anchors=anchors; self.url=url
    def locator(self, _): return FakeLocator(self.anchors)

def a(text, href):
    return {'text':text,'href':href,'absoluteHref':href,'aria':'','title':''}

class ExplicitRelistTests(unittest.TestCase):
    def test_listing_id(self):
        self.assertEqual(marketplace_listing_id('https://www.trademe.co.nz/a/x/listing/6123456789?bof=x'),'6123456789')
    def test_wording_variants(self):
        for label in ['View the relisted item','Relisted','Re-listing: view item','Re listed item','Listed again','New listing']:
            with self.subTest(label=label):
                got=find_explicit_relist_link(FakePage([a(label,'https://www.trademe.co.nz/a/x/listing/6123456789')]),'', '6110000000')
                self.assertEqual(got['listing_id'],'6123456789')
    def test_reject_same_id_action_and_external(self):
        page=FakePage([
            a('Relist','https://www.trademe.co.nz/Sell/Marketplace/relist/6110000000'),
            a('View relisted item','https://evil.example/listing/6123456789'),
            a('View relisted item','https://www.trademe.co.nz/a/x/listing/6110000000'),
        ])
        self.assertIsNone(find_explicit_relist_link(page,page.url,'6110000000'))
    def test_accepts_safe_semantic_redirect_for_later_resolution(self):
        got=find_explicit_relist_link(FakePage([a('View the relisted item','https://www.trademe.co.nz/a/redirect/relisted-item?token=abc')]),'', '6110000000')
        self.assertIsNone(got['listing_id'])
        self.assertIn('/a/redirect/',got['url'])

    def test_prefers_explicit_visible_relist(self):
        page=FakePage([
            a('New listing','https://www.trademe.co.nz/a/x/listing/6123456788'),
            a('View the relisted item','https://www.trademe.co.nz/a/x/listing/6123456789'),
        ])
        got=find_explicit_relist_link(page,page.url,'6110000000')
        self.assertEqual(got['listing_id'],'6123456789')

if __name__=='__main__': unittest.main()
