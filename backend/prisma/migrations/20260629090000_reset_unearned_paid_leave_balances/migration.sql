-- Recalcule les droits CP existants selon l'ancienneté réelle.
-- Avant 1 an : acquisition mensuelle au prorata (24 jours = 2 jours/mois).
-- À partir du premier anniversaire : droit annuel complet.
WITH cp_balances AS (
  SELECT
    balance."id",
    balance."year",
    employee."dateEmbauche"::date AS hire_date,
    CASE
      WHEN leave_type."defaultDays" > 0 THEN leave_type."defaultDays"
      ELSE 24
    END AS annual_days,
    CASE
      WHEN balance."year" = EXTRACT(YEAR FROM CURRENT_DATE)::integer
        THEN CURRENT_DATE
      ELSE make_date(balance."year", 12, 31)
    END AS reference_date
  FROM "LeaveBalance" AS balance
  INNER JOIN "User" AS employee ON employee."id" = balance."userId"
  INNER JOIN "LeaveType" AS leave_type ON leave_type."id" = balance."leaveTypeId"
  WHERE leave_type."code" = 'CP'
),
computed AS (
  SELECT
    "id",
    ROUND((
      CASE
        WHEN reference_date < hire_date THEN 0
        WHEN reference_date >= hire_date + INTERVAL '1 year' THEN annual_days
        ELSE LEAST(
          annual_days,
          GREATEST(
            0,
            (
              EXTRACT(YEAR FROM AGE(reference_date, hire_date))::integer * 12
            ) + EXTRACT(MONTH FROM AGE(reference_date, hire_date))::integer
          ) * (annual_days / 12.0)
        )
      END
    )::numeric, 1)::double precision AS acquired
  FROM cp_balances
)
UPDATE "LeaveBalance" AS balance
SET
  "acquired" = computed."acquired",
  "updatedAt" = CURRENT_TIMESTAMP
FROM computed
WHERE balance."id" = computed."id"
  AND balance."acquired" <> computed."acquired";
