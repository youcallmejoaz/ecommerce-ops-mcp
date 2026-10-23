"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/chat", label: "Ask Claude" },
  { href: "/queue", label: "Approval queue" },
  { href: "/activity", label: "Activity log" },
  { href: "/products", label: "Products" },
  { href: "/purchase-orders", label: "Purchase orders" },
  { href: "/campaigns", label: "Sent campaigns" },
  { href: "/briefings", label: "Weekly reviews" },
  { href: "/limits", label: "Limits" },
];

export function Nav({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : ""}>
            {l.label}
            {l.href === "/queue" && pending > 0 ? <span className="count" data-testid="pending-count">{pending}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
