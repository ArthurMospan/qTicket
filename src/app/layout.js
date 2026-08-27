// src/app/layout.js — Root layout
import './globals.css';
import { AppProvider } from '@/lib/context/AppContext';
import AutoFix from '@/components/AutoFix';
import Script from 'next/script';
import { Inter, Roboto_Condensed } from 'next/font/google';
import { SIDEBAR_THEME_VERSION } from '@/lib/utils/sidebarTheme';

// Keep both product typefaces on our own origin. The old CSS @import made the
// first paint wait on two browser-side Google requests and occasionally left
// the UI Kit (and a real user) on fallback metrics when either request failed.
const inter = Inter({
  subsets: ['cyrillic', 'latin'],
  display: 'swap',
  variable: '--font-inter-loaded',
});

const robotoCondensed = Roboto_Condensed({
  subsets: ['cyrillic', 'latin'],
  display: 'swap',
  variable: '--font-roboto-loaded',
});

// `opengraph-image.js` renders the card; Next only turns it into an absolute
// URL if it knows where the app lives. The same variable the invite links and
// the emails already resolve against, so there is one answer to "what is our
// origin" rather than three.
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const OG_DESCRIPTION = 'Система інцидентів і клієнтської підтримки';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  // `template` is what makes the tab useful. Every screen sets its own title
  // through it, so a browser with eight qTicket tabs open no longer shows
  // eight tabs reading "qTicket".
  title: {
    default: 'qTicket',
    template: '%s · qTicket',
  },
  description: 'Система інцидентів і клієнтської підтримки qTicket',
  // A workspace link is pasted into a chat dozens of times a day. Without this
  // it unfurled as the bare host: no name, no mark, no hint of what it opens.
  openGraph: {
    type: 'website',
    siteName: 'qTicket',
    locale: 'uk_UA',
    url: SITE_URL,
    title: 'qTicket',
    description: OG_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'qTicket',
    description: OG_DESCRIPTION,
  },
  applicationName: 'qTicket',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/favicon.png', type: 'image/png', sizes: '32x32' },
    ],
    // The 32px favicon was also serving as the home-screen icon, which is why
    // "Add to Home Screen" produced a blurry square.
    apple: { url: '/quickteam.png', sizes: '436x436' },
  },
  appleWebApp: {
    capable: true,
    title: 'qTicket',
    statusBarStyle: 'default',
  },
  // A phone browser turns anything that looks like a phone number, an address
  // or an email address into a link of its own — underlined, in its own blue,
  // over whatever the page said that text should be. A profile's email was
  // underlined on a phone and not on a desktop for exactly this reason. The app
  // draws its own links; nothing here is meant to be guessed at.
  formatDetection: { telephone: false, email: false, address: false },
  // An internal workspace has nothing to gain from being indexed, and every
  // authenticated URL leaks structure if it is.
  robots: { index: false, follow: false },
};

// Deliberately without `viewportFit: 'cover'`. The default fit keeps the home
// indicator and the gesture bar outside the layout viewport, so a fixed bottom
// bar physically cannot slide underneath them; opting into cover would move
// that responsibility into every `env()` call site and one missed inset is a
// tab bar behind the system UI. See --qt-nav-* in globals.css.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays available: disabling it is an accessibility regression,
  // and the app has real 11px type in places. On iOS this is narrowed to 1 at
  // runtime — see IOS_FOCUS_ZOOM_SCRIPT, which explains why that costs nothing.
  maximumScale: 5,
  // Paints the browser's own chrome to match the page, which is what makes the
  // top of the screen read as one surface rather than a site inside a browser.
  themeColor: '#f4f4f5',
  colorScheme: 'light',
};

// Safari on iOS zooms the whole page in whenever a form control smaller than
// 16px takes focus, and it never zooms back out — which is why every screenshot
// taken after tapping a search field shows a page shoved sideways with its
// header cut off. The product's type scale is deliberate and is not going to be
// rewritten to please one browser, so the fix belongs to the viewport.
//
// `maximum-scale=1` is the switch that turns the auto-zoom off, and on iOS it
// costs nothing: since iOS 10 Safari honours it for the automatic zoom but
// ignores it for a pinch, so the reader can still zoom by hand. Android Chrome
// is the opposite — it obeys the cap for pinch and never auto-zooms on focus —
// so the cap is applied on iOS only and every other browser keeps the 5×
// declared above.
const IOS_FOCUS_ZOOM_SCRIPT = `(function(){try{var ua=navigator.userAgent;var iOS=/iP(hone|ad|od)/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1);if(!iOS)return;var m=document.querySelector('meta[name="viewport"]');if(!m)return;m.setAttribute('content','width=device-width, initial-scale=1, maximum-scale=1')}catch(e){}})();`;

// Анти-мигання брендингу: сайдбар рендериться на сервері стандартним темним і
// перефарбовується лише після гідрації React (сотні мс). Цей скрипт виконується
// ДО першого кадру: бере id цієї вкладки з sessionStorage і тільки тему саме
// цієї організації з localStorage (пише її useSidebarThemeBoot), після чого
// через <style> з !important задає [data-app-sb] змінні
// теми. Коли приїжджають живі дані організації — стиль прибирається.
//
// Кеш версіонований: `t.v` мусить збігтися з SIDEBAR_THEME_VERSION. Тема, яку
// цей браузер зберіг за старим алгоритмом, — це копія виводу sidebarTheme.js,
// що малюється з !important до React і виграє в нього. Без перевірки версії
// зміна кольорів рейки не з'являлась би в жодному браузері, який уже мав кеш,
// доки React не забере стиль — а на завантаженні, де рейка не змонтувалась,
// не з'явилась би взагалі ніколи.
//
// Скрипт свідомо НЕ чіпає background-color. Він писав його разом зі змінними, і
// це працювало, доки обидві поверхні з data-app-sb були непрозорі. Мобільний
// таббар — скло: його фон рахується з --sb-bg через color-mix, і
// `background-color: <hex> !important` тихо перебивав усе це суцільною плямою.
// Тепер boot задає лише змінні, а фарбують себе поверхні: обидві малюють
// background з var(--sb-bg), тож !important на змінній так само перебиває
// інлайновий стиль React і анти-мигання лишається тим самим.
const SIDEBAR_BOOT_SCRIPT = `(function(){try{var o=sessionStorage.getItem('qt_active_org_id');if(!o)return;var t=JSON.parse(localStorage.getItem('qt_sidebar_theme:'+o)||'null');if(!t)return;if(t.v!==${SIDEBAR_THEME_VERSION})return;var ok=function(v){return typeof v==='string'&&/^(#[0-9a-fA-F]{3,8}|rgba?\\([0-9.,%\\s]+\\))$/.test(v)};if(!ok(t.bg))return;var map={text:'--sb-text',muted:'--sb-muted',hover:'--sb-hover',active:'--sb-active',border:'--sb-border',mutedProject:'--sb-muted-project',mutedHeader:'--sb-muted-header'};var css='--sb-bg:'+t.bg+' !important;';for(var k in map){if(ok(t[k]))css+=map[k]+':'+t[k]+' !important;'}var s=document.createElement('style');s.id='sb-boot-theme';s.textContent='[data-app-sb]{'+css+'}';document.head.appendChild(s)}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="uk" className={`${inter.variable} ${robotoCondensed.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: IOS_FOCUS_ZOOM_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT_SCRIPT }} />
        <AppProvider>
          <AutoFix />
          {children}
        </AppProvider>
        <Script
          src="https://buggy-bag.vercel.app/buggy-bag-standalone.js"
          data-api-key="4ed8e40e-bfeb-4dff-863e-53a36662254b"
          data-portal-url="https://buggy-bag.vercel.app"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
