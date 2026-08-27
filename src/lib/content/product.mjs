// One source for the version, readable from three places that do not share a
// module system: Node (tests import this file directly), the Next server, and
// the browser bundle. `createRequire` covered the first two and broke the
// third — the moment a client component reached this module, `node:module`
// went into the browser chunk and the build failed outright. A JSON import
// with an explicit type attribute is understood by Node and by the bundler.
import packageInfo from '../../../package.json' with { type: 'json' };

export const PRODUCT_NAME = 'qTicket';
export const PRODUCT_VERSION = packageInfo.version;
export const PUBLICATION_DATE = '2026-08-15';
export const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export function canonicalUrl(pathname) {
  return new URL(pathname, SITE_ORIGIN).toString();
}
