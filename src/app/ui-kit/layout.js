// src/app/ui-kit/layout.js — title only.
// The page itself is a client component and cannot export metadata, so the
// segment carries it. Without this the tab said "QuickTeam" here too.
export const metadata = {
  title: 'UI Kit',
  description: 'Каталог спільних компонентів QuickTeam.',
};

export default function Layout({ children }) {
  return children;
}
