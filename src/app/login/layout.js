// src/app/login/layout.js — title only.
// The page itself is a client component and cannot export metadata, so the
// segment carries it.
export const metadata = {
  title: 'Вхід',
  description: 'Вхід у простір підтримки qTicket.',
};

export default function Layout({ children }) {
  return children;
}
