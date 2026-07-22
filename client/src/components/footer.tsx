import { Link } from "wouter";

/**
 * Slim full-width footer bar — copyright bottom-left, legal links
 * bottom-right, modeled after the dark utility bar at the bottom of
 * https://marketplace.lazada.sg/web/home.html (a single-row bar, copyright
 * text on the left, pipe-separated links on the right) but built from the
 * app's own light/dark theme tokens instead of a hardcoded dark color, so it
 * still adapts with the theme toggle in the header.
 *
 * Rendered as a normal (non-fixed) block after <main> in App.tsx, so it sits
 * at the true bottom of the page content. On mobile, <BottomToolbar/> is a
 * fixed bar docked to the viewport bottom — this footer carries the
 * pb-16 md:pb-0 clearance (moved here from <main>) so its content isn't
 * hidden underneath that fixed nav.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-card pb-16 md:pb-0" data-testid="footer-site">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid="text-copyright">Copyright©2026 LobangLah.sg</span>
        <nav className="flex items-center gap-3">
          <Link href="/terms-of-use" className="hover:text-foreground" data-testid="link-footer-terms-of-use">
            Terms of Use
          </Link>
        </nav>
      </div>
    </footer>
  );
}
