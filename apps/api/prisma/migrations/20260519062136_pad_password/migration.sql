-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Pad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "kind" TEXT NOT NULL DEFAULT 'sandbox',
    "ownerId" TEXT NOT NULL,
    "questionId" TEXT,
    "passwordHash" TEXT,
    "passwordRole" TEXT NOT NULL DEFAULT 'collaborator',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pad_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pad_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Pad" ("createdAt", "id", "kind", "language", "ownerId", "questionId", "slug", "title", "updatedAt") SELECT "createdAt", "id", "kind", "language", "ownerId", "questionId", "slug", "title", "updatedAt" FROM "Pad";
DROP TABLE "Pad";
ALTER TABLE "new_Pad" RENAME TO "Pad";
CREATE UNIQUE INDEX "Pad_slug_key" ON "Pad"("slug");
CREATE INDEX "Pad_ownerId_idx" ON "Pad"("ownerId");
CREATE INDEX "Pad_slug_idx" ON "Pad"("slug");
CREATE INDEX "Pad_updatedAt_idx" ON "Pad"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
