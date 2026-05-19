/*
  Warnings:

  - You are about to drop the column `createdAt` on the `PredictionHistory` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `PredictionHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PredictionHistory" DROP COLUMN "createdAt",
ADD COLUMN     "actualResult" TEXT,
ADD COLUMN     "firstChoiceResult" TEXT,
ADD COLUMN     "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "secondChoiceResult" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "PredictionHistory_fixtureId_idx" ON "PredictionHistory"("fixtureId");

-- CreateIndex
CREATE INDEX "PredictionHistory_leagueId_idx" ON "PredictionHistory"("leagueId");

-- CreateIndex
CREATE INDEX "PredictionHistory_status_idx" ON "PredictionHistory"("status");
