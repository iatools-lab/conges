import { LeaveCategory } from '@prisma/client';

export const PAID_LEAVE_POOL_CODES = new Set(['CP', 'ANC', 'ENF', 'PASSIF']);
export const SPECIAL_LEAVE_POOL_CAP_DAYS = 12;
const EXCLUDED_SPECIAL_CODES = new Set([
  'PASSIF',
  'MAT',
  'SS',
  'SPE',
  'MAL',
  'ACC_EPOUSE',
]);

export type LeaveBalancePoolInput = {
  acquired: number;
  carryover: number;
  taken: number;
  scheduled: number;
  leaveType: {
    code: string;
    category: LeaveCategory;
  };
};

export type LeaveBalancePoolSummary = {
  acquired: number;
  taken: number;
  scheduled: number;
  remaining: number;
};

export function summarizePaidLeavePool(
  balances: LeaveBalancePoolInput[],
): LeaveBalancePoolSummary {
  return sumRawBalances(balances.filter((balance) => isPaidLeavePool(balance)));
}

export function summarizeSpecialLeavePool(
  balances: LeaveBalancePoolInput[],
): LeaveBalancePoolSummary {
  const specialBalances = balances.filter((balance) =>
    isSpecialLeavePool(balance),
  );
  const consumed = sumRawBalances(specialBalances);
  const acquired = specialBalances.length ? SPECIAL_LEAVE_POOL_CAP_DAYS : 0;

  return {
    acquired,
    taken: consumed.taken,
    scheduled: consumed.scheduled,
    remaining: roundDays(acquired - consumed.taken - consumed.scheduled),
  };
}

export function paidPassifRemaining(balances: LeaveBalancePoolInput[]) {
  const passifBalance = balances.find(
    (balance) => normalizeCode(balance.leaveType.code) === 'PASSIF',
  );
  if (!passifBalance) return 0;

  return roundDays(
    Math.max(
      0,
      passifBalance.acquired +
        passifBalance.carryover -
        passifBalance.taken -
        passifBalance.scheduled,
    ),
  );
}

export function isPaidLeavePool(balance: {
  leaveType: { code: string; category?: LeaveCategory };
}) {
  return (
    PAID_LEAVE_POOL_CODES.has(normalizeCode(balance.leaveType.code)) ||
    balance.leaveType.category === LeaveCategory.CONGE_PAYE
  );
}

export function isSpecialLeavePool(balance: {
  leaveType: { code: string; category: LeaveCategory };
}) {
  const code = normalizeCode(balance.leaveType.code);
  if (isPaidLeavePool(balance)) return false;
  if (EXCLUDED_SPECIAL_CODES.has(code)) return false;

  return (
    balance.leaveType.category === LeaveCategory.CONGE_SPECIAL ||
    balance.leaveType.category === LeaveCategory.CONGE_PATERNITE
  );
}

function sumRawBalances(
  balances: LeaveBalancePoolInput[],
): LeaveBalancePoolSummary {
  return balances.reduce(
    (total, balance) => ({
      acquired: roundDays(
        total.acquired + balance.acquired + balance.carryover,
      ),
      taken: roundDays(total.taken + balance.taken),
      scheduled: roundDays(total.scheduled + balance.scheduled),
      remaining: roundDays(
        total.remaining +
          balance.acquired +
          balance.carryover -
          balance.taken -
          balance.scheduled,
      ),
    }),
    { acquired: 0, taken: 0, scheduled: 0, remaining: 0 },
  );
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function roundDays(value: number) {
  return Math.round(Number(value ?? 0) * 10) / 10;
}
