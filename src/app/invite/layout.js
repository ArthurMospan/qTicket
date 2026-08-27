// src/app/invite/layout.js — title only.
// The page itself is a client component and cannot export metadata, so the
// segment carries it. Without this the tab said "QuickTeam" here too.
export const metadata = {
  title: 'Запрошення',
  description: 'Приєднання до команди за посиланням-запрошенням.',
};

export default function Layout({ children }) {
  return children;
}
