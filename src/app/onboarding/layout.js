// src/app/onboarding/layout.js — title only.
// The page itself is a client component and cannot export metadata, so the
// segment carries it. Without this the tab said "QuickTeam" here too.
export const metadata = {
  title: 'Створення команди',
  description: 'Перший крок: назвіть команду і запросіть колег.',
};

export default function Layout({ children }) {
  return children;
}
