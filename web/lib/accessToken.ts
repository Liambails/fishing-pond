export async function cobaltAccessToken(pin:string,secret:string){
 const bytes=new TextEncoder().encode(`${pin}:${secret}`);
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
