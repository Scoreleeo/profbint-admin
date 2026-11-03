export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

type PickResult = "WON" | "LOST" | "PENDING";

function getPickResult(pick: string, actualResult: string | null | undefined): PickResult {
  if (!actualResult) return "PENDING";
  return pick === actualResult ? "WON" : "LOST";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(value);
}

function getAccuracy(wins: number, completed: number) {
  if (completed === 0) return "0%";
  return `${Math.round((wins / completed) * 100)}%`;
}

export default async function StrongestPicksHistoryPage() {
  const cookieStore = await cookies();
  const isLoggedIn = cookieStore.get("profbint_admin")?.value === "true";

  if (!isLoggedIn) redirect("/");

  const strongestPicks = await prisma.strongestPickHistory.findMany({
    orderBy: { kickoff: "desc" },
  });

  const fixtureIds = strongestPicks.map((pick) => pick.fixtureId);

  const predictions = fixtureIds.length
    ? await prisma.predictionHistory.findMany({
        where: { fixtureId: { in: fixtureIds } },
        select: { fixtureId: true, actualResult: true, status: true },
      })
    : [];

  const results = new Map<number, string | null>();

  for (const prediction of predictions) {
    if (
      prediction.fixtureId !== null &&
      prediction.status === "RESULTED" &&
      !results.has(prediction.fixtureId)
    ) {
      results.set(prediction.fixtureId, prediction.actualResult);
    }
  }

  const rows = strongestPicks.map((pick) => {
    const actualResult = results.get(pick.fixtureId) ?? null;
    return {
      ...pick,
      actualResult,
      result: getPickResult(pick.pick, actualResult),
    };
  });

  const completed = rows.filter((row) => row.result !== "PENDING");
  const wins = completed.filter((row) => row.result === "WON").length;
  const losses = completed.filter((row) => row.result === "LOST").length;
  const pending = rows.filter((row) => row.result === "PENDING").length;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <section className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-5 shadow-2xl md:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.35em] text-amber-400">
                Pro Football Intel Admin
              </p>
              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">
                Strongest Picks history
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                Verified pre-match Strongest Picks matched to the existing Admin
                result history by fixture ID. This page is read-only.
              </p>
            </div>

            <a
              href="/"
              className="rounded-2xl border border-slate-700 px-5 py-3 text-center text-sm font-black text-slate-200 hover:border-amber-400 hover:text-amber-300"
            >
              Back to dashboard
            </a>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard title="Verified accuracy" value={getAccuracy(wins, completed.length)} detail={`${wins}/${completed.length} resulted picks`} />
          <StatCard title="Total captured" value={String(rows.length)} detail="pre-match snapshots" />
          <StatCard title="Won" value={String(wins)} detail="verified winners" />
          <StatCard title="Lost" value={String(losses)} detail="verified losses" />
          <StatCard title="Pending" value={String(pending)} detail="awaiting Admin result" />
        </section>

        <section className="mt-6 overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900 shadow-xl">
          <div className="border-b border-slate-800 p-5">
            <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
              Verified history
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Results come from the existing PredictionHistory actual result. No
              additional result API call is made here.
            </p>
          </div>

          {rows.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-lg font-black">No Strongest Picks captured yet.</p>
              <p className="mt-2 text-sm text-slate-400">
                The automatic snapshot workflow will populate this history when
                qualifying picks are available before kickoff.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {rows.map((row) => (
                <article
                  key={row.fixtureId}
                  className="grid gap-4 p-5 lg:grid-cols-[1.4fr_0.9fr_0.7fr_0.6fr] lg:items-center"
                >
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      {row.league}
                    </p>
                    <h2 className="mt-2 text-lg font-black">
                      {row.homeTeam} vs {row.awayTeam}
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">{formatDate(row.kickoff)}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Fixture {row.fixtureId} · Captured {formatDate(row.qualifiedAt)}
                    </p>
                  </div>

                  <InfoBlock label="Strongest Pick" value={`${row.pick} · ${row.selectedTeam}`} />
                  <InfoBlock label="Actual Result" value={row.actualResult || "Awaiting result"} />
                  <InfoBlock label="Status" value={row.result} emphasis={row.result} />
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function StatCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-[1.5rem] border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <p className="mt-3 text-3xl font-black text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

function InfoBlock({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: PickResult;
}) {
  const valueClass =
    emphasis === "WON"
      ? "text-emerald-300"
      : emphasis === "LOST"
        ? "text-red-300"
        : emphasis === "PENDING"
          ? "text-amber-300"
          : "text-white";

  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-2 text-sm font-black ${valueClass}`}>{value}</p>
    </div>
  );
}
