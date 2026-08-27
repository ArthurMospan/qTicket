// src/app/robots.js
//
// A private workspace has nothing to gain from being crawled, and every
// authenticated path a crawler records is structure it discloses. The meta tag
// in the root layout only covers pages a crawler already fetched; this stops it
// fetching them.

export default function robots() {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
