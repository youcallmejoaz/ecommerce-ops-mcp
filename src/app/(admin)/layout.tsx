import { Nav } from "@/components/Nav";
import { requireUser } from "@/lib/auth";
import { ctx } from "@/lib/ctx";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const c = ctx();
  const pending = (c.db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status = 'pending'").get() as { n: number }).n;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="dot" />Fernleaf Ops</div>
        <Nav pending={pending} />
        <div className="who">
          Signed in as <b>{user}</b>
          <br />
          Store day {c.today}
          <form action={logout}><button type="submit">Sign out</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
