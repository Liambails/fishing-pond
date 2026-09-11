import { Suspense } from 'react';
import AccessClient from './AccessClient';

export default function AccessPage() {
  return (
    <Suspense fallback={<div style={{minHeight:'100vh',background:'#07111d'}} />} >
      <AccessClient />
    </Suspense>
  );
}
