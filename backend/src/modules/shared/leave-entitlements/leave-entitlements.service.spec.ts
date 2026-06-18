import { LeaveEntitlementsService } from './leave-entitlements.service';

describe('LeaveEntitlementsService', () => {
  const service = new LeaveEntitlementsService();

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
