-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Pad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "kind" TEXT NOT NULL DEFAULT 'sandbox',
    "ownerId" TEXT NOT NULL,
    "questionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pad_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pad_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PadFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "padId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "yjsState" BLOB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PadFile_padId_fkey" FOREIGN KEY ("padId") REFERENCES "Pad" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PadMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "padId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'collaborator',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PadMember_padId_fkey" FOREIGN KEY ("padId") REFERENCES "Pad" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PadMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "padId" TEXT NOT NULL,
    "email" TEXT,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'collaborator',
    "createdBy" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_padId_fkey" FOREIGN KEY ("padId") REFERENCES "Pad" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invite_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "padId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_padId_fkey" FOREIGN KEY ("padId") REFERENCES "Pad" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "padId" TEXT NOT NULL,
    "fileId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" BLOB NOT NULL,
    "meta" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EditEvent_padId_fkey" FOREIGN KEY ("padId") REFERENCES "Pad" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "tags" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Question_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterviewScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "padId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "correctness" INTEGER NOT NULL DEFAULT 0,
    "style" INTEGER NOT NULL DEFAULT 0,
    "communication" INTEGER NOT NULL DEFAULT 0,
    "problemSolving" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewScore_padId_fkey" FOREIGN KEY ("padId") REFERENCES "Pad" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewScore_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Pad_slug_key" ON "Pad"("slug");

-- CreateIndex
CREATE INDEX "Pad_ownerId_idx" ON "Pad"("ownerId");

-- CreateIndex
CREATE INDEX "Pad_slug_idx" ON "Pad"("slug");

-- CreateIndex
CREATE INDEX "Pad_updatedAt_idx" ON "Pad"("updatedAt");

-- CreateIndex
CREATE INDEX "PadFile_padId_idx" ON "PadFile"("padId");

-- CreateIndex
CREATE UNIQUE INDEX "PadFile_padId_name_key" ON "PadFile"("padId", "name");

-- CreateIndex
CREATE INDEX "PadMember_userId_idx" ON "PadMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PadMember_padId_userId_key" ON "PadMember"("padId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_padId_idx" ON "Invite"("padId");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE INDEX "ChatMessage_padId_createdAt_idx" ON "ChatMessage"("padId", "createdAt");

-- CreateIndex
CREATE INDEX "EditEvent_padId_createdAt_idx" ON "EditEvent"("padId", "createdAt");

-- CreateIndex
CREATE INDEX "Question_createdBy_idx" ON "Question"("createdBy");

-- CreateIndex
CREATE INDEX "Question_difficulty_idx" ON "Question"("difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewScore_padId_key" ON "InterviewScore"("padId");
