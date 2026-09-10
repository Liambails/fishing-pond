import {NextRequest,NextResponse} from 'next/server';
import {cobaltAccessToken} from './lib/accessToken';

const COOKIE='cobalt_access';

export async function middleware(req:NextRequest){
 const pin=process.env.COBALT_ACCESS_PIN;
 const secret=process.env.COBALT_ACCESS_SECRET;

 // Production fails closed if the gate was requested but its environment is incomplete.
 if(process.env.NODE_ENV==='production'&&(!pin||!secret)){
  return new NextResponse('COBALT access gate is not configured.',{status:503});
 }
 if(!pin||!secret)return NextResponse.next();

 const expected=await cobaltAccessToken(pin,secret);
 if(req.cookies.get(COOKIE)?.value===expected)return NextResponse.next();

 const url=req.nextUrl.clone();
 url.pathname='/access';
 url.searchParams.set('next',req.nextUrl.pathname+req.nextUrl.search);
 return NextResponse.redirect(url);
}

export const config={
 matcher:['/((?!api|access|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|robots.txt).*)']
};
