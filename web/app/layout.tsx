import type { ReactNode } from 'react';

export const metadata = { title: 'Fishing Pond', description: 'Motera product opportunity tracker' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{margin:0,fontFamily:'Inter,ui-sans-serif,system-ui',background:'#090d12',color:'#f8fafc'}}>{children}</body></html>;
}
