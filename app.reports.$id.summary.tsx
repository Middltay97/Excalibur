import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { TEAMS, getTeam } from "@/lib/teams";
import { usePortal } from "@/contexts/portal-context";
import {
  computeUserMetrics,
  computeVerifierMetrics,
  aggregateUserMetrics,
  cycleLoiMs,
  hourlyBuckets,
  formatDuration,
  formatPct,
  formatNum,
  type PerfEvent,
  type PerfItem,
  type PerfCycle,
  type PerfProfile,
  type VerifierMetrics,
} from "@/lib/performance";
import {
  ComposedChart,
  Line,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  Cell,
  ReferenceLine,
} from "recharts";

export const Route = createFileRoute("/app/performance")({
  component: PerformancePage,
});

function PerformancePage() {
  const { isAdmin, isVerifier, teamId: myTeamId } = useAuth();
  const { scopedTeamId: portalTeamId, isScoped: portalScoped, portal } = usePortal();
  const allowed = isAdmin || isVerifier;

  const [cycleId, setCycleId] = useState<string>("");
  const [userId, setUserId] = useState<string>("all");
  const [view, setView] = useState<"summary" | "by-count">("summary");
  const [gapMin, setGapMin] = useState<number>(5);
  // Admin-only team filter ("all" or a TeamId). Non-admins are locked to their own team.
  // When a non-Admin portal is active, the portal forces the team scope.
  const [adminTeamFilter, setAdminTeamFilter] = useState<string>("all");
  const activeTeamId = portalScoped
    ? portalTeamId
    : isAdmin
      ? (adminTeamFilter === "all" ? null : adminTeamFilter)
      : (myTeamId ?? null);

  const { data: cycles } = useQuery({
    queryKey: ["perf-cycles"],
    enabled: allowed,
    queryFn: async () => {
      const { data } = await supabase
        .from("cycle_counts")
        .select("id,name,status,count_started_at,count_ended_at")
        .order("created_at", { ascending: false });
      return (data ?? []) as PerfCycle[];
    },
  });

  // "all" = aggregate across every visible cycle (within current portal scope).
  const isAllCycles = cycleId === "all";
  const effectiveCycleId = isAllCycles
    ? "all"
    : cycleId || cycles?.[0]?.id || "";

  const allCycleIds = useMemo(
    () => (cycles ?? []).map((c) => c.id),
    [cycles],
  );

  const { data: bundle, isLoading } = useQuery({
    queryKey: isAllCycles
      ? ["perf-bundle-all", allCycleIds]
      : ["perf-bundle", effectiveCycleId],
    enabled: isAllCycles ? allCycleIds.length > 0 : !!effectiveCycleId,
    queryFn: async () => {
      const eventsBase = supabase
        .from("count_events")
        .select(
          "id,cycle_id,user_id,item_id,action,qty_before,qty_after,created_at",
        )
        .order("created_at", { ascending: true })
        .limit(50000);
      const itemsBase = supabase
        .from("count_items")
        .select(
          "id,cycle_id,sku,description,expected_qty,counted_qty,counted_by,counted_at,verified_at,verified_by,is_unexpected",
        )
        .limit(50000);
      const [eventsRes, itemsRes, profilesRes] = await Promise.all([
        isAllCycles
          ? eventsBase.in("cycle_id", allCycleIds)
          : eventsBase.eq("cycle_id", effectiveCycleId),
        isAllCycles
          ? itemsBase.in("cycle_id", allCycleIds)
          : itemsBase.eq("cycle_id", effectiveCycleId),
        supabase.rpc("list_profile_names"),
      ]);
      return {
        events: (eventsRes.data ?? []) as PerfEvent[],
        items: (itemsRes.data ?? []) as PerfItem[],
        profiles: (profilesRes.data ?? []) as PerfProfile[],
      };
    },
  });

  const cycle = isAllCycles ? null : cycles?.find((c) => c.id === effectiveCycleId);

  // Build set of user IDs allowed by current team scope.
  const teamUserIds = useMemo(() => {
    if (!bundle) return null;
    if (!activeTeamId) return null; // null = no filter
    return new Set(
      bundle.profiles
        .filter((p) => (p.team_id ?? null) === activeTeamId)
        .map((p) => p.id),
    );
  }, [bundle, activeTeamId]);

  // Apply team scope first, then user scope, to all event-derived calculations.
  const teamScopedEvents = useMemo(() => {
    if (!bundle) return [];
    return teamUserIds
      ? bundle.events.filter((e) => teamUserIds.has(e.user_id))
      : bundle.events;
  }, [bundle, teamUserIds]);

  const filteredEvents = useMemo(() => {
    return userId === "all"
      ? teamScopedEvents
      : teamScopedEvents.filter((e) => e.user_id === userId);
  }, [teamScopedEvents, userId]);

  const userMetricsAll = useMemo(() => {
    if (!bundle) return [];
    if (isAllCycles) {
      // Compute per cycle, then merge per user across cycles.
      const itemsByCycle = new Map<string, PerfItem[]>();
      for (const it of bundle.items) {
        if (!itemsByCycle.has(it.cycle_id)) itemsByCycle.set(it.cycle_id, []);
        itemsByCycle.get(it.cycle_id)!.push(it);
      }
      const eventsByCycle = new Map<string, PerfEvent[]>();
      for (const e of bundle.events) {
        if (!eventsByCycle.has(e.cycle_id)) eventsByCycle.set(e.cycle_id, []);
        eventsByCycle.get(e.cycle_id)!.push(e);
      }
      const perCycle: ReturnType<typeof computeUserMetrics> = [];
      for (const c of cycles ?? []) {
        const evs = eventsByCycle.get(c.id) ?? [];
        const its = itemsByCycle.get(c.id) ?? [];
        if (evs.length === 0 && its.length === 0) continue;
        perCycle.push(
          ...computeUserMetrics(c, evs, its, bundle.profiles, {
            gapThresholdMs: gapMin * 60_000,
          }),
        );
      }
      const all = aggregateUserMetrics(perCycle);
      return teamUserIds ? all.filter((m) => teamUserIds.has(m.userId)) : all;
    }
    if (!cycle) return [];
    const all = computeUserMetrics(cycle, bundle.events, bundle.items, bundle.profiles, {
      gapThresholdMs: gapMin * 60_000,
    });
    return teamUserIds ? all.filter((m) => teamUserIds.has(m.userId)) : all;
  }, [bundle, cycle, gapMin, teamUserIds, isAllCycles, cycles]);

  const scopedMetrics = useMemo(() => {
    if (userId === "all") {
      // Aggregate
      const total = userMetricsAll.reduce(
        (acc, u) => {
          acc.pieces += u.pieces;
          acc.itemsCounted += u.itemsCounted;
          acc.downtimeMs += u.downtimeMs;
          acc.verified += u.verifiedItems;
          acc.correct += u.correctItems;
          return acc;
        },
        { pieces: 0, itemsCounted: 0, downtimeMs: 0, verified: 0, correct: 0 },
      );
      let loi = 0;
      if (isAllCycles) {
        // Sum each cycle's LOI window (team-scoped events for that cycle).
        for (const c of cycles ?? []) {
          const evs = teamScopedEvents.filter((e) => e.cycle_id === c.id);
          loi += cycleLoiMs(c, evs);
        }
      } else if (cycle) {
        loi = cycleLoiMs(cycle, teamScopedEvents);
      }
      const activeMs = Math.max(0, loi - total.downtimeMs);
      const hours = activeMs / 3_600_000;
      const pph = hours > 0 ? total.pieces / hours : 0;
      const accuracy = total.verified > 0 ? total.correct / total.verified : NaN;
      const aph = isNaN(accuracy) ? pph : pph * accuracy;
      return {
        loiMs: loi,
        pph,
        accuracy,
        aph,
        downtimeMs: total.downtimeMs,
        pieces: total.pieces,
        itemsCounted: total.itemsCounted,
      };
    }
    const u = userMetricsAll.find((x) => x.userId === userId);
    return u
      ? {
          loiMs: u.loiMs,
          pph: u.pph,
          accuracy: u.accuracy,
          aph: u.aph,
          downtimeMs: u.downtimeMs,
          pieces: u.pieces,
          itemsCounted: u.itemsCounted,
        }
      : null;
  }, [userMetricsAll, userId, cycle, isAllCycles, cycles, teamScopedEvents]);

  const buckets = useMemo(
    () => hourlyBuckets(filteredEvents, gapMin * 60_000),
    [filteredEvents, gapMin],
  );

  const userOptions = useMemo(() => {
    if (!bundle) return [];
    const ids = Array.from(new Set(teamScopedEvents.map((e) => e.user_id)));
    const profileMap = new Map(bundle.profiles.map((p) => [p.id, p]));
    return ids.map((id) => ({
      id,
      name: profileMap.get(id)?.full_name ?? id.slice(0, 8),
    }));
  }, [bundle, teamScopedEvents]);

  const activeTeam = getTeam(activeTeamId);

  // Header theme is owned by the portal switcher — no per-page tinting here.

  if (!allowed) {
    return (
      <div className="card-elevated p-8 text-center text-sm text-muted-foreground">
        Performance dashboard is available to admins and verifiers.
        <div className="mt-4">
          <Link to="/app/dashboard" className="text-primary hover:underline">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">
            Performance
            {activeTeam && (
              <span
                className="ml-3 inline-flex items-center gap-2 rounded-full px-3 py-1 align-middle text-sm font-medium text-white"
                style={{ background: activeTeam.color }}
              >
                <span className="h-2 w-2 rounded-full bg-white" />
                {activeTeam.label}
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Counter performance metrics per cycle{activeTeam ? ` · ${activeTeam.label}` : ""}
            {portalScoped ? ` (locked by ${portal.name} portal)` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Cycle</label>
            <select
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              value={effectiveCycleId}
              onChange={(e) => setCycleId(e.target.value)}
            >
              <option value="all">
                All cycles{portalScoped ? ` · ${portal.name}` : isAdmin ? " · all portals" : ""}
              </option>
              {cycles?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
          {isAdmin && !portalScoped && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Team</label>
              <select
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={adminTeamFilter}
                onChange={(e) => {
                  setAdminTeamFilter(e.target.value);
                  setUserId("all");
                }}
              >
                <option value="all">All teams</option>
                {TEAMS.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">User</label>
            <select
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="all">All users</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Idle gap (min)</label>
            <input
              type="number"
              min={1}
              max={120}
              className="w-20 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              value={gapMin}
              onChange={(e) => setGapMin(Math.max(1, Number(e.target.value) || 5))}
            />
          </div>
          <div className="inline-flex rounded-md border border-border p-0.5">
            <button
              className={`rounded px-3 py-1.5 text-sm ${view === "summary" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => setView("summary")}
            >
              Summary
            </button>
            <button
              className={`rounded px-3 py-1.5 text-sm ${view === "by-count" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => setView("by-count")}
            >
              By count
            </button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="LOI" value={scopedMetrics ? formatDuration(scopedMetrics.loiMs) : "—"} hint="Length of inventory" />
        <KpiCard label="PPH" value={scopedMetrics ? formatNum(scopedMetrics.pph) : "—"} hint="Pieces per active hour" />
        <KpiCard label="Accuracy" value={scopedMetrics ? formatPct(scopedMetrics.accuracy) : "—"} hint="Accuracy (post-verify) — counter qty matches final" />
        <KpiCard label="APH" value={scopedMetrics ? formatNum(scopedMetrics.aph) : "—"} hint="PPH × Accuracy" />
        <KpiCard label="Downtime" value={scopedMetrics ? formatDuration(scopedMetrics.downtimeMs) : "—"} hint={`Gaps > ${gapMin}m`} />
      </div>

      {isLoading ? (
        <div className="card-elevated p-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : view === "summary" ? (
        <SummaryTable
          metrics={userMetricsAll}
          onSelectUser={(id) => {
            setUserId(id);
            setView("by-count");
          }}
        />
      ) : (
        <ByCountTable
          items={bundle?.items ?? []}
          events={filteredEvents}
          profiles={bundle?.profiles ?? []}
          userId={userId}
          gapMin={gapMin}
        />
      )}

      {bundle && view === "summary" && (
        <VerifiersTable
          metrics={computeVerifierMetrics(bundle.events, bundle.items, bundle.profiles, {
            gapThresholdMs: gapMin * 60_000,
          }).filter((m) => !teamUserIds || teamUserIds.has(m.userId))}
        />
      )}

      <ChartsGrid
        buckets={buckets}
        userMetrics={userMetricsAll}
        scopedAph={scopedMetrics?.aph ?? 0}
        scopedPph={scopedMetrics?.pph ?? 0}
        isAllUsers={userId === "all"}
      />
    </div>
  );
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--background)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

function ChartsGrid({
  buckets,
  userMetrics,
  scopedAph,
  scopedPph,
  isAllUsers,
}: {
  buckets: ReturnType<typeof hourlyBuckets>;
  userMetrics: ReturnType<typeof computeUserMetrics>;
  scopedAph: number;
  scopedPph: number;
  isAllUsers: boolean;
}) {
  const sortedByPph = [...userMetrics].sort((a, b) => b.pph - a.pph);
  const accuracyRows = userMetrics
    .filter((m) => !isNaN(m.accuracy))
    .sort((a, b) => b.accuracy - a.accuracy)
    .map((m) => ({ ...m, accuracyPct: Math.round(m.accuracy * 1000) / 10 }));
  const downtimeMin = buckets.reduce((s, b) => s + b.downtimeMin, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* PPH over time — area + cumulative line */}
      <ChartCard title="PPH over time" subtitle="Pieces scanned per hour, cumulative average">
        {buckets.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={buckets}>
              <defs>
                <linearGradient id="pphFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
              <Area
                type="monotone"
                dataKey="pph"
                name="Hourly PPH"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#pphFill)"
              />
              <Line
                type="monotone"
                dataKey="cumulativePph"
                name="Cumulative avg"
                stroke="var(--chart-3)"
                strokeDasharray="4 4"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartCard>

      {/* Active vs Idle per hour */}
      <ChartCard
        title="Active vs Idle per hour"
        subtitle={`Active vs idle minutes per hour · ${downtimeMin.toFixed(0)}m idle total`}
      >
        {buckets.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={buckets.map((b) => ({
                ...b,
                activeMin: Math.max(0, 60 - b.downtimeMin),
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} unit="m" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${Math.round(v)}m`} />
              <Legend />
              <Bar dataKey="activeMin" name="Active (min)" stackId="time" fill="var(--chart-1)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="downtimeMin" name="Idle (min)" stackId="time" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartCard>

      {/* PPH vs APH — available at all-users and individual level */}
      {sortedByPph.length > 0 && (
        <ChartCard
          title={isAllUsers ? "PPH vs APH by user" : "PPH vs APH"}
          subtitle="Raw throughput vs accuracy-adjusted"
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={sortedByPph} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis
                type="category"
                dataKey="userName"
                stroke="var(--muted-foreground)"
                fontSize={12}
                width={120}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
              <Bar dataKey="pph" name="PPH" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
              <Bar dataKey="aph" name="APH" fill="var(--chart-4)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Accuracy by user */}
      {isAllUsers && accuracyRows.length > 0 && (
        <ChartCard title="Accuracy by user" subtitle="% verified items matching counter qty">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={accuracyRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="userName" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                domain={[0, 100]}
                unit="%"
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${v}%`} />
              <ReferenceLine y={95} stroke="var(--chart-4)" strokeDasharray="4 4" label={{ value: "Target 95%", fill: "var(--muted-foreground)", fontSize: 11, position: "right" }} />
              <Bar dataKey="accuracyPct" name="Accuracy" radius={[4, 4, 0, 0]}>
                {accuracyRows.map((r, i) => (
                  <Cell
                    key={i}
                    fill={
                      r.accuracyPct >= 95
                        ? "var(--chart-4)"
                        : r.accuracyPct >= 80
                          ? "var(--chart-5)"
                          : "var(--destructive)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Single-user fallback: LOI vs downtime breakdown */}
      {!isAllUsers && buckets.length > 0 && (
        <ChartCard title="Active vs idle per hour" subtitle="Stacked breakdown of each hour">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={buckets.map((b) => ({
                ...b,
                activeMin: Math.max(0, 60 - b.downtimeMin),
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} unit="m" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
              <Bar dataKey="activeMin" stackId="t" name="Active" fill="var(--chart-1)" />
              <Bar dataKey="downtimeMin" stackId="t" name="Idle" fill="var(--chart-2)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-elevated p-6">
      <div className="mb-4">
        <h3 className="font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
      No data yet.
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card-stats" title={hint}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

function SummaryTable({
  metrics,
  onSelectUser,
}: {
  metrics: ReturnType<typeof computeUserMetrics>;
  onSelectUser: (id: string) => void;
}) {
  return (
    <div className="card-elevated p-0">
      <div className="border-b border-border px-6 py-4">
        <h3 className="font-semibold">Per-user breakdown</h3>
      </div>
      {metrics.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No activity in this cycle yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th className="text-right">Items</th>
              <th className="text-right">Pieces</th>
              <th className="text-right">LOI</th>
              <th className="text-right">PPH</th>
              <th className="text-right">Accuracy</th>
              <th className="text-right">APH</th>
              <th className="text-right">Downtime</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr
                key={m.userId}
                className="cursor-pointer"
                onClick={() => onSelectUser(m.userId)}
              >
                <td className="font-medium">{m.userName}</td>
                <td className="text-right">{formatNum(m.itemsCounted)}</td>
                <td className="text-right">{formatNum(m.pieces)}</td>
                <td className="text-right">{formatDuration(m.loiMs)}</td>
                <td className="text-right">{formatNum(m.pph)}</td>
                <td className="text-right">{formatPct(m.accuracy)}</td>
                <td className="text-right">{formatNum(m.aph)}</td>
                <td className="text-right">{formatDuration(m.downtimeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ByCountTable({
  items,
  events,
  profiles,
  userId,
  gapMin,
}: {
  items: PerfItem[];
  events: PerfEvent[];
  profiles: PerfProfile[];
  userId: string;
  gapMin: number;
}) {
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const gapMs = gapMin * 60_000;

  // Latest event per item for selected user (or any user if "all")
  const latestEventByItem = useMemo(() => {
    const map = new Map<string, PerfEvent>();
    const sorted = [...events].sort(
      (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
    );
    for (const e of sorted) {
      if (!e.item_id) continue;
      map.set(e.item_id, e);
    }
    return map;
  }, [events]);

  // Time-since-prev per event (downtime indicator), sorted by time
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [events],
  );
  const gapByEventId = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 1; i < sortedEvents.length; i++) {
      m.set(
        sortedEvents[i].id,
        +new Date(sortedEvents[i].created_at) - +new Date(sortedEvents[i - 1].created_at),
      );
    }
    return m;
  }, [sortedEvents]);

  const rows = useMemo(() => {
    return items
      .filter((it) => {
        const ev = latestEventByItem.get(it.id);
        if (userId !== "all" && (!ev || ev.user_id !== userId)) return false;
        return ev || (it.counted_qty != null);
      })
      .map((it) => {
        const ev = latestEventByItem.get(it.id);
        const counterQty = ev ? Number(ev.qty_after ?? 0) : null;
        const finalQty = it.counted_qty != null ? Number(it.counted_qty) : null;
        const matched =
          it.verified_at && counterQty != null && finalQty != null
            ? counterQty === finalQty
            : null;
        const counterId = ev?.user_id ?? it.counted_by;
        const counterName = counterId
          ? profileMap.get(counterId)?.full_name ?? counterId.slice(0, 8)
          : "—";
        const eventGap = ev ? gapByEventId.get(ev.id) ?? 0 : 0;
        return {
          item: it,
          counterQty,
          finalQty,
          matched,
          counterName,
          countedAt: ev?.created_at ?? it.counted_at,
          gapMs: eventGap,
        };
      })
      .sort(
        (a, b) =>
          +new Date(b.countedAt ?? 0) - +new Date(a.countedAt ?? 0),
      );
  }, [items, latestEventByItem, userId, profileMap, gapByEventId]);

  const totals = rows.reduce(
    (acc, r) => {
      acc.pieces += r.counterQty ?? 0;
      if (r.matched === true) acc.correct += 1;
      if (r.matched != null) acc.verified += 1;
      return acc;
    },
    { pieces: 0, correct: 0, verified: 0 },
  );

  return (
    <div className="card-elevated p-0">
      <div className="border-b border-border px-6 py-4">
        <h3 className="font-semibold">Items counted</h3>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No counted items match this filter.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Description</th>
              <th className="text-right">Counter qty</th>
              <th className="text-right">Final qty</th>
              <th>Match</th>
              <th>Counter</th>
              <th>Counted at</th>
              <th className="text-right">Gap before</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item.id}>
                <td className="font-mono text-xs">{r.item.sku ?? "—"}</td>
                <td className="max-w-[260px] truncate">{r.item.description ?? "—"}</td>
                <td className="text-right">{r.counterQty ?? "—"}</td>
                <td className="text-right">{r.finalQty ?? "—"}</td>
                <td>
                  {r.matched === true ? (
                    <span className="text-emerald-500">✓</span>
                  ) : r.matched === false ? (
                    <span className="text-destructive">✗</span>
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </td>
                <td>{r.counterName}</td>
                <td className="text-xs text-muted-foreground">
                  {r.countedAt ? new Date(r.countedAt).toLocaleString() : "—"}
                </td>
                <td className={`text-right text-xs ${r.gapMs > gapMs ? "text-amber-500" : "text-muted-foreground"}`}>
                  {r.gapMs > 0 ? formatDuration(r.gapMs) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-medium">
              <td colSpan={2}>Totals ({rows.length} items)</td>
              <td className="text-right">{formatNum(totals.pieces)}</td>
              <td colSpan={2}>
                Accuracy:{" "}
                {totals.verified > 0
                  ? formatPct(totals.correct / totals.verified)
                  : "—"}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function VerifiersTable({ metrics }: { metrics: VerifierMetrics[] }) {
  return (
    <div className="card-elevated p-0">
      <div className="border-b border-border px-6 py-4">
        <h3 className="font-semibold">Verifier performance</h3>
        <p className="text-xs text-muted-foreground">
          Throughput and adjustments per verifier. Catch rate = items the verifier adjusted away from the counter's qty.
        </p>
      </div>
      {metrics.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No verifications in this cycle yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Verifier</th>
              <th className="text-right">Items verified</th>
              <th className="text-right">Adjustments</th>
              <th className="text-right">Catch rate</th>
              <th className="text-right">Items / hr</th>
              <th className="text-right">Active</th>
              <th className="text-right">Downtime</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.userId}>
                <td className="font-medium">{m.userName}</td>
                <td className="text-right">{formatNum(m.itemsVerified)}</td>
                <td className="text-right">{formatNum(m.adjustments)}</td>
                <td className="text-right">{formatPct(m.catchRate)}</td>
                <td className="text-right">{formatNum(m.itemsPerHour)}</td>
                <td className="text-right">{formatDuration(m.activeMs)}</td>
                <td className="text-right">{formatDuration(m.downtimeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
