import type { CapacitorConfig } from '@capacitor/cli';

// IMPORTANT — read before building for real devices:
// LobangLah! has a live Express backend (auth, listings, bids, escrow, Stripe) and
// isn't a static site, so the native app is configured to load the deployed
// website directly (the same pattern as "wrap my PWA" apps) rather than bundling
// a static copy of the frontend. That means:
//   1. `server.url` below MUST point at your real HTTPS deployment (a pplx.app
//      URL or your own custom domain) before you build for TestFlight / Play
//      Console. It currently points at a placeholder and the app will fail to
//      load anything until you change it.
//   2. `webDir: 'dist/public'` is kept as a same-origin fallback bundle (used if
//      `server.url` is ever removed for a fully offline-shell build), but as
//      long as `server.url` is set, that's what actually loads.
//   3. Every appId reverse-domain segment below ("sg.lobanglah.app") is a
//      placeholder — swap it for one under a domain you actually control before
//      registering with Apple/Google, since app store listings are tied
//      permanently to this bundle ID once published.
const config: CapacitorConfig = {
  appId: 'sg.lobanglah.app',
  appName: 'LobangLah!',
  webDir: 'dist/public',
  server: {
    url: 'https://lobanglah-production.up.railway.app',
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
