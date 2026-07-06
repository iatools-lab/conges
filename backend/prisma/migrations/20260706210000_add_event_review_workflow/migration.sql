ALTER TABLE "Event"
ADD COLUMN "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "rhComment" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

UPDATE "Event"
SET "status" = CASE
  WHEN "description" LIKE '%[RH_STATUS:REJECTED]' THEN 'REJECTED'::"LeaveRequestStatus"
  WHEN "description" LIKE '%[RH_STATUS:CANCELLED]' THEN 'CANCELLED'::"LeaveRequestStatus"
  WHEN "description" LIKE '%[RH_STATUS:APPROVED]' OR "processed" = TRUE
    THEN 'APPROVED'::"LeaveRequestStatus"
  ELSE 'PENDING'::"LeaveRequestStatus"
END,
"reviewedAt" = CASE
  WHEN "processed" = TRUE OR "description" LIKE '%[RH_STATUS:%]' THEN "updatedAt"
  ELSE NULL
END,
"description" = NULLIF(
  TRIM(REGEXP_REPLACE(COALESCE("description", ''), '\s*\[RH_STATUS:(APPROVED|REJECTED|CANCELLED)\]\s*$', '')),
  ''
);

CREATE INDEX "Event_status_idx" ON "Event"("status");
