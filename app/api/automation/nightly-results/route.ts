import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Outcome = "HOME" | "DRAW" | "AWAY";

type RawPrediction = Record<string, unknown>;

type AdminPrediction = {
  fixtureId?: number;
  leagueId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffIso?: string;
  homePercent: number;
  drawPercent: number;
  awayPercent: number;
  firstChoice: Outcome;
  secondChoice: Outcome;
  strongestPick: Outcome;
  strongestPercent: number;
};

type ApiFootballFixtureResponse = {
  response?: Array<{
    fixture?: {
      status?: {
        short?: string | null;
        long?: string | null;
      };
    };
    goals?: {
      home?: number | null;
      away?: number | null;
    };
    score?: {
      fulltime?: {
        home?: number | null;
        away?: number | null;
      };
      extratime?: {
        home?: number | null;
        away?: number | null;
      };
      penalty?: {
        home?: number | null;
        away?: number | null;
      };
    };
  }>;
};

const PREDICTIONS_URL =
  "https://predictions.profbint.com/api/predictions";

const FINISHED_STATUSES = ["FT", "AET", "PEN", "AWD", "WO"];

const LEAGUES = [
  { id: 39, name: "Premier League" },
  { id: 140, name: "La Liga" },
  { id: 135, name: "Serie A" },
  { id: 78, name: "Bundesliga" },
  { id: 61, name: "Ligue 1" },
  { id: 88, name: "Eredivisie" },
  { id: 94, name: "Primeira Liga" },
];

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function parseDate(value?: string) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getCurrentSeason() {
  const londonParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());

  const year = Number(
    londonParts.find((part) => part.type === "year")?.value,
  );

  const month = Number(
    londonParts.find((part) => part.type === "month")?.value,
  );

  const startYear = month >= 7 ? year : year - 1;

  return {
    databaseSeason: `${startYear}-${String(startYear + 1).slice(-2)}`,
    apiSeason: startYear,
  };
}

function isLondonNightWindow() {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date());

  return Number(hour) === 23;
}

function getTopChoices(home: number, draw: number, away: number) {
  const outcomes = [
    { outcome: "HOME" as Outcome, value: home },
    { outcome: "DRAW" as Outcome, value: draw },
    { outcome: "AWAY" as Outcome, value: away },
  ].sort((a, b) => b.value - a.value);

  return {
    firstChoice: outcomes[0].outcome,
    secondChoice: outcomes[1].outcome,
  };
}

function normalisePrediction(
  raw: RawPrediction,
  leagueId: number,
): AdminPrediction {
  const prediction = readObject(raw.prediction);
  const teams = readObject(raw.teams);
  const home = readObject(teams.home);
  const away = readObject(teams.away);
  const fixture = readObject(raw.fixture);

  const homePercent = readNumber(prediction.homeWin);
  const drawPercent = readNumber(prediction.draw);
  const awayPercent = readNumber(prediction.awayWin);

  const choices = getTopChoices(
    homePercent,
    drawPercent,
    awayPercent,
  );

  const rawStrongestPick =
    readString(prediction.strongestPick).toUpperCase();

  const strongestPick: Outcome =
    rawStrongestPick === "HOME" ||
    rawStrongestPick === "DRAW" ||
    rawStrongestPick === "AWAY"
      ? rawStrongestPick
      : choices.firstChoice;

  const strongestPercent =
    strongestPick === "HOME"
      ? homePercent
      : strongestPick === "DRAW"
        ? drawPercent
        : awayPercent;

  return {
    fixtureId:
      readNumber(raw.fixtureId) ||
      readNumber(raw.fixture_id) ||
      readNumber(raw.id) ||
      undefined,
    leagueId,
    homeTeam:
      readString(raw.home) ||
      readString(raw.homeTeam) ||
      readString(home.name) ||
      "Home team",
    awayTeam:
      readString(raw.away) ||
      readString(raw.awayTeam) ||
      readString(away.name) ||
      "Away team",
    kickoffIso:
      readString(raw.date) ||
      readString(raw.kickoff) ||
      readString(fixture.date) ||
      undefined,
    homePercent,
    drawPercent,
    awayPercent,
    firstChoice: choices.firstChoice,
    secondChoice: choices.secondChoice,
    strongestPick,
    strongestPercent,
  };
}

async function fetchLeaguePredictions(
  leagueId: number,
  apiSeason: number,
) {
  const response = await fetch(
    `${PREDICTIONS_URL}?league=${leagueId}&season=${apiSeason}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Predictions V2 returned ${response.status}`);
  }

  const data = await response.json();
  const payload = readObject(data);

  const rows: RawPrediction[] = Array.isArray(data)
    ? data
    : Array.isArray(payload.matches)
      ? (payload.matches as RawPrediction[])
      : Array.isArray(payload.predictions)
        ? (payload.predictions as RawPrediction[])
        : [];

  return rows.map((row) =>
    normalisePrediction(row, leagueId),
  );
}

function readScorePair(
  home: number | null | undefined,
  away: number | null | undefined,
) {
  if (typeof home === "number" && typeof away === "number") {
    return { home, away };
  }

  return null;
}

function determineOutcome(home: number, away: number): Outcome {
  if (home > away) return "HOME";
  if (away > home) return "AWAY";
  return "DRAW";
}

async function fetchFinishedResult(fixtureId: number) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  const apiHost =
    process.env.API_FOOTBALL_HOST ||
    "v3.football.api-sports.io";

  if (!apiKey) {
    throw new Error("API_FOOTBALL_KEY is missing");
  }

  const response = await fetch(
    `https://${apiHost}/fixtures?id=${fixtureId}`,
    {
      cache: "no-store",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": apiHost,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`API-Football returned ${response.status}`);
  }

  const data =
    (await response.json()) as ApiFootballFixtureResponse;

  const fixture = data.response?.[0];

  if (!fixture) {
    return null;
  }

  const status = fixture.fixture?.status?.short || "";

  if (!FINISHED_STATUSES.includes(status)) {
    return null;
  }

  const goals = readScorePair(
    fixture.goals?.home,
    fixture.goals?.away,
  );

  const fulltime = readScorePair(
    fixture.score?.fulltime?.home,
    fixture.score?.fulltime?.away,
  );

  const extratime = readScorePair(
    fixture.score?.extratime?.home,
    fixture.score?.extratime?.away,
  );

  const penalty = readScorePair(
    fixture.score?.penalty?.home,
    fixture.score?.penalty?.away,
  );

  let score = goals || fulltime || extratime || penalty;

  if (status === "PEN") {
    score = fulltime || goals || extratime || penalty;
  }

  if (!score) {
    return null;
  }

  return determineOutcome(score.home, score.away);
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.NIGHTLY_RESULTS_SECRET;

  if (!configuredSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "NIGHTLY_RESULTS_SECRET is not configured.",
      },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${configuredSecret}`) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized.",
      },
      { status: 401 },
    );
  }

  const forceRun =
    request.headers.get("x-profbint-force") === "true";

  if (!forceRun && !isLondonNightWindow()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Outside the 23:00-23:59 Europe/London window.",
    });
  }

  const { databaseSeason, apiSeason } = getCurrentSeason();

  const summary = {
    season: databaseSeason,
    leaguesChecked: 0,
    predictionsReceived: 0,
    predictionsCreated: 0,
    predictionsUpdated: 0,
    importFailures: 0,
    pendingChecked: 0,
    resultsUpdated: 0,
    unfinished: 0,
    missingFixtureId: 0,
    settlementFailures: 0,
  };

  for (const league of LEAGUES) {
    try {
      const predictions = await fetchLeaguePredictions(
        league.id,
        apiSeason,
      );

      summary.leaguesChecked += 1;
      summary.predictionsReceived += predictions.length;

      for (const prediction of predictions) {
        try {
          const kickoff = parseDate(prediction.kickoffIso);

          const existing = prediction.fixtureId
            ? await prisma.predictionHistory.findFirst({
                where: {
                  fixtureId: prediction.fixtureId,
                  leagueId: prediction.leagueId,
                  season: databaseSeason,
                },
              })
            : await prisma.predictionHistory.findFirst({
                where: {
                  leagueId: prediction.leagueId,
                  season: databaseSeason,
                  homeTeam: prediction.homeTeam,
                  awayTeam: prediction.awayTeam,
                  kickoff,
                },
              });

          const predictionData = {
            fixtureId: prediction.fixtureId || null,
            leagueId: prediction.leagueId,
            leagueName: league.name,
            season: databaseSeason,
            homeTeam: prediction.homeTeam,
            awayTeam: prediction.awayTeam,
            kickoff,
            firstChoice: prediction.firstChoice,
            secondChoice: prediction.secondChoice,
            homeWinPercent: prediction.homePercent,
            drawPercent: prediction.drawPercent,
            awayWinPercent: prediction.awayPercent,
            strongestPick: prediction.strongestPick,
            strongestPercent: prediction.strongestPercent,
          };

          if (existing) {
            await prisma.predictionHistory.update({
              where: {
                id: existing.id,
              },
              data: predictionData,
            });

            summary.predictionsUpdated += 1;
          } else {
            await prisma.predictionHistory.create({
              data: {
                ...predictionData,
                actualResult: null,
                firstChoiceResult: null,
                secondChoiceResult: null,
                status: "PENDING",
              },
            });

            summary.predictionsCreated += 1;
          }
        } catch {
          summary.importFailures += 1;
        }
      }
    } catch {
      summary.importFailures += 1;
    }
  }

  const pendingPredictions =
    await prisma.predictionHistory.findMany({
      where: {
        season: databaseSeason,
        status: "PENDING",
        kickoff: {
          lte: new Date(),
        },
      },
      orderBy: {
        kickoff: "asc",
      },
    });

  for (const prediction of pendingPredictions) {
    summary.pendingChecked += 1;

    if (!prediction.fixtureId) {
      summary.missingFixtureId += 1;
      continue;
    }

    try {
      const actualResult = await fetchFinishedResult(
        prediction.fixtureId,
      );

      if (!actualResult) {
        summary.unfinished += 1;
        continue;
      }

      const firstChoiceResult =
        prediction.firstChoice === actualResult
          ? "WON"
          : "LOST";

      const secondChoiceResult =
        prediction.secondChoice === actualResult
          ? "WON"
          : "LOST";

      await prisma.predictionHistory.update({
        where: {
          id: prediction.id,
        },
        data: {
          actualResult,
          firstChoiceResult,
          secondChoiceResult,
          status: "RESULTED",
        },
      });

      summary.resultsUpdated += 1;
    } catch {
      summary.settlementFailures += 1;
    }
  }

  return NextResponse.json({
    ok:
      summary.importFailures === 0 &&
      summary.settlementFailures === 0,
    ranAt: new Date().toISOString(),
    summary,
  });
}