import InviteLandingClient from './InviteLandingClient';

// The invite-link landing, `/invite/<token>`. Deliberately not under the `(app)`
// group: the visitor has no organization yet and the workspace shell assumes
// one.
//
// The metadata is a server export so the tab is never briefly called «qTicket»
// before hydration — and it deliberately says nothing about which company sent
// the invitation. This URL is pasted into messengers, and an unfurl that
// announced the tenant and their client space would tell every other reader of
// that group chat who is buying support from whom. The organization's brand
// appears on the page, to the person who opened it; it does not travel with the
// link. `robots` is already `noindex` for the whole app.
export const metadata = {
  title: { absolute: 'Запрошення' },
  openGraph: {
    title: 'Запрошення',
    description: 'Відкрийте посилання, щоб отримати доступ до порталу підтримки.',
  },
};

export default function InvitePage() {
  return <InviteLandingClient />;
}
