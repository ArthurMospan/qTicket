import test from 'node:test';
import assert from 'node:assert/strict';
import nextConfig from '../next.config.mjs';

test('every route receives the baseline browser security headers', async () => {
  const rules = await nextConfig.headers();
  const globalRule = rules.find(rule => rule.source === '/:path*');
  assert.ok(globalRule, 'missing global header rule');

  const headers = new Map(globalRule.headers.map(header => [header.key, header.value]));
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('X-Frame-Options'), 'SAMEORIGIN');
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.match(headers.get('Permissions-Policy'), /camera=\(\)/);
  assert.match(headers.get('Permissions-Policy'), /geolocation=\(\)/);
});

// A content policy, reported and not enforced.
//
// Enforcing a wrong one is the most complete way to break a web application:
// a single missing host takes out fonts, avatars, uploads and the Firestore
// connection at once, in production. Report-Only blocks nothing and posts what
// it would have blocked, so the list can be corrected against real traffic.
// This test holds the shape and the hosts that were read out of the source —
// it does not claim the list is complete, which is what the reports are for.
test('the content policy names what the product actually reaches, and only reports', async () => {
  const rules = await nextConfig.headers();
  const headers = new Map(rules.find(rule => rule.source === '/:path*').headers.map(h => [h.key, h.value]));

  const policy = headers.get('Content-Security-Policy-Report-Only');
  assert.ok(policy, 'missing Content-Security-Policy-Report-Only');
  // Enforcing is a deliberate later step, not something to arrive by accident.
  assert.equal(headers.has('Content-Security-Policy'), false);

  const directives = new Map(policy.split('; ').map(part => {
    const [name, ...values] = part.split(' ');
    return [name, values];
  }));

  assert.deepEqual(directives.get('default-src'), ["'self'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('frame-ancestors'), ["'self'"]);

  // Every host here is in the source, and every one of these would break a
  // visible thing if the policy were enforced without it.
  const hosts = {
    'img-src': ['https://res.cloudinary.com', 'https://lh3.googleusercontent.com', 'https://avatars.githubusercontent.com'],
    'connect-src': ['https://*.googleapis.com', 'https://api.cloudinary.com'],
    'frame-src': ['https://view.officeapps.live.com'],
    'form-action': ['https://account.oneb.app', 'https://oneb.app'],
  };
  for (const [directive, expected] of Object.entries(hosts)) {
    for (const host of expected) {
      assert.ok(directives.get(directive)?.includes(host), `${directive} is missing ${host}`);
    }
  }

  // next/font self-hosts, so Google Fonts is deliberately absent — the one
  // reference to it in the source renders an OG image on the server.
  assert.doesNotMatch(policy, /fonts\.googleapis\.com/);
});
