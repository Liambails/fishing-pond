import { Suspense } from 'react';
import AccessClient from './AccessClient';

export default function AccessPage() {
  return (
    <Suspense fallback={null}>
      <AccessClient />
    </Suspense>
  );
}
