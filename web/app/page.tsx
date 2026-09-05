import { adminClient } from '../lib/supabase';

function n(v: unknown) { return v == null ? '—' : String(v); }

export const dynamic = 'force-dynamic';

export default async function Page() {
  const db = adminClient();
  const [{ data: products }, { data: listings }] = await Promise.all([
    db.from('products').select('*').order('priority', { ascending: false }).limit(50),
    db.from('listings').select('id,product_id,listing_id,title,seller,last_observed_at,next_observation_at,active,priority').order('next_observation_at', { ascending: true }).limit(100)
  ]);
  const p = products ?? [];
  const l = listings ?? [];
  return <main style={{maxWidth:1200,margin:'0 auto',padding:'40px 24px'}}>
    <div style={{fontSize:12,letterSpacing:2,color:'#94a3b8'}}>MOTERA RESEARCH</div>
    <h1 style={{fontSize:42,margin:'8px 0 8px'}}>Fishing Pond <span style={{color:'#2764ff'}}>v2</span></h1>
    <p style={{color:'#94a3b8',marginTop:0}}>Discover → Track → Validate → Source → Sample → Sell → Scale</p>

    <section style={{marginTop:32}}><h2>Products</h2>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12}}>
      {p.length ? p.map((x:any)=><article key={x.id} style={{background:'#111821',padding:18,borderRadius:14,border:'1px solid #1e293b'}}>
        <div style={{fontSize:12,color:'#94a3b8'}}>{n(x.status).toUpperCase()} · PRIORITY {n(x.priority)}</div>
        <h3 style={{margin:'8px 0'}}>{[x.vehicle_make,x.vehicle_model,x.chassis].filter(Boolean).join(' ')} {x.part_type}</h3>
        <div style={{color:'#94a3b8'}}>Opportunity score: {n(x.opportunity_score)}</div>
      </article>) : <p style={{color:'#94a3b8'}}>No products yet. Import the legacy dataset after setup.</p>}
      </div>
    </section>

    <section style={{marginTop:40}}><h2>Observation queue</h2>
      <div style={{overflowX:'auto',background:'#111821',borderRadius:14,border:'1px solid #1e293b'}}>
      <table style={{borderCollapse:'collapse',width:'100%',fontSize:14}}><thead><tr>{['Listing','Title','Seller','Last observed','Next due','Active'].map(h=><th key={h} style={{textAlign:'left',padding:12,borderBottom:'1px solid #1e293b',color:'#94a3b8'}}>{h}</th>)}</tr></thead>
      <tbody>{l.map((x:any)=><tr key={x.id}><td style={{padding:12,borderBottom:'1px solid #1e293b'}}>#{x.listing_id}</td><td style={{padding:12,borderBottom:'1px solid #1e293b'}}>{n(x.title)}</td><td style={{padding:12,borderBottom:'1px solid #1e293b'}}>{n(x.seller)}</td><td style={{padding:12,borderBottom:'1px solid #1e293b'}}>{n(x.last_observed_at)}</td><td style={{padding:12,borderBottom:'1px solid #1e293b'}}>{n(x.next_observation_at)}</td><td style={{padding:12,borderBottom:'1px solid #1e293b'}}>{x.active?'yes':'no'}</td></tr>)}</tbody></table>
      </div>
    </section>
  </main>;
}
