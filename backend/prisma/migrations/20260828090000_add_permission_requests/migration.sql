-- CreateTable
CREATE TABLE "PermissionRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "permissionDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
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

    CONSTRAINT "PermissionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PermissionRequest_reference_key" ON "PermissionRequest"("reference");

-- CreateIndex
CREATE INDEX "PermissionRequest_ownerId_idx" ON "PermissionRequest"("ownerId");

-- CreateIndex
CREATE INDEX "PermissionRequest_status_idx" ON "PermissionRequest"("status");

-- CreateIndex
CREATE INDEX "PermissionRequest_permissionDate_idx" ON "PermissionRequest"("permissionDate");

-- CreateIndex
CREATE INDEX "PermissionRequest_managerValidatorId_idx" ON "PermissionRequest"("managerValidatorId");

-- CreateIndex
CREATE INDEX "PermissionRequest_rhValidatorId_idx" ON "PermissionRequest"("rhValidatorId");

-- CreateIndex
CREATE INDEX "PermissionRequest_ownerId_permissionDate_idx" ON "PermissionRequest"("ownerId", "permissionDate");

-- AddForeignKey
ALTER TABLE "PermissionRequest" ADD CONSTRAINT "PermissionRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRequest" ADD CONSTRAINT "PermissionRequest_managerValidatorId_fkey" FOREIGN KEY ("managerValidatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRequest" ADD CONSTRAINT "PermissionRequest_rhValidatorId_fkey" FOREIGN KEY ("rhValidatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
