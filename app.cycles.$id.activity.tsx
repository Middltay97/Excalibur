import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { TEAMS } from "@/lib/teams";

export const Route = createFileRoute("/app/admin/users")({
  component: UsersPage,
});

type Role = "admin" | "verifier" | "counter";
const ALL_ROLES: Role[] = ["admin", "verifier", "counter"];

interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  badge_id: string | null;
  team_id: string | null;
  created_at: string;
  roles: Role[];
}

async function callAdmin<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

function UsersPage() {
  const { isAdmin, user: me } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => callAdmin<{ users: AdminUser[] }>("list"),
    enabled: isAdmin,
  });

  const setRoles = useMutation({
    mutationFn: ({ user_id, roles }: { user_id: string; roles: Role[] }) =>
      callAdmin("set-roles", { user_id, roles }),
    onSuccess: () => {
      toast.success("Roles updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setBadge = useMutation({
    mutationFn: ({ user_id, badge_id }: { user_id: string; badge_id: string }) =>
      callAdmin("set-roles", { user_id, badge_id }),
    onSuccess: () => {
      toast.success("Badge ID saved");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setTeam = useMutation({
    mutationFn: ({ user_id, team_id }: { user_id: string; team_id: string | null }) =>
      callAdmin("set-roles", { user_id, team_id }),
    onSuccess: () => {
      toast.success("Team updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (user_id: string) => callAdmin("delete", { user_id }),
    onSuccess: () => {
      toast.success("User deleted");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPw = useMutation({
    mutationFn: ({ user_id, password }: { user_id: string; password: string }) =>
      callAdmin("reset-password", { user_id, password }),
    onSuccess: () => toast.success("Password updated"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-foreground">
        Admins only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CreateUserCard />

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-xl font-semibold text-foreground">Users</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Toggle role chips to grant or revoke. Users can hold multiple roles.
          </p>
        </div>
        {isLoading && <div className="px-6 py-8 text-sm text-muted-foreground">Loading…</div>}
        {error && (
          <div className="px-6 py-8 text-sm text-destructive">{(error as Error).message}</div>
        )}
        {data && (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">User</th>
                <th className="px-6 py-3 font-medium">Badge ID</th>
                <th className="px-6 py-3 font-medium">Team</th>
                <th className="px-6 py-3 font-medium">Roles</th>
                <th className="px-6 py-3 font-medium">Created</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-6 py-4">
                    <div className="font-medium text-foreground">{u.full_name ?? u.email}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-6 py-4">
                    <BadgeCell user={u} onSave={(badge_id) => setBadge.mutate({ user_id: u.id, badge_id })} pending={setBadge.isPending} />
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={u.team_id ?? ""}
                      disabled={setTeam.isPending}
                      onChange={(e) =>
                        setTeam.mutate({ user_id: u.id, team_id: e.target.value || null })
                      }
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                    >
                      <option value="">— None —</option>
                      {TEAMS.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_ROLES.map((role) => {
                        const active = u.roles.includes(role);
                        return (
                          <button
                            key={role}
                            disabled={setRoles.isPending}
                            onClick={() => {
                              const next = active
                                ? u.roles.filter((r) => r !== role)
                                : [...u.roles, role];
                              setRoles.mutate({ user_id: u.id, roles: next });
                            }}
                            className={
                              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
                              (active
                                ? "bg-primary text-primary-foreground"
                                : "border border-border text-muted-foreground hover:bg-accent")
                            }
                          >
                            {role}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => {
                          const pw = prompt(`Set new password for ${u.email} (min 6 characters):`);
                          if (pw === null) return;
                          const trimmed = pw.trim();
                          if (trimmed.length < 6) {
                            toast.error("Password must be at least 6 characters");
                            return;
                          }
                          resetPw.mutate({ user_id: u.id, password: trimmed });
                        }}
                        disabled={resetPw.isPending}
                        className="text-sm text-foreground hover:underline disabled:opacity-50"
                      >
                        Reset password
                      </button>
                      {u.id !== me?.id && (
                        <button
                          onClick={() => {
                            if (confirm(`Delete ${u.email}? This cannot be undone.`)) {
                              del.mutate(u.id);
                            }
                          }}
                          className="text-sm text-destructive hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data.users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BadgeCell({ user, onSave, pending }: { user: AdminUser; onSave: (badge_id: string) => void; pending: boolean }) {
  const [val, setVal] = useState(user.badge_id ?? "");
  const dirty = val !== (user.badge_id ?? "");
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="—"
        className="w-28 rounded-md border border-input bg-background px-2 py-1 text-xs"
      />
      {dirty && (
        <button
          disabled={pending}
          onClick={() => onSave(val.trim())}
          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
      )}
    </div>
  );
}

function CreateUserCard() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [teamId, setTeamId] = useState<string>("");
  const [roles, setRoles] = useState<Role[]>(["counter", "verifier"]);

  const create = useMutation({
    mutationFn: () =>
      callAdmin("create", {
        email,
        password,
        full_name: fullName || null,
        roles,
        badge_id: badgeId.trim() || null,
        team_id: teamId || null,
      }),
    onSuccess: () => {
      toast.success("User created");
      setEmail("");
      setPassword("");
      setFullName("");
      setBadgeId("");
      setTeamId("");
      setRoles(["counter", "verifier"]);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRole = (r: Role) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-xl font-semibold text-foreground">Add user</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates a confirmed account with the selected roles. Share the password with the user.
        </p>
      </div>
      <form
        className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email || !password) {
            toast.error("Email and password are required");
            return;
          }
          create.mutate();
        }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Jane Counter"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="user@example.com"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Temporary password</label>
          <input
            type="text"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            placeholder="at least 6 characters"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Badge ID</label>
          <input
            value={badgeId}
            onChange={(e) => setBadgeId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            placeholder="e.g. 1042"
          />
          <p className="mt-1 text-xs text-muted-foreground">Used for mobile counter sign-in.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Field Team</label>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— None —</option>
            {TEAMS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Roles</label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_ROLES.map((r) => {
              const active = roles.includes(r);
              return (
                <button
                  type="button"
                  key={r}
                  onClick={() => toggleRole(r)}
                  className={
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
                    (active
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-accent")
                  }
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create user"}
          </button>
        </div>
      </form>
    </div>
  );
}
