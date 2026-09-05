#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import csv, json, re, statistics, shutil, subprocess

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data'; BACKUPS=ROOT/'backups'; EXPORTS=ROOT/'exports'
LISTINGS=DATA/'marketplace_listings.csv'; OBS=DATA/'listing_observations.csv'; RAW=DATA/'raw_captures.jsonl'; SUPPLIERS=DATA/'supplier_quotes.csv'
LISTING_FIELDS=['record_id','first_seen','last_seen','capture_count','marketplace','template','collector_version','listing_id','priority','listing_title','url','source_url','category_path','breadcrumbs','listing_mode','buy_now_nzd','asking_price_nzd','starting_price_nzd','current_bid_nzd','no_reserve','reserve_not_met','close_date','close_remaining','first_views','views','view_change','watchers','bids','location','seller','seller_feedback_pct','seller_feedback_count','seller_in_trade','seller_address_verified','seller_member_since','condition','description','seller_sku','part_number','part_number_candidates','shipping_options','pickup_available','primary_image_url','schema_type','brand','model','model_year','odometer_km','engine_cc','engine_code','vehicle','chassis','years','part_type','compatibility_notes','replacement_reason','diy_difficulty','safety_critical','demand_notes','competition_notes','status','extraction_score','quality_flags','raw_sources_json']
OBS_FIELDS=['captured_at','listing_id','url','listing_title','buy_now_nzd','asking_price_nzd','starting_price_nzd','current_bid_nzd','views','watchers','bids','close_date','seller','extraction_score','quality_flags']
SUPPLIER_FIELDS=['supplier_record_id','captured_at','linked_listing_id','product_cluster','supplier_marketplace','supplier_name','supplier_url','supplier_country','supplier_part_title','supplier_part_number','compatible_vehicle','compatible_years','moq','unit_cost_foreign','currency','fx_to_nzd','unit_cost_nzd','shipping_total_nzd','qty_in_shipment','shipping_per_unit_nzd','estimated_duty_nzd_per_unit','estimated_gst_nzd_per_unit','estimated_landed_cost_nzd','lead_time_days','weight_g','dimensions','rating','orders_or_sales_signal','notes','status']

def compact(v):
    if v is None:return ''
    return json.dumps(v,ensure_ascii=False,separators=(',',':')) if isinstance(v,(dict,list)) else str(v)
def load(path):
    if not path.exists() or path.stat().st_size==0:return []
    with path.open(newline='',encoding='utf-8-sig') as f:return list(csv.DictReader(f))
def save(path,fields,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows([{k:r.get(k,'') for k in fields} for r in rows])
def append(path,fields,row):
    new=not path.exists() or path.stat().st_size==0
    with path.open('a',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');
        if new:w.writeheader()
        w.writerow({k:row.get(k,'') for k in fields})
def backup(path):
    if path.exists() and path.stat().st_size:
        BACKUPS.mkdir(exist_ok=True); stamp=datetime.now().strftime('%Y%m%d-%H%M%S-%f'); shutil.copy2(path,BACKUPS/f'{path.stem}-{stamp}{path.suffix}')
def clean_seller(v):
    s=' '.join(str(v or '').split()); parts=s.split()
    if len(parts)>=2 and parts[0].lower()==parts[1].lower():return parts[0]
    return s
def clean_member_since(v):
    s=' '.join(str(v or '').split());m=re.search(r'((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})',s,re.I);return m.group(1) if m else s
def canonical_url(v):
    return re.sub(r'[?#].*$','',str(v or ''))
PART_PATTERNS=[
    (r'\bseat\s*belts?\b','Seat belt'),
    (r'\bmaster\s+power\s+window\s+switch\b|\bwindow\s+master\s+switch\b|\bmaster\s+window\s+switch\b','Window master switch'),
    (r'\bleft\s+front\s+window\s+switch\b','Left front window switch'),
    (r'\bright\s+rear\s+window\s+switch\b','Right rear window switch'),
    (r'\bleft\s+rear\s+window\s+switch\b','Left rear window switch'),
    (r'\bright\s+front\s+window\s+switch\b','Right front window switch'),
    (r'\bwindow\s+switch\b','Window switch'),
    (r'\bcombination\s+switch\b','Combination switch'),
    (r'\bwiper\s+switch\b','Wiper switch'),
    (r'\bignition\s+switch\b','Ignition switch'),
    (r'\bheadlight\s+switch\b','Headlight switch'),
    (r'\bcenter\s+console\s+switch(?:\s+panel)?\b','Center console switch'),
]

def classify_part_type(title,desc):
    # Evidence hierarchy: title > explicit subject line > opening description.
    # Never let a generic seller inventory list override the actual listing subject.
    title=str(title or '')
    desc=str(desc or '')
    sources=[title]
    m=re.search(r'\bITEM\s*:\s*(.{1,180}?)(?=\b(?:PART\s*(?:#|NO\.?|NUMBER)|YEAR|CHASSIS|ENGINE|NOTES)\s*:|$)',desc,re.I)
    if m:sources.append(m.group(1))
    m=re.search(r'\bThis\s+auction\s+is\s+for\s*:\s*(.{1,180}?)(?=\bour\s+tag\s+number\s*:|\bPart\s+(?:Number|No\.?|#)\s*:|\bVin\s*:|$)',desc,re.I)
    if m:sources.append(m.group(1))
    sources.append(desc[:320])
    for src in sources:
        for rx,name in PART_PATTERNS:
            if re.search(rx,src,re.I):return name
    return ''

def infer(title,desc,obj=None):
    obj=obj or {}
    text=f'{title} {desc}'
    vehicle='Toyota Aqua' if re.search(r'\bToyota\s+Aqua\b',text,re.I) else ''
    chassis=str(obj.get('chassis_code_label') or obj.get('vin_label') or '')
    if chassis:
        chassis=re.sub(r'-\d+$','',chassis)
    elif re.search(r'\bNHP10(?:-\d+)?\b',text,re.I):
        chassis='NHP10'
    years=str(obj.get('vehicle_year_label') or '')
    if not years:
        ym=re.search(r'\bYEAR\s*:\s*(20\d{2})\b',desc,re.I)
        years=ym.group(1) if ym else ''
    if not years:
        m=re.search(r'\b(20\d{2})\s*[-–]\s*(20\d{2})\b',text);years=f'{m.group(1)}-{m.group(2)}' if m else ''
    if not years:
        m=re.search(r'\b(20\d{2})\b',title);years=m.group(1) if m else ''
    part=classify_part_type(title,desc)
    return vehicle,chassis,years,part

def valid_part_number(v):
    v=' '.join(str(v or '').split()).strip('[]() ,.;')
    if not v or len(v)<4 or len(v)>40:return False
    if v.lower() in {'number','comes','vin','tag','no','part','please','with'}:return False
    if re.fullmatch(r'TAG[-_ ]?\d+',v,re.I):return False
    if re.fullmatch(r'\d+\s*PINS?',v,re.I):return False
    if not re.search(r'\d',v):return False
    return bool(re.fullmatch(r'[A-Z0-9][A-Z0-9._/ -]*',v,re.I))

def sanitize_part_candidates(v):
    if isinstance(v,list):vals=v
    elif not v:vals=[]
    else:
        try: vals=json.loads(v) if str(v).lstrip().startswith('[') else [v]
        except: vals=[v]
    out=[]
    for x in vals:
        x=' '.join(str(x or '').split()).strip('[]() ,.;')
        if valid_part_number(x) and x not in out:out.append(x)
    return out
def quality_flags(obj):
    flags=list((obj.get('extraction_quality') or {}).get('warnings') or [])
    if obj.get('seller') and len(str(obj['seller']).split())>=2:
        p=str(obj['seller']).split();
        if p[0].lower()==p[1].lower():flags.append('seller_duplicate')
    pn=str(obj.get('part_number') or '')
    if pn and not valid_part_number(pn):flags.append('invalid_part_number')
    if obj.get('listing_id') and str(obj.get('listing_id')) not in str(obj.get('url','')):flags.append('listing_id_url_mismatch')
    return sorted(set(flags))
def ensure():
    for p in [DATA,BACKUPS,EXPORTS]:p.mkdir(exist_ok=True)
    if not SUPPLIERS.exists():save(SUPPLIERS,SUPPLIER_FIELDS,[])
    # schema migrate existing snapshots without throwing data away
    rows=load(LISTINGS)
    if rows:
        changed=False
        for r in rows:
            r['seller']=clean_seller(r.get('seller'));r['seller_member_since']=clean_member_since(r.get('seller_member_since'));r['url']=canonical_url(r.get('url'))
            pn=str(r.get('part_number') or '')
            pcs=sanitize_part_candidates(r.get('part_number_candidates'))
            if pn and not valid_part_number(pn):pn=''
            if pn and pn not in pcs:pcs.insert(0,pn)
            r['part_number']=pn or (pcs[0] if pcs else '')
            r['part_number_candidates']=compact(pcs)
            # Re-run deterministic derived classification on old rows so parser fixes repair existing data.
            veh,ch,yrs,pt=infer(r.get('listing_title',''),r.get('description',''),{})
            if veh:r['vehicle']=veh
            if ch:r['chassis']=ch
            if yrs:r['years']=yrs
            if pt:r['part_type']=pt
            # Recover common labeled engine codes from stored descriptions for migrated captures.
            em=re.search(r'\bENGINE(?:\s+CODE)?\s*:\s*([A-Z0-9._/-]+)',str(r.get('description') or ''),re.I)
            if em:r['engine_code']=em.group(1)
            # Legacy builds populated safety_critical=No as a blanket default. Treat that as unknown.
            if str(r.get('safety_critical') or '').strip().lower()=='no' and str(r.get('collector_version') or '') in {'','1.5.0'}:
                r['safety_critical']=''
            if not r.get('first_seen'):r['first_seen']=r.get('captured_at','')
            if not r.get('last_seen'):r['last_seen']=r.get('captured_at','')
            if not r.get('capture_count'):r['capture_count']='1'
            if not r.get('first_views'):r['first_views']=r.get('views','')
            try:r['view_change']=str(int(float(r.get('views') or 0))-int(float(r.get('first_views') or 0)))
            except:r['view_change']=''
            changed=True
        if changed:save(LISTINGS,LISTING_FIELDS,rows)
    elif not LISTINGS.exists():save(LISTINGS,LISTING_FIELDS,[])
    if not OBS.exists():
        save(OBS,OBS_FIELDS,[])
        # bootstrap one observation from each existing snapshot
        for r in load(LISTINGS):append(OBS,OBS_FIELDS,{k:r.get(k,'') for k in OBS_FIELDS})

def to_row(obj,existing=None):
    now=obj.get('captured_at') or datetime.now(timezone.utc).isoformat(); vehicle,chassis,years,part=infer(obj.get('listing_title',''),obj.get('description',''),obj)
    pcs=sanitize_part_candidates(obj.get('part_number_candidates'))
    pn=str(obj.get('part_number') or '').strip()
    if not valid_part_number(pn):pn=''
    if pn and pn not in pcs:pcs.insert(0,pn)
    if not pn and pcs:pn=pcs[0]
    r={k:'' for k in LISTING_FIELDS}; r.update(existing or {})
    first_seen=(existing or {}).get('first_seen') or now; first_views=(existing or {}).get('first_views') or obj.get('views')
    r.update({'record_id':(existing or {}).get('record_id') or datetime.now().strftime('%Y%m%d-%H%M%S-%f'),'first_seen':first_seen,'last_seen':now,'capture_count':str(int((existing or {}).get('capture_count') or 0)+1),'marketplace':'Trade Me','template':obj.get('template'),'collector_version':obj.get('collector_version'),'listing_id':obj.get('listing_id'),'listing_title':obj.get('listing_title'),'url':canonical_url(obj.get('url')),'source_url':obj.get('source_url'),'category_path':compact(obj.get('category_path')),'breadcrumbs':compact(obj.get('breadcrumbs')),'listing_mode':obj.get('listing_mode'),'buy_now_nzd':obj.get('buy_now_nzd'),'asking_price_nzd':obj.get('asking_price_nzd'),'starting_price_nzd':obj.get('starting_price_nzd'),'current_bid_nzd':obj.get('current_bid_nzd'),'no_reserve':obj.get('no_reserve'),'reserve_not_met':obj.get('reserve_not_met'),'close_date':obj.get('close_date'),'close_remaining':obj.get('close_remaining'),'first_views':first_views,'views':obj.get('views'),'watchers':obj.get('watchers'),'bids':obj.get('bids'),'location':obj.get('location'),'seller':clean_seller(obj.get('seller')),'seller_feedback_pct':obj.get('seller_feedback_pct'),'seller_feedback_count':obj.get('seller_feedback_count'),'seller_in_trade':obj.get('seller_in_trade'),'seller_address_verified':obj.get('seller_address_verified'),'seller_member_since':clean_member_since(obj.get('seller_member_since')),'condition':obj.get('condition'),'description':obj.get('description'),'seller_sku':obj.get('seller_sku'),'part_number':pn,'part_number_candidates':compact(pcs),'shipping_options':compact(obj.get('shipping_options')),'pickup_available':obj.get('pickup_available'),'primary_image_url':obj.get('primary_image_url'),'schema_type':obj.get('schema_type'),'brand':obj.get('brand'),'model':obj.get('model'),'model_year':obj.get('model_year'),'odometer_km':obj.get('odometer_km'),'engine_cc':obj.get('engine_cc'),'engine_code':obj.get('engine_code_label') or obj.get('engine_code'),'vehicle':vehicle or (existing or {}).get('vehicle',''),'chassis':chassis or (existing or {}).get('chassis',''),'years':years or (existing or {}).get('years',''),'part_type':part or (existing or {}).get('part_type',''),'status':'NZ evidence collected','extraction_score':(obj.get('extraction_quality') or {}).get('score'),'quality_flags':compact(quality_flags(obj)),'raw_sources_json':compact(obj.get('_sources'))})
    try:r['view_change']=str(int(float(r.get('views')))-int(float(first_views))) if r.get('views') not in ('',None) and first_views not in ('',None) else ''
    except:r['view_change']=''
    # safety-critical is deliberately blank until classified by a reasoning/rules layer
    if not existing:r['safety_critical']=''
    return r

def save_capture(obj):
    ensure(); lid=str(obj.get('listing_id') or '')
    if not re.fullmatch(r'\d{7,}',lid):raise ValueError('Invalid or missing Trade Me listing ID')
    if '/listing/'+lid not in canonical_url(obj.get('url')):raise ValueError('Listing ID does not match current page URL')
    if not obj.get('listing_title'):raise ValueError('Listing title missing; page may not be ready')
    DATA.mkdir(exist_ok=True)
    with RAW.open('a',encoding='utf-8') as f:f.write(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n')
    rows=load(LISTINGS); idx=next((i for i,r in enumerate(rows) if str(r.get('listing_id'))==lid),None); old=rows[idx] if idx is not None else None; row=to_row(obj,old)
    backup(LISTINGS)
    if idx is None:rows.append(row)
    else:rows[idx]=row
    save(LISTINGS,LISTING_FIELDS,rows)
    obs={'captured_at':obj.get('captured_at'),'listing_id':lid,'url':canonical_url(obj.get('url')),'listing_title':obj.get('listing_title'),'buy_now_nzd':obj.get('buy_now_nzd'),'asking_price_nzd':obj.get('asking_price_nzd'),'starting_price_nzd':obj.get('starting_price_nzd'),'current_bid_nzd':obj.get('current_bid_nzd'),'views':obj.get('views'),'watchers':obj.get('watchers'),'bids':obj.get('bids'),'close_date':obj.get('close_date'),'seller':clean_seller(obj.get('seller')),'extraction_score':(obj.get('extraction_quality') or {}).get('score'),'quality_flags':compact(quality_flags(obj))}
    append(OBS,OBS_FIELDS,obs); return row,idx is not None

class H(BaseHTTPRequestHandler):
    def send_json_headers(self, status=200):
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
        self.send_header('Cache-Control','no-store')
        self.end_headers()
    def do_OPTIONS(self):
        self.send_json_headers(204)
    def do_POST(self):
        if self.path!='/capture':
            self.send_json_headers(404)
            self.wfile.write(b'{"ok":false,"error":"not found"}')
            return
        try:
            n=int(self.headers.get('Content-Length','0'));obj=json.loads(self.rfile.read(n).decode());row,updated=save_capture(obj);flags=json.loads(row.get('quality_flags') or '[]');price=row.get('buy_now_nzd') or row.get('asking_price_nzd') or row.get('current_bid_nzd') or row.get('starting_price_nzd');print(f"\n{'UPDATED' if updated else 'SAVED'} #{row['listing_id']} | {row['listing_title']} | views={row['views']} | Δviews={row['view_change']} | price={price} | quality={row['extraction_score']}%"+(f" | flags={','.join(flags)}" if flags else ''))
            self.send_json_headers(200)
            self.wfile.write(json.dumps({'ok':True,'listing_id':row['listing_id'],'updated':updated,'warning_count':len(flags)}).encode('utf-8'))
        except Exception as e:
            self.send_json_headers(400)
            self.wfile.write(json.dumps({'ok':False,'error':str(e)}).encode('utf-8'))
    def log_message(self,*a):pass

def server():
    ensure();print('\nFishing Pond V1.5.2 server: http://127.0.0.1:8765');print('Leave this window open. Capture from the floating button or Option+Shift+F.');print('Ctrl+C stops the server.\n')
    try:ThreadingHTTPServer(('127.0.0.1',8765),H).serve_forever()
    except KeyboardInterrupt:print('\nCapture server stopped.')
def show():
    rows=load(LISTINGS);print(f'\n{len(rows)} unique listings | {len(load(OBS))} observations\n');print(f"{'ID':<12} {'Price':>8} {'Views':>6} {'Δ':>5} {'Seller':<18} {'Part':<22} Title")
    for r in rows[-40:]:
        p=r.get('buy_now_nzd') or r.get('asking_price_nzd') or r.get('current_bid_nzd') or r.get('starting_price_nzd') or ''
        print(f"{r.get('listing_id',''):<12} {str(p):>8} {str(r.get('views','')):>6} {str(r.get('view_change','')):>5} {r.get('seller','')[:18]:<18} {r.get('part_type','')[:22]:<22} {r.get('listing_title','')[:70]}")
def issues():
    rows=load(LISTINGS);bad=[]
    for r in rows:
        flags=[]
        try:flags=json.loads(r.get('quality_flags') or '[]')
        except:pass
        if flags or not r.get('part_type') or not r.get('category_path'):bad.append((r,flags))
    print(f'\n{len(bad)} records need review\n')
    for r,f in bad:print(r.get('listing_id'),','.join(f) or 'classification/category gap','-',r.get('url'))
def analyze():
    rows=load(LISTINGS);groups={}
    for r in rows:groups.setdefault((r.get('vehicle') or 'Other',r.get('part_type') or 'Unclassified'),[]).append(r)
    print('\nMARKET EVIDENCE — asking prices are not confirmed sales\n');print(f"{'Product':44} {'N':>3} {'Median$':>9} {'MedViews':>9} {'Sellers':>7}")
    out=[]
    for k,it in groups.items():
        ps=[float(p) for r in it for p in [r.get('buy_now_nzd') or r.get('asking_price_nzd') or r.get('current_bid_nzd') or r.get('starting_price_nzd')] if p not in ('',None)];vs=[float(r['views']) for r in it if r.get('views') not in ('',None)];ss=len({r.get('seller') for r in it if r.get('seller')});out.append((len(it),statistics.median(ps) if ps else 0,statistics.median(vs) if vs else 0,ss,k))
    for n,p,v,s,(veh,part) in sorted(out,reverse=True):print(f"{(veh+' — '+part)[:44]:44} {n:>3} {p:>9.2f} {v:>9.0f} {s:>7}")
def export():
    ensure();out=EXPORTS/f"ai_research_packet_{datetime.now().strftime('%Y%m%d_%H%M')}.json";out.write_text(json.dumps({'generated_at':datetime.now().isoformat(),'listings':load(LISTINGS),'observations':load(OBS),'supplier_quotes':load(SUPPLIERS)},ensure_ascii=False,indent=2));print('Created',out)
def paths():print('Snapshots   :',LISTINGS,'\nObservations:',OBS,'\nRaw captures:',RAW,'\nSuppliers   :',SUPPLIERS)
def menu():
    ensure()
    while True:
        print('\n======================================\n FISHING POND V1.5.2 — ROBUST CAPTURE\n======================================\n1) Start capture server\n2) View collected listings\n3) Show data-quality issues\n4) Show preliminary market ranking\n5) Create AI research packet\n6) Show data paths\n0) Quit')
        c=input('\nChoose: ').strip()
        if c=='1':server()
        elif c=='2':show()
        elif c=='3':issues()
        elif c=='4':analyze()
        elif c=='5':export()
        elif c=='6':paths()
        elif c=='0':break
if __name__=='__main__':menu()
