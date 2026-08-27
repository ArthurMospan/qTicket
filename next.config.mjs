import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('./package.json');

// What the browser is allowed to fetch, reported rather than enforced.
//
// There is no XSS hole to close here today, and that is worth saying plainly
// rather than implying otherwise: react-markdown runs without rehype-raw so
// authored HTML is escaped, the message tokenizer matches `https?://` and
// nothing else so a `javascript:` URL is never a link, and every external
// anchor carries rel="noopener noreferrer". This is a second lock, not a patch.
//
// Report-Only because a wrong CSP is the most complete way to break a web
// application — one missing host and fonts, avatars, uploads or the Firestore
// connection stop, all at once, in production. In this mode the browser blocks
// nothing and posts what it *would* have blocked, so the list below can be
// corrected against real traffic instead of against my reading of the code.
//
// The hosts are read out of the source rather than guessed: Cloudinary delivers
// and receives every upload, Firestore and Identity Toolkit are what the
// Firebase SDK talks to, the two OAuth providers own the avatar domains, and
// the Office viewer is an iframe in the QuickTeam+ preview. `next/font` self-
// hosts, so Google Fonts is not among them.
//
// `script-src` still allows inline, which is most of what a CSP is for. It is
// deliberate for a first pass: Next.js inlines its own bootstrap and this file
// adds two more scripts, so forbidding it now would fill the report with
// findings that are all the same finding. Nonces are the next step, and they
// are a change to how pages are rendered rather than one more header.
//
// To enforce: rename the key to 'Content-Security-Policy'. Do that after the
// report has been quiet for a while, not before.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self' https://account.oneb.app https://oneb.app",
  "img-src 'self' data: blob: https://res.cloudinary.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
  "media-src 'self' blob: https://res.cloudinary.com",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "frame-src 'self' https://view.officeapps.live.com",
  [
    "connect-src 'self'",
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'wss://*.firebaseio.com',
    'https://api.cloudinary.com',
    'https://res.cloudinary.com',
  ].join(' '),
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Client chrome cannot read package.json at runtime. Expose the package value
  // at build time so the help menu and the public version registry always show
  // the exact version npm/build tooling sees, with no second hand-written copy.
  env: {
    NEXT_PUBLIC_APP_VERSION: packageVersion,
  },
  // Next externalizes firebase-admin by default. With Firebase Admin 14's
  // required subpath exports (`firebase-admin/app`, `/auth`, `/firestore`), the
  // Vercel function trace can omit those runtime modules even though `next
  // build` succeeds. Bundle the package into every server function that uses
  // it so deployed APIs cannot fail during module evaluation.
  transpilePackages: ['firebase-admin'],
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), geolocation=(), browsing-topics=()',
      },
      { key: 'Content-Security-Policy-Report-Only', value: CONTENT_SECURITY_POLICY },
    ];

    if (process.env.NODE_ENV === 'production') {
      securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000',
      });
    }

    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [
      {
        source: '/workspace/:path*',
        destination: '/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
