// scripts/ui-kit-showcase.mjs — where the catalogue's source lives.
//
// The catalogue used to be one 3300-line file, and three tools each held their
// own copy of that assumption: two scripts and a test sliced it by string index
// and read section bodies as "from `function XSection(` to the next `function`".
// That is why a preview only counted when it sat directly inside a section
// function — pull one block into a helper and coverage silently dropped.
//
// It is a directory now: page.js is the shell (navigation, SECTION_MAP), and
// each section is a story file named after its id. A story counts in full, so
// helpers inside it count too, and this module is the only place that knows it.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SHOWCASE_DIR = join(ROOT, 'src', 'app', 'ui-kit');
export const PAGE_FILE = join(SHOWCASE_DIR, 'page.js');
export const STORIES_DIR = join(SHOWCASE_DIR, 'sections');

// Shared preview furniture. Deliberately not a story: PreviewBlock renders no
// kit component, and a helper must not be able to grant coverage on its own.
const SUPPORT_FILES = ['preview.jsx', 'demo-data.js'];

export function readShowcase() {
  const page = readFileSync(PAGE_FILE, 'utf8');
  const groupsSource = page.slice(page.indexOf('const GROUPS'), page.indexOf('const SECTIONS'));
  const mapSource = page.slice(page.indexOf('const SECTION_MAP'), page.indexOf('// MAIN PAGE'));

  // Navigation order is the catalogue's order; a story file nobody navigates to
  // is not part of the catalogue.
  const visibleSectionIds = [...groupsSource.matchAll(/\{\s*id:\s*'([^']+)'/g)].map(match => match[1]);
  const renderedSectionIds = [...mapSource.matchAll(/^\s*(?:'([^']+)'|([a-z][\w-]*)):\s*</gm)]
    .map(match => match[1] || match[2]);

  const storyFiles = readdirSync(STORIES_DIR).filter(name => name.endsWith('.jsx')).sort();
  const stories = storyFiles.map(name => ({
    id: name.replace(/\.jsx$/, ''),
    file: join(STORIES_DIR, name),
    source: readFileSync(join(STORIES_DIR, name), 'utf8'),
  }));
  const visibleStories = visibleSectionIds
    .map(id => stories.find(story => story.id === id))
    .filter(Boolean);

  const support = SUPPORT_FILES.map(name => readFileSync(join(SHOWCASE_DIR, name), 'utf8'));

  return {
    page,
    groupsSource,
    mapSource,
    visibleSectionIds,
    renderedSectionIds,
    stories,
    visibleStories,
    // Everything the catalogue is made of, for "does /ui-kit contain this at
    // all" questions that do not care which file holds the answer.
    everything: [page, ...support, ...stories.map(story => story.source)].join('\n'),
  };
}
