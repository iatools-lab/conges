-- CreateEnum
CREATE TYPE "OvertimeStatus" AS ENUM ('PENDING_MANAGER', 'IN_REVIEW_RH', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "OvertimeRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" "OvertimeStatus" NOT NULL DEFAULT 'PENDING_MANAGER',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "managerValidatorId" TEXT,
    "managerComment" TEXT,
    "managerDecidedAt" TIMESTAMP(3),
    "rhValidatorId" TEXT,
    "rhComment" TEXT,
    "rhDecidedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeRequest_reference_key" ON "OvertimeRequest"("reference");

-- CreateIndex
CREATE INDEX "OvertimeRequest_ownerId_idx" ON "OvertimeRequest"("ownerId");

-- CreateIndex
CREATE INDEX "OvertimeRequest_status_idx" ON "OvertimeRequest"("status");

-- CreateIndex
CREATE INDEX "OvertimeRequest_workDate_idx" ON "OvertimeRequest"("workDate");

-- CreateIndex
CREATE INDEX "OvertimeRequest_managerValidatorId_idx" ON "OvertimeRequest"("managerValidatorId");

-- CreateIndex
CREATE INDEX "OvertimeRequest_rhValidatorId_idx" ON "OvertimeRequest"("rhValidatorId");

-- AddForeignKey
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_managerValidatorId_fkey" FOREIGN KEY ("managerValidatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_rhValidatorId_fkey" FOREIGN KEY ("rhValidatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
