import { LeaveEntitlementsService } from './leave-entitlements.service';

describe('LeaveEntitlementsService', () => {
  const service = new LeaveEntitlementsService();

  describe('paid leave seniority rule', () => {
    const hireDate = new Date('2025-08-15T00:00:00.000Z');

    it('accrues paid leave monthly before the first work anniversary', () => {
      expect(
        service.getPaidLeaveDays(
          hireDate,
          2026,
          24,
          new Date('2026-08-14T23:59:59.000Z'),
        ),
      ).toBe(22);
    });

    it('credits all 24 days on the first work anniversary', () => {
      expect(
        service.getPaidLeaveDays(
          hireDate,
          2026,
          24,
          new Date('2026-08-15T00:00:00.000Z'),
        ),
      ).toBe(24);
    });

    it('credits two days per completed month for a current-year hire', () => {
      expect(
        service.getPaidLeaveDays(
          new Date('2026-02-10T00:00:00.000Z'),
          2026,
          24,
          new Date('2026-06-29T00:00:00.000Z'),
        ),
      ).toBe(8);
    });

    it('does not credit paid leave before the hire date', () => {
      expect(
        service.getPaidLeaveDays(
          new Date('2026-02-10T00:00:00.000Z'),
          2026,
          24,
          new Date('2026-01-31T00:00:00.000Z'),
        ),
      ).toBe(0);
    });
  });

  it('caps passive leave to 72 days and splits it over three years', () => {
    expect(service.getPassiveLeaveDays(90, 2025)).toBe(24);
    expect(service.getPassiveLeaveDays(90, 2026)).toBe(24);
    expect(service.getPassiveLeaveDays(90, 2027)).toBe(24);
  });

  it('splits passive leave below the cap across the passive years', () => {
    expect(service.getPassiveLeaveDays(70, 2025)).toBe(24);
    expect(service.getPassiveLeaveDays(70, 2026)).toBe(23);
    expect(service.getPassiveLeaveDays(70, 2027)).toBe(23);
  });
});
