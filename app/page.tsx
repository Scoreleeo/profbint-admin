export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { ReactNode } from "react";

type Outcome = "HOME" | "DRAW" | "AWAY";
type ResultFilter = "all" | "pending" | "won" | "lost";
type SortOrder = "newest" | "oldest";
type SeasonValue = "2025-26" | "2026-27";

type RawPrediction = Record<string, unknown>;

type LeagueOption = {
  id: string;
  name: string;
  shortName: string;
};

type AdminPrediction = {
  id: string;
  fixtureId?: number;
  leagueId: number;
  league: string;
  kickoff: string;
  kickoffIso?: string;
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

type SavedPrediction = {
  id: number;
  fixtureId: number | null;
  leagueId: number | null;
  leagueName: string | null;
  season: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date | null;
  firstChoice: string | null;
  secondChoice: string | null;
  homeWinPercent: number | null;
  drawPercent: number | null;
  awayWinPercent: number | null;
  strongestPick: string | null;
  strongestPercent: number | null;
  actualResult: string | null;
  firstChoiceResult: string | null;
  secondChoiceResult: string | null;
  status: string;
  savedAt: Date;
  updatedAt: Date;
};

type AccuracyStats = {
  completed: number;
  wins: number;
  losses: number;
  accuracy: string;
};

type ApiFootballFixtureResponse = {
  response?: Array<{
    fixture?: {
      status?: {
        short?: string | null;
      };
    };
    goals?: {
      home?: number | null;
      away?: number | null;
    };
  }>;
};

const PROFBINT_PREDICTIONS_URL = "https://profbint.com/api/predictions";
const FINISHED_STATUS_CODES = ["FT", "AET", "PEN"];

const LEAGUES: LeagueOption[] = [
  { id: "39", name: "Premier League", shortName: "Premier League" },
  { id: "140", name: "La Liga", shortName: "La Liga" },
  { id: "135", name: "Serie A", shortName: "Serie A" },
  { id: "78", name: "Bundesliga", shortName: "Bundesliga" },
  { id: "61", name: "Ligue 1", shortName: "Ligue 1" },
  { id: "88", name: "Eredivisie", shortName: "Eredivisie" },
  { id: "94", name: "Primeira Liga", shortName: "Primeira Liga" },
];

const FILTERS: { id: ResultFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const SEASONS: { value: SeasonValue; label: string }[] = [
  { value: "2025-26", label: "2025/26" },
  { value: "2026-27", label: "2026/27" },
];

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").trim());
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }

  return 0;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normaliseFilter(value: string | undefined): ResultFilter {
  if (value === "pending" || value === "won" || value === "lost") {
    return value;
  }

  return "all";
}

function normaliseSort(value: string | undefined): SortOrder {
  if (value === "oldest") {
    return "oldest";
  }

  return "newest";
}

function normaliseSeason(value: string | undefined): SeasonValue {
  if (value === "2026-27") {
    return "2026-27";
  }

  return "2025-26";
}

function getSeasonLabel(season: string | null | undefined) {
  if (season === "2026-27") return "2026/27";
  return "2025/26";
}

function buildHref({
  leagueId,
  filter,
  season,
  sort,
  result,
  saved,
  sync,
  synced,
  skipped,
  failed,
}: {
  leagueId: string;
  filter: ResultFilter;
  season: SeasonValue;
  sort: SortOrder;
  result?: string;
  saved?: string;
  sync?: string;
  synced?: number;
  skipped?: number;
  failed?: number;
}) {
  const params = new URLSearchParams();

  params.set("league", leagueId);
  params.set("filter", filter);
  params.set("season", season);
  params.set("sort", sort);

  if (result) params.set("result", result);
  if (saved) params.set("saved", saved);
  if (sync) params.set("sync", sync);
  if (typeof synced === "number") params.set("synced", String(synced));
  if (typeof skipped === "number") params.set("skipped", String(skipped));
  if (typeof failed === "number") params.set("failed", String(failed));

  return `/?${params.toString()}`;
}

function getOutcomeLabel(outcome: Outcome | string | null | undefined) {
  if (outcome === "HOME") return "Home win";
  if (outcome === "DRAW") return "Draw";
  if (outcome === "AWAY") return "Away win";
  return "Not set";
}

function getOutcomeShortLabel(outcome: Outcome | string | null | undefined) {
  if (outcome === "HOME") return "1";
  if (outcome === "DRAW") return "X";
  if (outcome === "AWAY") return "2";
  return "-";
}

function getStatusLabel(status: string | null | undefined) {
  if (status === "WON") return "WON";
  if (status === "LOST") return "LOST";
  return "PENDING";
}

function getStrongestPickResult(prediction: SavedPrediction) {
  if (!prediction.actualResult || !prediction.strongestPick) {
    return "PENDING";
  }

  return prediction.strongestPick === prediction.actualResult ? "WON" : "LOST";
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

function formatKickoff(value: string) {
  if (!value || value === "Kickoff TBC") return value;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

function parseKickoffDate(value?: string) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function getAccuracy(won: number, total: number) {
  if (total === 0) return "0%";
  return `${Math.round((won / total) * 100)}%`;
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function getAccuracyStats(predictions: SavedPrediction[]): AccuracyStats {
  const completed = predictions.filter(
    (prediction) =>
      prediction.status === "RESULTED" &&
      prediction.actualResult &&
      prediction.firstChoiceResult,
  );

  const wins = completed.filter(
    (prediction) => prediction.firstChoiceResult === "WON",
  ).length;

  const losses = completed.filter(
    (prediction) => prediction.firstChoiceResult === "LOST",
  ).length;

  return {
    completed: completed.length,
    wins,
    losses,
    accuracy: getAccuracy(wins, completed.length),
  };
}

function getStrongestAccuracyStats(predictions: SavedPrediction[]): AccuracyStats {
  const completed = predictions.filter(
    (prediction) =>
      prediction.status === "RESULTED" &&
      prediction.actualResult &&
      prediction.strongestPick,
  );

  const wins = completed.filter(
    (prediction) => prediction.strongestPick === prediction.actualResult,
  ).length;

  const losses = completed.length - wins;

  return {
    completed: completed.length,
    wins,
    losses,
    accuracy: getAccuracy(wins, completed.length),
  };
}

function getSecondChoiceAccuracyStats(
  predictions: SavedPrediction[],
): AccuracyStats {
  const completed = predictions.filter(
    (prediction) =>
      prediction.status === "RESULTED" &&
      prediction.actualResult &&
      prediction.secondChoiceResult,
  );

  const wins = completed.filter(
    (prediction) => prediction.secondChoiceResult === "WON",
  ).length;

  const losses = completed.filter(
    (prediction) => prediction.secondChoiceResult === "LOST",
  ).length;

  return {
    completed: completed.length,
    wins,
    losses,
    accuracy: getAccuracy(wins, completed.length),
  };
}

function getPredictionTypeAccuracyStats(
  predictions: SavedPrediction[],
  outcome: Outcome,
): AccuracyStats {
  const completed = predictions.filter(
    (prediction) =>
      prediction.status === "RESULTED" &&
      prediction.actualResult &&
      prediction.firstChoice === outcome,
  );

  const wins = completed.filter(
    (prediction) => prediction.actualResult === outcome,
  ).length;

  const losses = completed.length - wins;

  return {
    completed: completed.length,
    wins,
    losses,
    accuracy: getAccuracy(wins, completed.length),
  };
}

function getConfidenceLevel(prediction: SavedPrediction) {
  const percent = prediction.strongestPercent || 0;

  if (percent >= 65) return "High confidence";
  if (percent >= 50) return "Medium confidence";
  return "Low confidence";
}

function getConfidenceAccuracyStats(
  predictions: SavedPrediction[],
  confidenceLevel: "High confidence" | "Medium confidence" | "Low confidence",
): AccuracyStats {
  const completed = predictions.filter(
    (prediction) =>
      prediction.status === "RESULTED" &&
      prediction.actualResult &&
      prediction.firstChoiceResult &&
      getConfidenceLevel(prediction) === confidenceLevel,
  );

  const wins = completed.filter(
    (prediction) => prediction.firstChoiceResult === "WON",
  ).length;

  const losses = completed.filter(
    (prediction) => prediction.firstChoiceResult === "LOST",
  ).length;

  return {
    completed: completed.length,
    wins,
    losses,
    accuracy: getAccuracy(wins, completed.length),
  };
}

function filterPredictionsByResult(
  predictions: SavedPrediction[],
  filter: ResultFilter,
) {
  if (filter === "pending") {
    return predictions.filter((prediction) => prediction.status === "PENDING");
  }

  if (filter === "won") {
    return predictions.filter(
      (prediction) => prediction.firstChoiceResult === "WON",
    );
  }

  if (filter === "lost") {
    return predictions.filter(
      (prediction) => prediction.firstChoiceResult === "LOST",
    );
  }

  return predictions;
}

function getActualResultFromGoals(homeGoals: number, awayGoals: number): Outcome {
  if (homeGoals > awayGoals) return "HOME";
  if (awayGoals > homeGoals) return "AWAY";
  return "DRAW";
}

function normalisePrediction(
  raw: RawPrediction,
  index: number,
  leagueId: number,
): AdminPrediction {
  const prediction = readObject(raw.prediction);
  const probabilities = readObject(prediction.probabilities);
  const teams = readObject(raw.teams);
  const home = readObject(teams.home);
  const away = readObject(teams.away);
  const logos = readObject(raw.logos);
  const fixture = readObject(raw.fixture);

  const kickoffIso =
    readString(raw.date) ||
    readString(raw.kickoff) ||
    readString(raw.time) ||
    readString(fixture.date);

  const homeTeam =
    readString(raw.home) ||
    readString(raw.homeTeam) ||
    readString(raw.home_team) ||
    readString(home.name) ||
    readString(fixture.homeTeam) ||
    "Home team";

  const awayTeam =
    readString(raw.away) ||
    readString(raw.awayTeam) ||
    readString(raw.away_team) ||
    readString(away.name) ||
    readString(fixture.awayTeam) ||
    "Away team";

  const homePercent =
    readNumber(probabilities.home) ||
    readNumber(readObject(raw.percentages).home) ||
    readNumber(readObject(raw.percentages).home_win) ||
    readNumber(raw.homePercent) ||
    readNumber(raw.home_percentage);

  const drawPercent =
    readNumber(probabilities.draw) ||
    readNumber(readObject(raw.percentages).draw) ||
    readNumber(raw.drawPercent) ||
    readNumber(raw.draw_percentage);

  const awayPercent =
    readNumber(probabilities.away) ||
    readNumber(readObject(raw.percentages).away) ||
    readNumber(readObject(raw.percentages).away_win) ||
    readNumber(raw.awayPercent) ||
    readNumber(raw.away_percentage);

  const choices = getTopChoices(homePercent, drawPercent, awayPercent);

  const rawFixtureId =
    readNumber(raw.fixtureId) || readNumber(raw.fixture_id) || readNumber(raw.id);

  return {
    id: String(raw.fixtureId || raw.fixture_id || raw.id || index),
    fixtureId: rawFixtureId || undefined,
    leagueId,
    league:
      readString(raw.league) ||
      readString(readObject(raw.leagueData).name) ||
      "Unknown league",
    kickoff: formatKickoff(kickoffIso || "Kickoff TBC"),
    kickoffIso: kickoffIso || undefined,
    homeTeam,
    awayTeam,
    homeLogo:
      readString(raw.homeLogo) ||
      readString(home.logo) ||
      readString(logos.home),
    awayLogo:
      readString(raw.awayLogo) ||
      readString(away.logo) ||
      readString(logos.away),
    homePercent,
    drawPercent,
    awayPercent,
    firstChoice: choices.firstChoice,
    secondChoice: choices.secondChoice,
    confidence:
      readString(prediction.confidence) || readString(raw.confidence) || "N/A",
    advice:
      readString(prediction.advice) ||
      readString(prediction.summary) ||
      readString(prediction.reason) ||
      readString(raw.advice) ||
      "No advice available yet.",
    bestBet:
      readString(prediction.best_bet) ||
      readString(prediction.bestBet) ||
      readString(prediction.winner) ||
      readString(raw.best_bet) ||
      readString(raw.bestBet) ||
      readString(raw.winner) ||
      `${getOutcomeLabel(choices.firstChoice)} is the current top model pick.`,
  };
}

async function getPredictions(leagueId: string) {
  try {
    const url = `${PROFBINT_PREDICTIONS_URL}?league=${encodeURIComponent(
      leagueId,
    )}`;

    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        predictions: [] as AdminPrediction[],
        error: `Pro Football Intel API returned ${response.status}`,
      };
    }

    const data = await response.json();
    const payload = readObject(data);

    const rawPredictions: RawPrediction[] = Array.isArray(data)
      ? data
      : Array.isArray(payload.matches)
        ? (payload.matches as RawPrediction[])
        : Array.isArray(payload.predictions)
          ? (payload.predictions as RawPrediction[])
          : Array.isArray(payload.fixtures)
            ? (payload.fixtures as RawPrediction[])
            : [];

    return {
      predictions: rawPredictions.map((prediction, index) =>
        normalisePrediction(prediction, index, Number(leagueId)),
      ),
      error: "",
    };
  } catch {
    return {
      predictions: [] as AdminPrediction[],
      error: "Could not connect to the Pro Football Intel prediction API.",
    };
  }
}

async function getFinishedFixtureResult(fixtureId: number) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  const apiHost = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";

  if (!apiKey) {
    return {
      ok: false,
      reason: "missing-api-key",
      actualResult: null as Outcome | null,
    };
  }

  try {
    const response = await fetch(
      `https://${apiHost}/fixtures?id=${encodeURIComponent(String(fixtureId))}`,
      {
        cache: "no-store",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": apiHost,
        },
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        reason: `api-${response.status}`,
        actualResult: null as Outcome | null,
      };
    }

    const data = (await response.json()) as ApiFootballFixtureResponse;
    const fixture = data.response?.[0];

    if (!fixture) {
      return {
        ok: true,
        reason: "missing-fixture",
        actualResult: null as Outcome | null,
      };
    }

    const statusShort = fixture.fixture?.status?.short || "";
    const homeGoals = fixture.goals?.home;
    const awayGoals = fixture.goals?.away;

    if (!FINISHED_STATUS_CODES.includes(statusShort)) {
      return {
        ok: true,
        reason: "unfinished",
        actualResult: null as Outcome | null,
      };
    }

    if (typeof homeGoals !== "number" || typeof awayGoals !== "number") {
      return {
        ok: true,
        reason: "missing-score",
        actualResult: null as Outcome | null,
      };
    }

    return {
      ok: true,
      reason: "finished",
      actualResult: getActualResultFromGoals(homeGoals, awayGoals),
    };
  } catch {
    return {
      ok: false,
      reason: "api-error",
      actualResult: null as Outcome | null,
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

async function saveLeagueSnapshot(formData: FormData) {
  "use server";

  const cookieStore = await cookies();
  const isLoggedIn = cookieStore.get("profbint_admin")?.value === "true";

  if (!isLoggedIn) {
    redirect("/");
  }

  const leagueId = String(formData.get("leagueId") || "39");
  const filter = normaliseFilter(String(formData.get("filter") || "all"));
  const season = normaliseSeason(String(formData.get("season") || "2025-26"));
  const sort = normaliseSort(String(formData.get("sort") || "newest"));

  const selectedLeague =
    LEAGUES.find((league) => league.id === leagueId) || LEAGUES[0];

  const { predictions } = await getPredictions(selectedLeague.id);

  for (const prediction of predictions) {
    const strongestPercent = Math.max(
      prediction.homePercent,
      prediction.drawPercent,
      prediction.awayPercent,
    );

    const kickoffDate = parseKickoffDate(prediction.kickoffIso);

    const existing = prediction.fixtureId
      ? await prisma.predictionHistory.findFirst({
          where: {
            fixtureId: prediction.fixtureId,
            leagueId: prediction.leagueId,
            season,
          },
        })
      : await prisma.predictionHistory.findFirst({
          where: {
            leagueId: prediction.leagueId,
            season,
            homeTeam: prediction.homeTeam,
            awayTeam: prediction.awayTeam,
            kickoff: kickoffDate,
          },
        });

    const baseData = {
      fixtureId: prediction.fixtureId || null,
      leagueId: prediction.leagueId,
      leagueName: selectedLeague.name,
      season,
      homeTeam: prediction.homeTeam,
      awayTeam: prediction.awayTeam,
      kickoff: kickoffDate,
      firstChoice: prediction.firstChoice,
      secondChoice: prediction.secondChoice,
      homeWinPercent: prediction.homePercent,
      drawPercent: prediction.drawPercent,
      awayWinPercent: prediction.awayPercent,
      strongestPick: prediction.firstChoice,
      strongestPercent,
    };

    if (existing) {
      await prisma.predictionHistory.update({
        where: {
          id: existing.id,
        },
        data: baseData,
      });
    } else {
      await prisma.predictionHistory.create({
        data: {
          ...baseData,
          actualResult: null,
          firstChoiceResult: null,
          secondChoiceResult: null,
          status: "PENDING",
        },
      });
    }
  }

  redirect(
    buildHref({
      leagueId: selectedLeague.id,
      filter,
      season,
      sort,
      saved: "true",
    }),
  );
}

async function syncFinishedResults(formData: FormData) {
  "use server";

  const cookieStore = await cookies();
  const isLoggedIn = cookieStore.get("profbint_admin")?.value === "true";

  if (!isLoggedIn) {
    redirect("/");
  }

  const leagueId = String(formData.get("leagueId") || "39");
  const filter = normaliseFilter(String(formData.get("filter") || "all"));
  const season = normaliseSeason(String(formData.get("season") || "2025-26"));
  const sort = normaliseSort(String(formData.get("sort") || "newest"));

  if (!process.env.API_FOOTBALL_KEY) {
    redirect(
      buildHref({
        leagueId,
        filter,
        season,
        sort,
        sync: "missing-key",
        synced: 0,
        skipped: 0,
        failed: 0,
      }),
    );
  }

  const pendingPredictions = await prisma.predictionHistory.findMany({
    where: {
      season,
      status: "PENDING",
    },
    orderBy: {
      kickoff: "asc",
    },
    take: 25,
  });

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const prediction of pendingPredictions) {
    if (!prediction.fixtureId) {
      skipped += 1;
      continue;
    }

    const result = await getFinishedFixtureResult(prediction.fixtureId);

    if (!result.ok) {
      failed += 1;
      continue;
    }

    if (!result.actualResult) {
      skipped += 1;
      continue;
    }

    const firstChoiceResult =
      prediction.firstChoice === result.actualResult ? "WON" : "LOST";

    const secondChoiceResult =
      prediction.secondChoice === result.actualResult ? "WON" : "LOST";

    await prisma.predictionHistory.update({
      where: {
        id: prediction.id,
      },
      data: {
        actualResult: result.actualResult,
        firstChoiceResult,
        secondChoiceResult,
        status: "RESULTED",
      },
    });

    synced += 1;
  }

  redirect(
    buildHref({
      leagueId,
      filter,
      season,
      sort,
      sync: failed > 0 ? "partial" : "success",
      synced,
      skipped,
      failed,
    }),
  );
}

async function updateResult(formData: FormData) {
  "use server";

  const cookieStore = await cookies();
  const isLoggedIn = cookieStore.get("profbint_admin")?.value === "true";

  if (!isLoggedIn) {
    redirect("/");
  }

  const id = Number(formData.get("id"));
  const leagueId = String(formData.get("leagueId") || "39");
  const filter = normaliseFilter(String(formData.get("filter") || "all"));
  const season = normaliseSeason(String(formData.get("season") || "2025-26"));
  const sort = normaliseSort(String(formData.get("sort") || "newest"));
  const actualResult = String(formData.get("actualResult") || "");

  if (!id || !["HOME", "DRAW", "AWAY"].includes(actualResult)) {
    redirect(buildHref({ leagueId, filter, season, sort }));
  }

  const prediction = await prisma.predictionHistory.findUnique({
    where: { id },
  });

  if (!prediction) {
    redirect(buildHref({ leagueId, filter, season, sort }));
  }

  const firstChoiceResult =
    prediction.firstChoice === actualResult ? "WON" : "LOST";

  const secondChoiceResult =
    prediction.secondChoice === actualResult ? "WON" : "LOST";

  await prisma.predictionHistory.update({
    where: { id },
    data: {
      actualResult,
      firstChoiceResult,
      secondChoiceResult,
      status: "RESULTED",
    },
  });

  redirect(
    buildHref({
      leagueId,
      filter,
      season,
      sort,
      result: "updated",
    }),
  );
}

async function resetResult(formData: FormData) {
  "use server";

  const cookieStore = await cookies();
  const isLoggedIn = cookieStore.get("profbint_admin")?.value === "true";

  if (!isLoggedIn) {
    redirect("/");
  }

  const id = Number(formData.get("id"));
  const leagueId = String(formData.get("leagueId") || "39");
  const filter = normaliseFilter(String(formData.get("filter") || "all"));
  const season = normaliseSeason(String(formData.get("season") || "2025-26"));
  const sort = normaliseSort(String(formData.get("sort") || "newest"));

  if (!id) {
    redirect(buildHref({ leagueId, filter, season, sort }));
  }

  await prisma.predictionHistory.update({
    where: { id },
    data: {
      actualResult: null,
      firstChoiceResult: null,
      secondChoiceResult: null,
      status: "PENDING",
    },
  });

  redirect(
    buildHref({
      leagueId,
      filter,
      season,
      sort,
      result: "reset",
    }),
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{
    error?: string;
    league?: string;
    filter?: string;
    season?: string;
    sort?: string;
    saved?: string;
    result?: string;
    sync?: string;
    synced?: string;
    skipped?: string;
    failed?: string;
  }>;
}) {
  const cookieStore = await cookies();
  const params = await searchParams;

  const isLoggedIn = cookieStore.get("profbint_admin")?.value === "true";
  const selectedLeagueId = params?.league || "39";
  const selectedFilter = normaliseFilter(params?.filter);
  const selectedSeason = normaliseSeason(params?.season);
  const selectedSort = normaliseSort(params?.sort);

  const selectedLeague =
    LEAGUES.find((league) => league.id === selectedLeagueId) || LEAGUES[0];

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
        <section className="mx-auto flex min-h-[80vh] max-w-md items-center">
          <div className="w-full rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <p className="text-sm font-black uppercase tracking-[0.3em] text-amber-400">
              Pro Football Intel
            </p>

            <h1 className="mt-4 text-3xl font-black">Admin dashboard</h1>

            <p className="mt-3 text-sm leading-6 text-slate-300">
              Private prediction tracking, saved snapshots, season filtering,
              and accuracy reporting for the Pro Football Intel admin app.
            </p>

            <form action={login} className="mt-6 space-y-4">
              <input
                name="password"
                type="password"
                placeholder="Admin password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-amber-400"
              />

              {params?.error === "wrong-password" ? (
                <p className="text-sm font-semibold text-red-400">
                  Wrong password. Try again.
                </p>
              ) : null}

              {params?.error === "missing-password" ? (
                <p className="text-sm font-semibold text-red-400">
                  ADMIN_PASSWORD is missing in Vercel.
                </p>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-2xl bg-amber-400 px-4 py-3 font-black text-slate-950 hover:bg-amber-300"
              >
                Unlock admin
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  const { predictions, error } = await getPredictions(selectedLeague.id);

  const savedWhere =
    selectedFilter === "pending"
      ? {
          leagueId: Number(selectedLeague.id),
          season: selectedSeason,
          status: "PENDING",
        }
      : selectedFilter === "won"
        ? {
            leagueId: Number(selectedLeague.id),
            season: selectedSeason,
            firstChoiceResult: "WON",
          }
        : selectedFilter === "lost"
          ? {
              leagueId: Number(selectedLeague.id),
              season: selectedSeason,
              firstChoiceResult: "LOST",
            }
          : {
              leagueId: Number(selectedLeague.id),
              season: selectedSeason,
            };

  const savedPredictions = await prisma.predictionHistory.findMany({
    where: savedWhere,
    orderBy: {
      savedAt: selectedSort === "oldest" ? "asc" : "desc",
    },
    take: 30,
  });

  const seasonPredictions = await prisma.predictionHistory.findMany({
    where: {
      season: selectedSeason,
    },
    orderBy: {
      savedAt: "asc",
    },
  });

  const completedSeasonPredictions = seasonPredictions.filter(
    (prediction) =>
      prediction.status === "RESULTED" &&
      prediction.actualResult &&
      prediction.firstChoiceResult,
  );

  const pendingSeasonPredictions = seasonPredictions.filter(
    (prediction) => prediction.status === "PENDING",
  );

  const selectedLeagueCompleted = completedSeasonPredictions.filter(
    (prediction) => prediction.leagueId === Number(selectedLeague.id),
  );

  const analyticsPredictions = filterPredictionsByResult(
    seasonPredictions,
    selectedFilter,
  );

  const completedAnalyticsPredictions = analyticsPredictions.filter(
    (prediction) =>
      prediction.status === "RESULTED" &&
      prediction.actualResult &&
      prediction.firstChoiceResult,
  );

  const overallStats = getAccuracyStats(analyticsPredictions);
  const selectedLeagueStats = getAccuracyStats(
    filterPredictionsByResult(selectedLeagueCompleted, selectedFilter),
  );
  const strongestStats = getStrongestAccuracyStats(analyticsPredictions);
  const firstChoiceStats = getAccuracyStats(analyticsPredictions);
  const secondChoiceStats = getSecondChoiceAccuracyStats(analyticsPredictions);

  const homePredictionStats = getPredictionTypeAccuracyStats(
    analyticsPredictions,
    "HOME",
  );
  const drawPredictionStats = getPredictionTypeAccuracyStats(
    analyticsPredictions,
    "DRAW",
  );
  const awayPredictionStats = getPredictionTypeAccuracyStats(
    analyticsPredictions,
    "AWAY",
  );

  const highConfidenceStats = getConfidenceAccuracyStats(
    analyticsPredictions,
    "High confidence",
  );
  const mediumConfidenceStats = getConfidenceAccuracyStats(
    analyticsPredictions,
    "Medium confidence",
  );
  const lowConfidenceStats = getConfidenceAccuracyStats(
    analyticsPredictions,
    "Low confidence",
  );

  const todayRange = getTodayRange();

  const todayCompleted = completedSeasonPredictions.filter((prediction) => {
    const updated = new Date(prediction.updatedAt);
    return updated >= todayRange.start && updated <= todayRange.end;
  });

  const todayWins = todayCompleted.filter(
    (prediction) => prediction.firstChoiceResult === "WON",
  ).length;

  const todayLosses = todayCompleted.filter(
    (prediction) => prediction.firstChoiceResult === "LOST",
  ).length;

  const todayStrongestWins = todayCompleted.filter(
    (prediction) => prediction.strongestPick === prediction.actualResult,
  ).length;

  const leagueBreakdown = LEAGUES.map((league) => {
    const leaguePredictions = filterPredictionsByResult(
      seasonPredictions.filter(
        (prediction) => prediction.leagueId === Number(league.id),
      ),
      selectedFilter,
    );

    return {
      ...league,
      stats: getAccuracyStats(leaguePredictions),
      tracked: leaguePredictions.length,
      pending: leaguePredictions.filter(
        (prediction) => prediction.status === "PENDING",
      ).length,
    };
  });

  const leagueRanking = [...leagueBreakdown].sort((a, b) => {
    const aAccuracy = a.stats.completed
      ? Math.round((a.stats.wins / a.stats.completed) * 100)
      : -1;
    const bAccuracy = b.stats.completed
      ? Math.round((b.stats.wins / b.stats.completed) * 100)
      : -1;

    if (bAccuracy !== aAccuracy) return bAccuracy - aAccuracy;
    return b.stats.completed - a.stats.completed;
  });

  const strongestPick = [...predictions].sort((a, b) => {
    const aMax = Math.max(a.homePercent, a.drawPercent, a.awayPercent);
    const bMax = Math.max(b.homePercent, b.drawPercent, b.awayPercent);
    return bMax - aMax;
  })[0];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-7xl px-4 py-8">
        <header className="rounded-[2rem] border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-5 shadow-2xl md:p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.35em] text-amber-400">
                Pro Football Intel Admin
              </p>

              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">
                Season accuracy dashboard
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                Track saved predictions, update match results, sync finished
                fixtures, and prepare clean result data for future graphs.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div
                className={`rounded-2xl border px-5 py-3 text-sm font-bold ${
                  error
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                API {error ? "issue" : "online"}
              </div>

              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-2xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-200 hover:border-amber-400 hover:text-amber-300"
                >
                  Lock dashboard
                </button>
              </form>
            </div>
          </div>
        </header>

        <nav className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900 p-3 shadow-xl">
          <p className="px-3 pb-3 text-xs font-black uppercase tracking-[0.25em] text-slate-500">
            League selector
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {LEAGUES.map((league) => {
              const isActive = league.id === selectedLeague.id;

              return (
                <a
                  key={league.id}
                  href={buildHref({
                    leagueId: league.id,
                    filter: selectedFilter,
                    season: selectedSeason,
                    sort: selectedSort,
                  })}
                  className={`rounded-2xl border px-4 py-3 text-sm font-black transition ${
                    isActive
                      ? "border-amber-400 bg-amber-400 text-slate-950"
                      : "border-slate-800 bg-slate-950 text-slate-300 hover:border-amber-400 hover:text-amber-300"
                  }`}
                >
                  <span className="block">{league.shortName}</span>
                  <span
                    className={`mt-1 block text-xs ${
                      isActive ? "text-slate-800" : "text-slate-500"
                    }`}
                  >
                    ID {league.id}
                  </span>
                </a>
              );
            })}
          </div>
        </nav>

        <section className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                Controls
              </p>

              <h2 className="mt-2 text-2xl font-black">
                {selectedLeague.name} · {getSeasonLabel(selectedSeason)}
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                Filters are stored in the URL so each view can be refreshed and
                safely returned to after updates.
              </p>
            </div>

            <form
              action="/"
              method="get"
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <input type="hidden" name="league" value={selectedLeague.id} />
              <input type="hidden" name="filter" value={selectedFilter} />

              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Season
                </span>
                <select
                  name="season"
                  defaultValue={selectedSeason}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-amber-400"
                >
                  {SEASONS.map((season) => (
                    <option key={season.value} value={season.value}>
                      {season.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Sort
                </span>
                <select
                  name="sort"
                  defaultValue={selectedSort}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-amber-400"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>

              <button
                type="submit"
                className="rounded-2xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-amber-300 sm:self-end"
              >
                Apply
              </button>
            </form>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
          <PremiumStatCard
            title="Overall accuracy"
            value={overallStats.accuracy}
            detail={`${overallStats.wins}/${overallStats.completed} resulted wins`}
          />

          <PremiumStatCard
            title={`${selectedLeague.shortName} accuracy`}
            value={selectedLeagueStats.accuracy}
            detail={`${selectedLeagueStats.wins}/${selectedLeagueStats.completed} resulted wins`}
          />

          <PremiumStatCard
            title="Strongest pick accuracy"
            value={strongestStats.accuracy}
            detail={`${strongestStats.wins}/${strongestStats.completed} strongest picks`}
          />

          <PremiumStatCard
            title="Today wins"
            value={String(todayWins)}
            detail="updated today"
          />

          <PremiumStatCard
            title="Today losses"
            value={String(todayLosses)}
            detail="updated today"
          />

          <PremiumStatCard
            title="Total tracked"
            value={String(seasonPredictions.length)}
            detail={`${getSeasonLabel(selectedSeason)} saved rows`}
          />

          <PremiumStatCard
            title="Pending"
            value={String(pendingSeasonPredictions.length)}
            detail="awaiting actual result"
          />
        </section>

        <section className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                Advanced analytics intelligence
              </p>

              <h2 className="mt-2 text-2xl font-black">
                {getSeasonLabel(selectedSeason)} ·{" "}
                {selectedFilter.toUpperCase()} sample
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                Server-side calculations from PredictionHistory. No graphs yet;
                this keeps the data ready for future results dashboards.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-slate-300">
              {completedAnalyticsPredictions.length} settled in current view
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <IntelligenceCard
              title="Strongest pick win rate"
              value={strongestStats.accuracy}
              total={strongestStats.completed}
              wins={strongestStats.wins}
              losses={strongestStats.losses}
              note="Based on strongestPick vs actualResult"
            />

            <IntelligenceCard
              title="First choice accuracy"
              value={firstChoiceStats.accuracy}
              total={firstChoiceStats.completed}
              wins={firstChoiceStats.wins}
              losses={firstChoiceStats.losses}
              note="Main model pick performance"
            />

            <IntelligenceCard
              title="Second choice accuracy"
              value={secondChoiceStats.accuracy}
              total={secondChoiceStats.completed}
              wins={secondChoiceStats.wins}
              losses={secondChoiceStats.losses}
              note="Backup model pick performance"
            />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <AnalyticsPanel title="Prediction-type accuracy">
              <AnalyticsRow
                label="HOME predictions"
                value={homePredictionStats.accuracy}
                detail={`${homePredictionStats.wins} won · ${homePredictionStats.losses} lost · ${homePredictionStats.completed} total`}
              />
              <AnalyticsRow
                label="DRAW predictions"
                value={drawPredictionStats.accuracy}
                detail={`${drawPredictionStats.wins} won · ${drawPredictionStats.losses} lost · ${drawPredictionStats.completed} total`}
              />
              <AnalyticsRow
                label="AWAY predictions"
                value={awayPredictionStats.accuracy}
                detail={`${awayPredictionStats.wins} won · ${awayPredictionStats.losses} lost · ${awayPredictionStats.completed} total`}
              />
            </AnalyticsPanel>

            <AnalyticsPanel title="Confidence-level tracking">
              <AnalyticsRow
                label="High confidence"
                value={highConfidenceStats.accuracy}
                detail={`${highConfidenceStats.wins} won · ${highConfidenceStats.losses} lost · ${highConfidenceStats.completed} total`}
              />
              <AnalyticsRow
                label="Medium confidence"
                value={mediumConfidenceStats.accuracy}
                detail={`${mediumConfidenceStats.wins} won · ${mediumConfidenceStats.losses} lost · ${mediumConfidenceStats.completed} total`}
              />
              <AnalyticsRow
                label="Low confidence"
                value={lowConfidenceStats.accuracy}
                detail={`${lowConfidenceStats.wins} won · ${lowConfidenceStats.losses} lost · ${lowConfidenceStats.completed} total`}
              />
            </AnalyticsPanel>

            <AnalyticsPanel title="Daily performance">
              <AnalyticsRow
                label="Today's wins"
                value={String(todayWins)}
                detail="First-choice wins updated today"
              />
              <AnalyticsRow
                label="Today's losses"
                value={String(todayLosses)}
                detail="First-choice losses updated today"
              />
              <AnalyticsRow
                label="Today's strongest wins"
                value={String(todayStrongestWins)}
                detail={`${todayCompleted.length} settled today`}
              />
            </AnalyticsPanel>
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                League ranking table
              </p>

              <h2 className="mt-2 text-2xl font-black">
                Accuracy ranked highest first
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                Sorted by accuracy, then by settled prediction volume. Uses the
                selected season and current result filter.
              </p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800">
            <div className="hidden grid-cols-[1.3fr_1fr_1fr_1fr_1fr] border-b border-slate-800 bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500 md:grid">
              <span>League</span>
              <span>Settled</span>
              <span>Wins</span>
              <span>Losses</span>
              <span>Accuracy</span>
            </div>

            <div className="divide-y divide-slate-800">
              {leagueRanking.map((league, index) => (
                <LeagueRankingRow
                  key={league.id}
                  rank={index + 1}
                  league={league.shortName}
                  settled={league.stats.completed}
                  wins={league.stats.wins}
                  losses={league.stats.losses}
                  accuracy={league.stats.accuracy}
                  active={league.id === selectedLeague.id}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-amber-500/30 bg-amber-500/10 p-4 shadow-xl md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                Manual result sync
              </p>

              <h2 className="mt-2 text-2xl font-black text-white">
                Sync finished results
              </h2>

              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
                Checks pending {getSeasonLabel(selectedSeason)} predictions with
                stored fixture IDs against API-Football. Finished matches are
                updated automatically; unfinished or missing fixtures are skipped
                safely.
              </p>
            </div>

            <form action={syncFinishedResults}>
              <input type="hidden" name="leagueId" value={selectedLeague.id} />
              <input type="hidden" name="filter" value={selectedFilter} />
              <input type="hidden" name="season" value={selectedSeason} />
              <input type="hidden" name="sort" value={selectedSort} />

              <button
                type="submit"
                className="rounded-2xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-amber-300"
              >
                Sync Finished Results
              </button>
            </form>
          </div>

          {params?.sync === "success" ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300">
              Result sync complete. Updated {params.synced || "0"} finished
              matches. Skipped {params.skipped || "0"}. Failed{" "}
              {params.failed || "0"}.
            </div>
          ) : null}

          {params?.sync === "partial" ? (
            <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300">
              Result sync partially completed. Updated {params.synced || "0"}.
              Skipped {params.skipped || "0"}. Failed {params.failed || "0"}.
            </div>
          ) : null}

          {params?.sync === "missing-key" ? (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
              Missing API_FOOTBALL_KEY in environment variables. Add it in
              Vercel before syncing.
            </div>
          ) : null}
        </section>

        <section className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                League accuracy breakdown
              </p>

              <h2 className="mt-2 text-2xl font-black">
                {getSeasonLabel(selectedSeason)} performance by league
              </h2>
            </div>

            <p className="text-sm text-slate-400">
              Built from completed/resulted predictions only.
            </p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            {leagueBreakdown.map((league) => (
              <LeagueAccuracyCard
                key={league.id}
                league={league.shortName}
                accuracy={league.stats.accuracy}
                wins={league.stats.wins}
                completed={league.stats.completed}
                pending={league.pending}
                active={league.id === selectedLeague.id}
              />
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                Saved prediction history
              </p>

              <h2 className="mt-2 text-2xl font-black">
                {selectedLeague.name} result tracker
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                Save the current league snapshot, then update actual results
                with 1, X, 2, or reset back to pending.
              </p>
            </div>

            <form action={saveLeagueSnapshot}>
              <input type="hidden" name="leagueId" value={selectedLeague.id} />
              <input type="hidden" name="filter" value={selectedFilter} />
              <input type="hidden" name="season" value={selectedSeason} />
              <input type="hidden" name="sort" value={selectedSort} />

              <button
                type="submit"
                className="rounded-2xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-amber-300"
              >
                Save current league snapshot
              </button>
            </form>
          </div>

          {params?.saved === "true" ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300">
              Snapshot saved successfully for {selectedLeague.name}.
            </div>
          ) : null}

          {params?.result === "updated" ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300">
              Result updated successfully.
            </div>
          ) : null}

          {params?.result === "reset" ? (
            <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-slate-300">
              Result reset to pending.
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {FILTERS.map((filter) => {
              const isActive = filter.id === selectedFilter;

              return (
                <a
                  key={filter.id}
                  href={buildHref({
                    leagueId: selectedLeague.id,
                    filter: filter.id,
                    season: selectedSeason,
                    sort: selectedSort,
                  })}
                  className={`rounded-2xl border px-4 py-2 text-sm font-black transition ${
                    isActive
                      ? "border-amber-400 bg-amber-400 text-slate-950"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-amber-400 hover:text-amber-300"
                  }`}
                >
                  {filter.label}
                </a>
              );
            })}

            <a
              href={buildHref({
                leagueId: selectedLeague.id,
                filter: selectedFilter,
                season: selectedSeason,
                sort: "newest",
              })}
              className={`rounded-2xl border px-4 py-2 text-sm font-black transition ${
                selectedSort === "newest"
                  ? "border-sky-400 bg-sky-400 text-slate-950"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-sky-400 hover:text-sky-300"
              }`}
            >
              Newest first
            </a>

            <a
              href={buildHref({
                leagueId: selectedLeague.id,
                filter: selectedFilter,
                season: selectedSeason,
                sort: "oldest",
              })}
              className={`rounded-2xl border px-4 py-2 text-sm font-black transition ${
                selectedSort === "oldest"
                  ? "border-sky-400 bg-sky-400 text-slate-950"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-sky-400 hover:text-sky-300"
              }`}
            >
              Oldest first
            </a>
          </div>

          <div className="mt-5 grid gap-3">
            {savedPredictions.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
                No {selectedFilter === "all" ? "" : selectedFilter} saved
                predictions found for {selectedLeague.name} in{" "}
                {getSeasonLabel(selectedSeason)}.
              </div>
            ) : (
              savedPredictions.map((prediction) => (
                <SavedPredictionRow
                  key={prediction.id}
                  prediction={prediction}
                  leagueId={selectedLeague.id}
                  filter={selectedFilter}
                  season={selectedSeason}
                  sort={selectedSort}
                />
              ))
            )}
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                Future graph data
              </p>

              <h2 className="mt-2 text-2xl font-black">Prepared metrics</h2>

              <p className="mt-1 text-sm text-slate-400">
                These clean season-level calculations are ready for future
                cumulative profit, strongest-pick, league comparison, and
                monthly trend graphs.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-slate-300">
              Read-only graph prep
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <GraphPrepCard
              title="Cumulative profit line"
              detail={`${completedSeasonPredictions.length} completed rows ready`}
            />
            <GraphPrepCard
              title="Strongest pick graph"
              detail={`${strongestStats.completed} strongest-pick results ready`}
            />
            <GraphPrepCard
              title="League comparison"
              detail={`${leagueBreakdown.length} tracked leagues configured`}
            />
            <GraphPrepCard
              title="Monthly trends"
              detail={`${getSeasonLabel(selectedSeason)} season filter active`}
            />
          </div>
        </section>

        {error ? (
          <div className="mt-6 rounded-3xl border border-red-900 bg-red-950/40 p-5 text-red-200">
            <p className="font-black">Prediction API error</p>
            <p className="mt-2 text-sm">{error}</p>
          </div>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 border-b border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black">
              {selectedLeague.name} live prediction board
            </h2>

            <p className="mt-1 text-sm text-slate-400">
              First and second choice are calculated from the 1X2 percentages
              returned by the Pro Football Intel API.
            </p>
          </div>

          <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-300">
            Private admin view
          </div>
        </div>

        <div className="mt-6 grid gap-5">
          {predictions.length === 0 && !error ? (
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
              No predictions returned for {selectedLeague.name} yet.
            </div>
          ) : null}

          {predictions.map((prediction) => (
            <article
              key={prediction.id}
              className="overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900 shadow-xl"
            >
              <div className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
                <div className="p-5 md:p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                      {prediction.league}
                    </span>

                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold text-slate-300">
                      {prediction.kickoff}
                    </span>
                  </div>

                  <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <TeamBlock
                      name={prediction.homeTeam}
                      logo={prediction.homeLogo}
                      align="left"
                    />

                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-sm font-black text-slate-400">
                      VS
                    </div>

                    <TeamBlock
                      name={prediction.awayTeam}
                      logo={prediction.awayLogo}
                      align="right"
                    />
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
                      Admin insight
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

function SavedPredictionRow({
  prediction,
  leagueId,
  filter,
  season,
  sort,
}: {
  prediction: SavedPrediction;
  leagueId: string;
  filter: ResultFilter;
  season: SeasonValue;
  sort: SortOrder;
}) {
  const strongestPickResult = getStrongestPickResult(prediction);

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950 p-4 shadow-lg">
      <div className="grid gap-5 xl:grid-cols-[1fr_auto] xl:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-black text-white">
              {prediction.homeTeam} vs {prediction.awayTeam}
            </p>

            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-black text-slate-300">
              {prediction.status}
            </span>

            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-black text-slate-400">
              {getSeasonLabel(prediction.season)}
            </span>
          </div>

          <p className="mt-1 text-sm text-slate-400">
            {prediction.kickoff
              ? formatKickoff(prediction.kickoff.toISOString())
              : "Kickoff TBC"}
          </p>

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <MiniResultBox
              title="First choice"
              value={`${getOutcomeShortLabel(
                prediction.firstChoice,
              )} · ${getOutcomeLabel(prediction.firstChoice)}`}
              status={getStatusLabel(prediction.firstChoiceResult)}
            />

            <MiniResultBox
              title="Second choice"
              value={`${getOutcomeShortLabel(
                prediction.secondChoice,
              )} · ${getOutcomeLabel(prediction.secondChoice)}`}
              status={getStatusLabel(prediction.secondChoiceResult)}
            />

            <MiniResultBox
              title="Actual result"
              value={`${getOutcomeShortLabel(
                prediction.actualResult,
              )} · ${getOutcomeLabel(prediction.actualResult)}`}
              status={prediction.actualResult ? "RESULTED" : "PENDING"}
            />

            <MiniResultBox
              title="Strongest pick"
              value={`${getOutcomeShortLabel(
                prediction.strongestPick,
              )} · ${getOutcomeLabel(prediction.strongestPick)}${
                prediction.strongestPercent
                  ? ` · ${prediction.strongestPercent}%`
                  : ""
              }`}
              status={strongestPickResult}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["HOME", "DRAW", "AWAY"] as Outcome[]).map((result) => (
            <form key={result} action={updateResult}>
              <input type="hidden" name="id" value={prediction.id} />
              <input type="hidden" name="leagueId" value={leagueId} />
              <input type="hidden" name="filter" value={filter} />
              <input type="hidden" name="season" value={season} />
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="actualResult" value={result} />

              <button
                type="submit"
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 hover:border-amber-400 hover:text-amber-300"
              >
                {getOutcomeShortLabel(result)}
              </button>
            </form>
          ))}

          <form action={resetResult}>
            <input type="hidden" name="id" value={prediction.id} />
            <input type="hidden" name="leagueId" value={leagueId} />
            <input type="hidden" name="filter" value={filter} />
            <input type="hidden" name="season" value={season} />
            <input type="hidden" name="sort" value={sort} />

            <button
              type="submit"
              className="rounded-xl border border-red-500/40 px-4 py-2 text-xs font-black text-red-300 hover:bg-red-500/10"
            >
              Reset
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function MiniResultBox({
  title,
  value,
  status,
}: {
  title: string;
  value: string;
  status: string;
}) {
  const isWon = status === "WON";
  const isLost = status === "LOST";
  const isPending = status === "PENDING";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-sm font-black text-white">{value}</p>

      <span
        className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-black ${
          isWon
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : isLost
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : isPending
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-slate-700 bg-slate-950 text-slate-300"
        }`}
      >
        {status}
      </span>
    </div>
  );
}

function IntelligenceCard({
  title,
  value,
  total,
  wins,
  losses,
  note,
}: {
  title: string;
  value: string;
  total: number;
  wins: number;
  losses: number;
  note: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
        {title}
      </p>
      <p className="mt-3 text-4xl font-black text-white">{value}</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <p className="text-lg font-black text-white">{total}</p>
          <p className="text-xs font-bold text-slate-500">Total</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="text-lg font-black text-emerald-300">{wins}</p>
          <p className="text-xs font-bold text-emerald-400/80">Won</p>
        </div>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-lg font-black text-red-300">{losses}</p>
          <p className="text-xs font-bold text-red-400/80">Lost</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-5 text-slate-400">{note}</p>
    </div>
  );
}

function AnalyticsPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950 p-4">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
        {title}
      </p>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function AnalyticsRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-black text-white">{label}</p>
          <p className="mt-1 text-sm text-slate-400">{detail}</p>
        </div>
        <p className="text-2xl font-black text-amber-300">{value}</p>
      </div>
    </div>
  );
}

function LeagueRankingRow({
  rank,
  league,
  settled,
  wins,
  losses,
  accuracy,
  active,
}: {
  rank: number;
  league: string;
  settled: number;
  wins: number;
  losses: number;
  accuracy: string;
  active: boolean;
}) {
  return (
    <div
      className={`grid gap-3 px-4 py-4 text-sm md:grid-cols-[1.3fr_1fr_1fr_1fr_1fr] md:items-center ${
        active ? "bg-amber-500/10" : "bg-slate-950"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-black ${
            active ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-white"
          }`}
        >
          {rank}
        </span>
        <div>
          <p className="font-black text-white">{league}</p>
          <p className="text-xs text-slate-500 md:hidden">
            {wins}W · {losses}L · {settled} settled
          </p>
        </div>
      </div>
      <p className="hidden font-bold text-slate-300 md:block">{settled}</p>
      <p className="hidden font-bold text-emerald-300 md:block">{wins}</p>
      <p className="hidden font-bold text-red-300 md:block">{losses}</p>
      <p className="text-2xl font-black text-white md:text-base md:text-amber-300">
        {accuracy}
      </p>
    </div>
  );
}

function PremiumStatCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-4 shadow-xl md:p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
        {title}
      </p>
      <p className="mt-3 text-3xl font-black text-white">{value}</p>
      <p className="mt-2 text-sm leading-5 text-slate-400">{detail}</p>
    </div>
  );
}

function LeagueAccuracyCard({
  league,
  accuracy,
  wins,
  completed,
  pending,
  active,
}: {
  league: string;
  accuracy: string;
  wins: number;
  completed: number;
  pending: number;
  active: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        active
          ? "border-amber-400 bg-amber-500/10"
          : "border-slate-800 bg-slate-950"
      }`}
    >
      <p
        className={`text-sm font-black ${
          active ? "text-amber-300" : "text-white"
        }`}
      >
        {league}
      </p>

      <p className="mt-3 text-3xl font-black text-white">{accuracy}</p>

      <p className="mt-2 text-xs font-bold text-slate-400">
        {wins}/{completed} wins
      </p>

      <p className="mt-1 text-xs font-bold text-slate-500">
        {pending} pending
      </p>
    </div>
  );
}

function GraphPrepCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <p className="font-black text-white">{title}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
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
          ? "border-amber-400 bg-amber-500/10"
          : "border-slate-800 bg-slate-950"
      }`}
    >
      <p className="text-sm font-bold text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-black text-white">{value}%</p>
      {active ? (
        <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-amber-300">
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
          ? "border-amber-400 bg-amber-500/10"
          : "border-slate-700 bg-slate-900"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p
            className={`text-xs font-black uppercase tracking-[0.22em] ${
              primary ? "text-amber-300" : "text-slate-500"
            }`}
          >
            {title}
          </p>

          <p className="mt-2 text-2xl font-black text-white">{choice}</p>
        </div>

        <span
          className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-black ${
            primary
              ? "bg-amber-400 text-slate-950"
              : "bg-slate-800 text-white"
          }`}
        >
          {badge}
        </span>
      </div>
    </div>
  );
}

function TeamBlock({
  name,
  logo,
  align,
}: {
  name: string;
  logo?: string;
  align: "left" | "right";
}) {
  return (
    <div
      className={`flex items-center gap-3 ${
        align === "right" ? "sm:flex-row-reverse sm:text-right" : ""
      }`}
    >
      {logo ? (
        <img
          src={logo}
          alt={`${name} logo`}
          className="h-12 w-12 shrink-0 rounded-full bg-white object-contain p-1"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-black text-slate-400">
          FC
        </div>
      )}

      <h3 className="text-xl font-black md:text-2xl">{name}</h3>
    </div>
  );
}