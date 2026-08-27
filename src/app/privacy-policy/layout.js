// src/app/privacy-policy/layout.js — title only.
// The page itself is a client component and cannot export metadata, so the
// segment carries it. Without this the tab said "QuickTeam" here too.
export const metadata = {
  title: 'Політика конфіденційності',
  description: 'Які дані QuickTeam зберігає і навіщо.',
};

export default function Layout({ children }) {
  return children;
}
