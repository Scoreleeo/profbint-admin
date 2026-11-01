import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type StrongestPick = {
  fixtureId: number;
  date: string;
  league: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  pick: "HOME" | "AWAY";
};

type StrongestPicksPayload = {
  date: string;
  total: number;
  picks: StrongestPick[];
};

function parseKickoff(value: string) {
  const kickoff = new Date(value);

  return Number.isNaN(kickoff.getTime()) ? null : kickoff;
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.STRONGEST_PICKS_SNAPSHOT_SECRET?.trim();

  if (!configuredSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "STRONGEST_PICKS_SNAPSHOT_SECRET is not configured.",
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

  const strongestPicksUrl =
    process.env.PROFBINT_STRONGEST_PICKS_URL?.trim() ||
    "https://profbint.com/api/strongest-picks";

  const response = await fetch(strongestPicksUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Strongest Picks returned ${response.status}.`,
      },
      { status: 502 },
    );
  }

  const data = (await response.json()) as StrongestPicksPayload;
  const picks = Array.isArray(data.picks) ? data.picks : [];
  const now = new Date();

  const summary = {
    received: picks.length,
    created: 0,
    alreadySaved: 0,
    skippedInvalid: 0,
    skippedStarted: 0,
    failures: 0,
  };

  for (const pick of picks) {
    const fixtureId = Number(pick.fixtureId);
    const kickoff = parseKickoff(pick.kickoff);

    if (
      !Number.isInteger(fixtureId) ||
      fixtureId <= 0 ||
      !kickoff ||
      !pick.league ||
      !pick.homeTeam ||
      !pick.awayTeam ||
      (pick.pick !== "HOME" && pick.pick !== "AWAY")
    ) {
      summary.skippedInvalid += 1;
      continue;
    }

    if (kickoff <= now) {
      summary.skippedStarted += 1;
      continue;
    }

    try {
      const existing = await prisma.strongestPickHistory.findUnique({
        where: {
          fixtureId,
        },
        select: {
          id: true,
        },
      });

      if (existing) {
        summary.alreadySaved += 1;
        continue;
      }

      await prisma.strongestPickHistory.create({
        data: {
          fixtureId,
          league: pick.league,
          kickoff,
          homeTeam: pick.homeTeam,
          awayTeam: pick.awayTeam,
          pick: pick.pick,
          selectedTeam:
            pick.pick === "HOME" ? pick.homeTeam : pick.awayTeam,
        },
      });

      summary.created += 1;
    } catch (error) {
      console.error(
        `Strongest Picks snapshot failed for fixture ${fixtureId}:`,
        error,
      );
      summary.failures += 1;
    }
  }

  return NextResponse.json({
    ok: summary.failures === 0,
    capturedAt: now.toISOString(),
    sourceDate: data.date,
    summary,
  });
}
