import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type VerifiedResult = "WON" | "LOST" | "PENDING";

function getVerifiedResult(
  pick: string,
  actualResult: string | null,
  predictionStatus: string | null,
): VerifiedResult {
  if (predictionStatus !== "RESULTED" || !actualResult) {
    return "PENDING";
  }

  return pick === actualResult ? "WON" : "LOST";
}

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.STRONGEST_PICKS_HISTORY_SECRET?.trim();
  const providedSecret = request.headers
    .get("x-strongest-picks-history-key")
    ?.trim();

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Strongest Picks history service is not configured." },
      { status: 503 },
    );
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const strongestPicks = await prisma.strongestPickHistory.findMany({
      orderBy: {
        kickoff: "desc",
      },
    });

    const fixtureIds = strongestPicks.map((pick) => pick.fixtureId);

    const predictionResults =
      fixtureIds.length > 0
        ? await prisma.predictionHistory.findMany({
            where: {
              fixtureId: {
                in: fixtureIds,
              },
            },
            select: {
              fixtureId: true,
              actualResult: true,
              status: true,
            },
          })
        : [];

    const resultsByFixtureId = new Map<
      number,
      { actualResult: string | null; status: string }
    >();

    for (const prediction of predictionResults) {
      if (
        prediction.fixtureId !== null &&
        !resultsByFixtureId.has(prediction.fixtureId)
      ) {
        resultsByFixtureId.set(prediction.fixtureId, {
          actualResult: prediction.actualResult,
          status: prediction.status,
        });
      }
    }

    const history = strongestPicks.map((pick) => {
      const prediction = resultsByFixtureId.get(pick.fixtureId);
      const actualResult =
        prediction?.status === "RESULTED"
          ? prediction.actualResult
          : null;

      return {
        fixtureId: pick.fixtureId,
        league: pick.league,
        kickoff: pick.kickoff.toISOString(),
        homeTeam: pick.homeTeam,
        awayTeam: pick.awayTeam,
        pick: pick.pick,
        selectedTeam: pick.selectedTeam,
        qualifiedAt: pick.qualifiedAt.toISOString(),
        actualResult,
        result: getVerifiedResult(
          pick.pick,
          actualResult,
          prediction?.status ?? null,
        ),
      };
    });

    const settled = history.filter((item) => item.result !== "PENDING");
    const wins = settled.filter((item) => item.result === "WON").length;
    const losses = settled.filter((item) => item.result === "LOST").length;
    const pending = history.filter((item) => item.result === "PENDING").length;

    return NextResponse.json(
      {
        summary: {
          total: history.length,
          settled: settled.length,
          wins,
          losses,
          pending,
          accuracy:
            settled.length > 0
              ? Math.round((wins / settled.length) * 100)
              : 0,
        },
        history,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Strongest Picks history API error:", error);

    return NextResponse.json(
      { error: "Unable to load Strongest Picks history." },
      { status: 500 },
    );
  }
}
