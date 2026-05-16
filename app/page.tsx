import { cookies } from "next/headers";
import { redirect } from "next/navigation";

type Outcome = "HOME" | "DRAW" | "AWAY";

type BackendPrediction = {
  id?: string | number;
  fixture_id?: string | number;
  league?: string;
  kickoff?: string;
  date?: string;
  homeTeam?: string;
  awayTeam?: string;
  home_team?: string;
  away_team?: string;
  teams?: {
    home?: { name?: string; logo?: string };
    away?: { name?: string; logo?: string };
  };
  logos?: {
    home?: string;
    away?: string;
  };
  percentages?: {
    home?: number;
    draw?: number;
    away?: number;
    home_win?: number;
    away_win?: number;
  };
  confidence?: number | string;
  advice?: string;
  winner?: string;
  best_bet?: string;
};

type AdminPrediction = {
  id: string;
  league: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  homePercent: number;
  drawPercent: number;
  awayPercent: number;
  firstChoice: Outcome;
  secondChoice: Outcome;
  confidence: string;
  advice: string;
  bestBet: string;
};

const PROFBINT_PREDICTIONS_URL = "https://profbint.com/api/predictions";

function getOutcomeLabel(outcome: Outcome) {
  if (outcome === "HOME") return "Home win";
  if (outcome === "DRAW") return "Draw";
  return "Away win";
}

function getOutcomeShortLabel(outcome: Outcome) {
  if (outcome === "HOME") return "1";
  if (outcome === "DRAW") return "X";
  return "2";
}

function getTopChoices(home: number, draw: number, away: number) {
  const ordered = [
    { outcome: "HOME" as Outcome, value: home },
    { outcome: "DRAW" as Outcome, value: draw },
    { outcome: "AWAY" as Outcome, value: away },
  ].sort((a, b) => b.value - a.value);

  return {
    firstChoice: ordered[0].outcome,
    secondChoice: ordered[1].outcome,
  };
}

function normalisePercent(value: unknown) {
  if (typeof value === "number") return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", ""));
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }
  return 0;
}

function normalisePrediction(
  prediction: BackendPrediction,
  index: number
): AdminPrediction {
  const homeTeam =
    prediction.homeTeam ||
    prediction.home_team ||
    prediction.teams?.home?.name ||
    "Home team";

  const awayTeam =
    prediction.awayTeam ||
    prediction.away_team ||
    prediction.teams?.away?.name ||
    "Away team";

  const homePercent = normalisePercent(
    prediction.percentages?.home ?? prediction.percentages?.home_win
  );

  const drawPercent = normalisePercent(prediction.percentages?.draw);

  const awayPercent = normalisePercent(
    prediction.percentages?.away ?? prediction.percentages?.away_win
  );

  const choices = getTopChoices(homePercent, drawPercent, awayPercent);

  return {
    id: String(prediction.id || prediction.fixture_id || index),
    league: prediction.league || "Unknown league",
    kickoff: prediction.kickoff || prediction.date || "Kickoff TBC",
    homeTeam,
    awayTeam,
    homeLogo: prediction.teams?.home?.logo || prediction.logos?.home,
    awayLogo: prediction.teams?.away?.logo || prediction.logos?.away,
    homePercent,
    drawPercent,
    awayPercent,
    firstChoice: choices.firstChoice,
    secondChoice: choices.secondChoice,
    confidence: String(prediction.confidence || "N/A"),
    advice: prediction.advice || "No advice available yet.",
    bestBet:
      prediction.best_bet || prediction.winner || "No backend pick available.",
  };
}

async function getPredictions() {
  try {
    const response = await fetch(PROFBINT_PREDICTIONS_URL, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        predictions: [] as AdminPrediction[],
        error: `Pro Football Intel API returned ${response.status}`,
      };
    }

    const data = await response.json();

    const rawPredictions: BackendPrediction[] = Array.isArray(data)
      ? data
      : Array.isArray(data.predictions)
        ? data.predictions
        : Array.isArray(data.matches)
          ? data.matches
          : [];

    return {
      predictions: rawPredictions.map(normalisePrediction),
      error: "",
    };
  } catch {
    return {
      predictions: [] as AdminPrediction[],
      error: "Could not connect to the Pro Football Intel prediction API.",
    };
  }
}

async function login(formData: FormData) {
  "use server";

  const password = String(formData.get("password") || "");
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    redirect("/?error=missing-password");
  }

  if (password !== adminPassword) {
    redirect("/?error=wrong-password");
  }

  const cookieStore = await cookies();

  cookieStore.set("profbint_admin", "true", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12,
    path: "/",
  });

  redirect("/");
}

async function logout() {
  "use server";

  const cookieStore = await cookies();
  cookieStore.delete("profbint_admin");

  redirect("/");
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  const params = await searchParams;

  const isLoggedIn = cookieStore.get("profbint_admin")?.value === "true";

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
        <section className="mx-auto flex min-h-[80vh] max-w-md items-center">
          <div className="w-full rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-emerald-400">
              Pro Football Intel
            </p>

            <h1 className="mt-4 text-3xl font-black">Admin dashboard</h1>

            <p className="mt-3 text-sm leading-6 text-slate-300">
              Private unlocked 1X2 prediction view. No Stripe. No basket. No
              public app unlock logic.
            </p>

            <form action={login} className="mt-6 space-y-4">
              <input
                name="password"
                type="password"
                placeholder="Admin password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
              />

              {params?.error === "wrong-password" ? (
                <p className="text-sm font-semibold text-red-400">
                  Wrong password. Try again.
                </p>
              ) : null}

              {params?.error === "missing-password" ? (
                <p className="text-sm font-semibold text-red-400">
                  ADMIN_PASSWORD is missing.
                </p>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-2xl bg-emerald-400 px-4 py-3 font-black text-slate-950 hover:bg-emerald-300"
              >
                Unlock admin
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  const { predictions, error } = await getPredictions();

  const leagues = Array.from(
    new Set(predictions.map((prediction) => prediction.league))
  );

  const averageConfidence =
    predictions.length > 0
      ? Math.round(
          predictions.reduce((total, prediction) => {
            const value = Number(String(prediction.confidence).replace("%", ""));
            return total + (Number.isFinite(value) ? value : 0);
          }, 0) / predictions.length
        )
      : 0;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-7xl px-4 py-8">
        <header className="rounded-[2rem] border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-2xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.35em] text-emerald-400">
                Pro Football Intel Admin
              </p>

              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">
                Live unlocked predictions
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Internal admin view powered only by the Pro Football Intel
                prediction API. Home win, draw, and away win intelligence.
              </p>
            </div>

            <form action={logout}>
              <button
                type="submit"
                className="rounded-2xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-200 hover:border-emerald-400 hover:text-emerald-300"
              >
                Lock dashboard
              </button>
            </form>
          </div>
        </header>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <StatCard
            title="Live matches"
            value={String(predictions.length)}
            detail="from Pro Football Intel"
          />

          <StatCard
            title="API status"
            value={error ? "Issue" : "Online"}
            detail="internal prediction route"
          />

          <StatCard
            title="Leagues"
            value={String(leagues.length)}
            detail="covered today"
          />

          <StatCard
            title="Avg confidence"
            value={`${averageConfidence}%`}
            detail="visible admin signal"
          />
        </div>

        {error ? (
          <div className="mt-6 rounded-3xl border border-red-900 bg-red-950/40 p-5 text-red-200">
            <p className="font-black">Prediction API error</p>
            <p className="mt-2 text-sm">{error}</p>
          </div>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 border-b border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black">Today&apos;s prediction board</h2>
            <p className="mt-1 text-sm text-slate-400">
              First choice and second choice are calculated from the 1X2
              percentages returned by the Pro Football Intel API.
            </p>
          </div>

          <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300">
            1X2 mode only
          </div>
        </div>

        <div className="mt-6 grid gap-5">
          {predictions.length === 0 && !error ? (
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
              No predictions returned from the Pro Football Intel API yet.
            </div>
          ) : null}

          {predictions.map((prediction) => (
            <article
              key={prediction.id}
              className="overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900 shadow-xl"
            >
              <div className="grid gap-0 lg:grid-cols-[1.3fr_1fr]">
                <div className="p-5 md:p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                      {prediction.league}
                    </span>

                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold text-slate-300">
                      {prediction.kickoff}
                    </span>
                  </div>

                  <div className="mt-6 flex items-center gap-4">
                    <TeamLogo src={prediction.homeLogo} name={prediction.homeTeam} />

                    <div className="min-w-0">
                      <h3 className="text-2xl font-black md:text-3xl">
                        {prediction.homeTeam}
                      </h3>

                      <p className="my-1 text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                        vs
                      </p>

                      <h3 className="text-2xl font-black md:text-3xl">
                        {prediction.awayTeam}
                      </h3>
                    </div>

                    <TeamLogo src={prediction.awayLogo} name={prediction.awayTeam} />
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <PercentBox
                      label="Home win"
                      value={prediction.homePercent}
                      active={prediction.firstChoice === "HOME"}
                    />
                    <PercentBox
                      label="Draw"
                      value={prediction.drawPercent}
                      active={prediction.firstChoice === "DRAW"}
                    />
                    <PercentBox
                      label="Away win"
                      value={prediction.awayPercent}
                      active={prediction.firstChoice === "AWAY"}
                    />
                  </div>
                </div>

                <div className="border-t border-slate-800 bg-slate-950/70 p-5 md:p-6 lg:border-l lg:border-t-0">
                  <div className="grid gap-3">
                    <ChoiceBox
                      title="First choice"
                      choice={getOutcomeLabel(prediction.firstChoice)}
                      badge={getOutcomeShortLabel(prediction.firstChoice)}
                      primary
                    />

                    <ChoiceBox
                      title="Second choice"
                      choice={getOutcomeLabel(prediction.secondChoice)}
                      badge={getOutcomeShortLabel(prediction.secondChoice)}
                    />
                  </div>

                  <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">
                      Confidence
                    </p>

                    <p className="mt-2 text-3xl font-black text-white">
                      {prediction.confidence}
                    </p>
                  </div>

                  <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">
                      Admin note
                    </p>

                    <p className="mt-2 font-black text-white">
                      {prediction.bestBet}
                    </p>

                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {prediction.advice}
                    </p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function StatCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <p className="text-sm font-bold text-slate-400">{title}</p>
      <p className="mt-2 text-3xl font-black text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function PercentBox({
  label,
  value,
  active,
}: {
  label: string;
  value: number;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        active
          ? "border-emerald-400 bg-emerald-500/10"
          : "border-slate-800 bg-slate-950"
      }`}
    >
      <p className="text-sm font-bold text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-black text-white">{value}%</p>
      {active ? (
        <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-300">
          top pick
        </p>
      ) : null}
    </div>
  );
}

function ChoiceBox({
  title,
  choice,
  badge,
  primary,
}: {
  title: string;
  choice: string;
  badge: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        primary
          ? "border-emerald-400 bg-emerald-500/10"
          : "border-slate-700 bg-slate-900"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p
            className={`text-xs font-black uppercase tracking-[0.22em] ${
              primary ? "text-emerald-300" : "text-slate-500"
            }`}
          >
            {title}
          </p>

          <p className="mt-2 text-2xl font-black text-white">{choice}</p>
        </div>

        <span
          className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-black ${
            primary
              ? "bg-emerald-400 text-slate-950"
              : "bg-slate-800 text-white"
          }`}
        >
          {badge}
        </span>
      </div>
    </div>
  );
}

function TeamLogo({ src, name }: { src?: string; name: string }) {
  if (!src) return null;

  return (
    <img
      src={src}
      alt={`${name} logo`}
      className="h-12 w-12 shrink-0 rounded-full bg-white object-contain p-1"
    />
  );
}