import {NextResponse} from 'next/server';
import {cobaltAccessToken} from '../../../lib/accessToken';

const COOKIE='cobalt_access';

export async function POST(req:Request){
 try{
  const {pin}=await req.json();
  const expected=process.env.COBALT_ACCESS_PIN;
  const secret=process.env.COBALT_ACCESS_SECRET;
  if(!expected||!secret)return NextResponse.json({error:'Access gate is not configured.'},{status:503});
  if(String(pin||'')!==expected)return NextResponse.json({error:'Incorrect access code.'},{status:401});
  const token=await cobaltAccessToken(expected,secret);
  const res=NextResponse.json({ok:true});
  res.cookies.set(COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:60*60*24*180});
  return res;
 }catch{
  return NextResponse.json({error:'Unable to verify access code.'},{status:400});
 }
}

export async function DELETE(){
 const res=NextResponse.json({ok:true});
 res.cookies.set(COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:0});
 return res;
}
