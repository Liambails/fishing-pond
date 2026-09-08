import {NextResponse} from 'next/server';

// V3.9.18+ deliberately removed automatic promotion from research evidence into My Products.
// Keep this legacy route as a non-mutating tombstone so an old client/job cannot silently recreate
// commercial Products. Product creation is an explicit operator decision via /api/products.
export async function POST(){
 return NextResponse.json({
  ok:false,
  disabled:true,
  error:'Automatic product promotion is disabled. Review sourcing leads in Opportunities and create a Product explicitly.'
 },{status:410});
}
