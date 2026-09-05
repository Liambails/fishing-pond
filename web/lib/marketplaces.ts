export type MarketplaceIdentity={marketplace:string;listingId:string|null;canonicalUrl:string;collectorKey:string|null;collectorSupported:boolean};

function stripTracking(url:URL){url.hash='';['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(k=>url.searchParams.delete(k));return url;}

export function detectMarketplace(input:string,explicitMarketplace?:string|null,explicitListingId?:string|null):MarketplaceIdentity{
  const u=stripTracking(new URL(input));
  const host=u.hostname.toLowerCase().replace(/^www\./,'');
  let marketplace=explicitMarketplace?.trim()||'';
  let listingId=explicitListingId?.trim()||null;
  let canonicalUrl=`${u.origin}${u.pathname}`;
  let collectorKey:string|null=null;
  let collectorSupported=false;

  if(host==='trademe.co.nz'){
    marketplace='Trade Me';collectorKey='trademe';collectorSupported=true;
    listingId=listingId||u.pathname.match(/\/listing\/(\d+)/)?.[1]||null;
    canonicalUrl=`https://www.trademe.co.nz${u.pathname}`;
  }else if(host.endsWith('ebay.com')||host.endsWith('ebay.co.nz')||host.endsWith('ebay.com.au')){
    marketplace='eBay';collectorKey='ebay';collectorSupported=false;
    listingId=listingId||u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/)?.[1]||u.searchParams.get('item')||null;
    canonicalUrl=listingId?`${u.protocol}//${u.host}/itm/${listingId}`:`${u.origin}${u.pathname}`;
  }else{
    marketplace=marketplace||host;collectorKey=null;collectorSupported=false;
  }
  return {marketplace,listingId,canonicalUrl,collectorKey,collectorSupported};
}

export function marketplaceCode(name:string){
  const n=String(name||'Marketplace').toUpperCase();
  if(n.includes('TRADE'))return 'TM';
  if(n.includes('EBAY'))return 'EBAY';
  return n.replace(/[^A-Z0-9]/g,'').slice(0,4)||'MP';
}
