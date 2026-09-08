/** Fetch PostgREST rows in stable pages instead of silently stopping at one server row cap.
 *
 * `build` must return a fresh Supabase query builder each time. `maxRows` is a deliberate safety
 * ceiling, not an implicit data limit; callers should size it for the surface they are loading.
 */
export async function fetchPaged(build:()=>any,pageSize=1000,maxRows=100000){
 const out:any[]=[];
 for(let from=0;from<maxRows;from+=pageSize){
  const to=Math.min(from+pageSize-1,maxRows-1);
  const {data,error}=await build().range(from,to);
  if(error)throw error;
  const rows=data||[];
  out.push(...rows);
  if(rows.length<pageSize)break;
 }
 return out;
}
