import { Link } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@tanstack/react-router";
import { usePortal } from "@/contexts/portal-context";
import { PortalSwitcher } from "@/components/portal-switcher";

interface SidebarCtx {
  collapsed: boolean;
  toggle: () => void;
}
const SidebarContext = createContext<SidebarCtx>({ collapsed: true, toggle: () => {} });

const STORAGE_KEY = "cr-sidebar-collapsed";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setCollapsed(stored === "1");
    } catch {}
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>{children}</SidebarContext.Provider>
  );
}

export function AppHeader({ title }: { title: string }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { portal } = usePortal();

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 no-print transition-colors">
      <div className="flex items-center gap-3">
        <PortalSwitcher />
        {title && (
          <h1 className="ml-2 text-lg font-semibold text-foreground">
            {title}
            <span className="ml-2 text-xs font-medium text-muted-foreground">
              · {portal.name} Portal
            </span>
          </h1>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{user?.email}</span>
        <button
          className="rounded-md border border-border bg-background/60 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          onClick={async () => {
            await signOut();
            router.navigate({ to: "/login" });
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  adminOrVerifier?: boolean;
}

const NAV: NavItem[] = [
  { to: "/app/dashboard", label: "Dashboard", icon: "▦" },
  { to: "/app/cycles", label: "Cycle Counts", icon: "▤" },
  { to: "/app/verify", label: "Verify Counts", icon: "✓" },
  { to: "/app/performance", label: "Performance", icon: "▨", adminOrVerifier: true },
  { to: "/app/reports", label: "Reports", icon: "▣", adminOrVerifier: true },
  { to: "/app/admin/users", label: "Users & Roles", icon: "◉", adminOnly: true },
  { to: "/app/admin/diagnostics", label: "Scan Diagnostics", icon: "△", adminOnly: true },
  { to: "/app/settings", label: "Settings", icon: "◎" },
];

export function AppSidebar() {
  const { isAdmin, isVerifier } = useAuth();
  const { collapsed, toggle } = useContext(SidebarContext);
  const { portal } = usePortal();
  const visible = NAV.filter(
    (n) => (!n.adminOnly || isAdmin) && (!n.adminOrVerifier || isAdmin || isVerifier),
  );
  const width = collapsed ? "w-16" : "w-64";
  return (
    <aside
      className={`sticky top-0 z-30 flex h-screen ${width} flex-col bg-sidebar text-sidebar-foreground no-print transition-[width] duration-200 ease-in-out`}
    >
      <div
        className={`flex h-16 items-center border-b border-sidebar-border ${collapsed ? "justify-center px-2" : "gap-3 px-6"}`}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-white">
          <img src={portal.emblem} alt={`${portal.name} emblem`} className="h-full w-full object-contain" />
        </div>
        {!collapsed && (
          <>
            <div className="text-sm font-semibold">{portal.name}</div>
            <button
              onClick={toggle}
              aria-label="Collapse navigation"
              className="ml-auto rounded-md p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              ‹
            </button>
          </>
        )}
      </div>
      {collapsed && (
        <button
          onClick={toggle}
          aria-label="Expand navigation"
          className="mx-2 mt-2 rounded-md p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          ›
        </button>
      )}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visible.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            className={`flex items-center rounded-md text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2"}`}
            activeProps={{
              className: `flex items-center rounded-md text-sm bg-sidebar-accent text-sidebar-accent-foreground font-medium ${collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2"}`,
            }}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}
      </nav>
      {!collapsed && (
        <div className="border-t border-sidebar-border p-3 text-xs text-sidebar-foreground/50">
          v1.0 — PWA ready
        </div>
      )}
    </aside>
  );
}
