-- CreateTable
CREATE TABLE "PredictionHistory" (
    "id" SERIAL NOT NULL,
    "fixtureId" INTEGER,
    "leagueId" INTEGER,
    "leagueName" TEXT,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "kickoff" TIMESTAMP(3),
    "firstChoice" TEXT,
    "secondChoice" TEXT,
    "homeWinPercent" DOUBLE PRECISION,
    "drawPercent" DOUBLE PRECISION,
    "awayWinPercent" DOUBLE PRECISION,
    "strongestPick" TEXT,
    "strongestPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionHistory_pkey" PRIMARY KEY ("id")
);
