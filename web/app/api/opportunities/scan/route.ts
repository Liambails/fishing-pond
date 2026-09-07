import {NextResponse} from 'next/server';
import {adminClient} from '../../../../lib/supabase';
import {scanOpportunities} from '../../../../lib/opportunities';

export async function POST(req:Request){
 try{
  const expected=process.env.COBALT_INGEST_TOKEN||process.env.FISHING_POND_INGEST_TOKEN;
  const supplied=req.headers.get('x-cobalt-token')||req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(expected&&supplied!==expected)return NextResponse.json({error:'Unauthorized'},{status:401});
  return NextResponse.json(await scanOpportunities(adminClient()));
 }catch(e:any){return NextResponse.json({error:e.message||'Opportunity scan failed'},{status:500})}
}
