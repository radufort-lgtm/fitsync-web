import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { LayoutDashboard, History, Users, User } from "lucide-react";
import { useApp } from "@/context/AppContext";

const TABS = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/history", label: "History", Icon: History },
  { href: "/friends", label: "Friends", Icon: Users },
  { href: "/profile", label: "Profile", Icon: User },
];

export default function BottomNav() {
  const [location] = useLocation();
  const { unreadCount } = useApp();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-sm border-t border-border pb-safe">
      <div className="flex items-center justify-around max-w-lg mx-auto px-2 pt-2 pb-2">
        {TABS.map(({ href, label, Icon }) => {
          const isActive = location === href || location.startsWith(href + "/");
          const showBadge = label === "Friends" && unreadCount > 0;
          return (
            <Link key={href} href={href}>
              <button
                data-testid={`nav-${label.toLowerCase()}`}
                className="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl relative"
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-primary/15 rounded-xl"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <div className="relative">
                  <Icon
                    className={`w-5 h-5 relative z-10 transition-colors duration-150 ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  {showBadge && (
                    <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full z-20 border border-card" />
                  )}
                </div>
                <span
                  className={`text-[10px] font-medium relative z-10 transition-colors duration-150 ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
