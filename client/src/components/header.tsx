import { Link, useLocation } from "wouter";
import { Logo } from "./logo";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ShieldCheck, Wallet, PlusCircle, LayoutList, Menu, Sun, Moon, UserCog, Users, Mail } from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/lib/theme";
import { NotificationBell } from "@/components/notification-bell";

function NavLink({ href, children, onNavigate }: { href: string; children: React.ReactNode; onNavigate?: () => void }) {
  const [location] = useLocation();
  const active = location === href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-testid={`link-nav-${href.replace(/\W+/g, "-")}`}
      className={`text-sm font-medium px-3 py-2 rounded-md transition-colors ${
        active ? "bg-accent text-accent-foreground" : "text-foreground/70 hover:text-foreground hover:bg-secondary"
      }`}
    >
      {children}
    </Link>
  );
}

export function Header() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" data-testid="link-home" className="flex items-center gap-2 text-primary font-display font-semibold text-lg">
          <Logo className="h-7 w-7" />
          LobangLah!
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <NavLink href="/">Browse</NavLink>
          {user && <NavLink href="/post">Post a Lobang</NavLink>}
          {user && <NavLink href="/my-listings">My Lobangs</NavLink>}
          {user && <NavLink href="/wallet">Wallet</NavLink>}
          {user && <NavLink href="/contact">Contact Us</NavLink>}
          {user?.isAdmin && <NavLink href="/admin">Admin</NavLink>}
          {user?.isAdmin && <NavLink href="/admin/users">User List</NavLink>}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <button
            data-testid="button-theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="p-2 rounded-md hover-elevate text-foreground/70 hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <NotificationBell />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button data-testid="button-user-menu" className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover-elevate">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{user.name}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/my-listings" className="flex items-center gap-2 w-full"><LayoutList className="h-4 w-4" /> My Lobangs</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/wallet" className="flex items-center gap-2 w-full"><Wallet className="h-4 w-4" /> Wallet</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/contact" className="flex items-center gap-2 w-full"><Mail className="h-4 w-4" /> Contact Us</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="flex items-center gap-2 w-full" data-testid="link-nav-profile"><UserCog className="h-4 w-4" /> Profile</Link>
                </DropdownMenuItem>
                {user.isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin" className="flex items-center gap-2 w-full"><ShieldCheck className="h-4 w-4" /> Admin Review</Link>
                  </DropdownMenuItem>
                )}
                {user.isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin/users" className="flex items-center gap-2 w-full"><Users className="h-4 w-4" /> User List</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem data-testid="button-logout" onClick={logout}>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Link href="/login" asChild>
                <Button variant="ghost" size="sm" data-testid="link-login">Log in</Button>
              </Link>
              <Link href="/register" asChild>
                <Button size="sm" className="gap-1.5" data-testid="link-register">
                  <PlusCircle className="h-4 w-4" /> Sign up
                </Button>
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <button
            data-testid="button-theme-toggle-mobile"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="p-2 rounded-md hover-elevate text-foreground/70 hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <NotificationBell />
          {!user && (
            <Link href="/register" asChild>
              <Button size="sm" className="gap-1 ml-1" data-testid="link-register-mobile">
                Sign up
              </Button>
            </Link>
          )}
          <button
            data-testid="button-mobile-menu"
            className="p-2 rounded-md hover-elevate"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border px-4 py-3 flex flex-col gap-1">
          {user && <NavLink href="/profile" onNavigate={() => setMobileOpen(false)}>Profile</NavLink>}
          {user && <NavLink href="/wallet" onNavigate={() => setMobileOpen(false)}>Wallet</NavLink>}
          {user && <NavLink href="/contact" onNavigate={() => setMobileOpen(false)}>Contact Us</NavLink>}
          {user?.isAdmin && <NavLink href="/admin" onNavigate={() => setMobileOpen(false)}>Admin</NavLink>}
          {user?.isAdmin && <NavLink href="/admin/users" onNavigate={() => setMobileOpen(false)}>User List</NavLink>}
          <div className="h-px bg-border my-2" />
          {user ? (
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => { logout(); setMobileOpen(false); }} data-testid="button-logout-mobile">
              Log out ({user.name})
            </Button>
          ) : (
            <Link href="/login" asChild onClick={() => setMobileOpen(false)}>
              <Button variant="ghost" size="sm" data-testid="link-login-mobile">Log in</Button>
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
