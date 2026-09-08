from relist import compare_relist, pick_best_relist

parent={"id":"old","listing_id":"6110749863","title":"Toyota Aqua (NHP10) Window Master Switch (PBT-GF30)","seller":"autopartswhouse","metadata":{"category_path":["Motors","Car parts","Toyota","Electrics"]},"finalized_at":"2026-09-07T20:38:00+00:00"}
old_obs={"captured_at":"2026-09-07T20:37:00+00:00","views":27,"buy_now_nzd":120,"part_number":"PBT-GF30","raw_snapshot":{"description":"Toyota Aqua NHP10 master window switch PBT-GF30","category_path":["Motors","Car parts","Toyota","Electrics"]}}
child={"id":"new","listing_id":"6121769780","title":"Toyota Aqua (NHP10) Window Master Switch (PBT-GF30)","seller":"autopartswhouse","metadata":{"category_path":["Motors","Car parts","Toyota","Electrics"]}}
child_obs={"captured_at":"2026-09-07T21:15:00+00:00","views":2,"buy_now_nzd":120,"part_number":"PBT-GF30","raw_snapshot":{"description":"Toyota Aqua NHP10 master window switch PBT-GF30","category_path":["Motors","Car parts","Toyota","Electrics"]}}
wrong={"id":"wrong","listing_id":"999","title":"Toyota Aqua ignition barrel with key","seller":"autopartswhouse","metadata":{"category_path":["Motors","Car parts","Toyota","Electrics"]}}
wrong_obs={"captured_at":"2026-09-07T21:15:00+00:00","views":2,"raw_snapshot":{"description":"ignition barrel key"}}
other_seller={**child,"seller":"someone_else"}

m=compare_relist(child,child_obs,parent,old_obs)
assert m.match and m.score>=.82, m.to_dict()
assert not compare_relist(other_seller,child_obs,parent,old_obs).match
assert compare_relist(wrong,wrong_obs,parent,old_obs).score < m.score
best, ranked=pick_best_relist([(child,m),(wrong,compare_relist(wrong,wrong_obs,parent,old_obs))])
assert best and best[0]["listing_id"]=="6121769780"
print("category-agnostic relist matcher regression tests passed")
