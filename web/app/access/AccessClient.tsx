'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AccessClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const next = searchParams.get('next') || '/';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin }),
      });

      if (!res.ok) {
        setError('Incorrect PIN');
        return;
      }

      try {
        localStorage.setItem('cobalt_access_granted', '1');
      } catch {}

      router.replace(next);
      router.refresh();
    } catch {
      setError('Unable to verify access');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          COBALT
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Enter the access PIN to continue.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-500"
          />

          {error ? (
            <p className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting || !pin}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  );
}
