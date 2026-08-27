'use client';

// src/app/global-error.js — the last boundary.
//
// (app)/error.js catches anything thrown inside the workspace, but it renders
// *within* the root layout, so it cannot catch a failure in the root layout
// itself. That case previously produced a blank white page with the error only
// in the console. This boundary replaces the whole document, which is why it
// has to render its own <html> and cannot rely on any provider.

import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="uk">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif', background: '#f4f4f5' }}>
        <div style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            maxWidth: 420,
            width: '100%',
            background: '#fff',
            border: '1px solid #e9e9e9',
            borderRadius: 16,
            padding: 32,
            textAlign: 'center',
            boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
          }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1f1f1f', margin: '0 0 8px' }}>
              qTicket не завантажився
            </h1>
            <p style={{ fontSize: 13, color: '#9a9a9a', margin: '0 0 24px' }}>
              Сталася помилка ще до запуску інтерфейсу. Ваші дані не втрачені.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: 36,
                padding: '0 18px',
                borderRadius: 10,
                border: 0,
                background: '#1f1f1f',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Спробувати ще раз
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
