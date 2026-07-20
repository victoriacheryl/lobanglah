import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Compass, PlusCircle, LayoutList, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ShieldCheck, Wallet, LogOut, Users } from "lucide-react";

function ToolbarLink({
  href,
  icon: Icon,
  label,
  testId,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  testId: string;
}) {
  const [location] = useLocation();
  const active = location === href;
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground"
      }`}
    >
      <Icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} />
      {label}
    </Link>
  );
}

export function BottomToolbar() {
  const { user, logout } = useAuth();

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "";

  return (
    <nav
      data-testid="nav-bottom-toolbar"
      className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-border bg-background/95 backdrop-blur flex items-stretch pb-[env(safe-area-inset-bottom)]"
    >
      <ToolbarLink href="/" icon={Compass} label="Browse" testId="tab-browse" />
      <ToolbarLink
        href={user ? "/post" : "/register"}
        icon={PlusCircle}
        label="Post a Lobang"
        testId="tab-post"
      />
      <ToolbarLink
        href={user ? "/my-listings" : "/login"}
        icon={LayoutList}
        label="My Lobangs"
        testId="tab-my-listings"
      />
      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="tab-account"
              className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground"
            >
              <Avatar className="h-5 w-5">
                <AvatarFallback className="bg-primary text-primary-foreground text-[9px]">{initials}</AvatarFallback>
              </Avatar>
              <span className="truncate max-w-[60px]">{user.name.split(" ")[0]}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem asChild>
              <Link href="/wallet" className="flex items-center gap-2 w-full">
                <Wallet className="h-4 w-4" /> Wallet
              </Link>
            </DropdownMenuItem>
            {user.isAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin" className="flex items-center gap-2 w-full">
                  <ShieldCheck className="h-4 w-4" /> Admin Review
                </Link>
              </DropdownMenuItem>
            )}
            {user.isAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin/users" className="flex items-center gap-2 w-full">
                  <Users className="h-4 w-4" /> User List
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="button-logout-toolbar" onClick={logout} className="flex items-center gap-2">
              <LogOut className="h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <ToolbarLink href="/login" icon={UserIcon} label="Log in" testId="tab-account" />
      )}
    </nav>
  );
}
