import {
  getCurrentLeaveYear,
  getLeaveYear,
  getLeaveYearRange,
  splitPeriodByLeaveYear,
} from './leave-year';

describe('leave-year helpers', () => {
  it('maps dates to the temporary April-March leave exercises', () => {
    expect(getLeaveYear(new Date('2027-02-15T00:00:00.000Z'))).toBe(2026);
    expect(getLeaveYear(new Date('2027-04-15T00:00:00.000Z'))).toBe(2027);
    expect(getLeaveYear(new Date('2028-03-31T00:00:00.000Z'))).toBe(2027);
    expect(getLeaveYear(new Date('2028-04-01T00:00:00.000Z'))).toBe(2028);
    expect(getCurrentLeaveYear(new Date('2026-07-10T00:00:00.000Z'))).toBe(
      2026,
    );
  });

  it('returns the expected leave-year ranges', () => {
    expect(getLeaveYearRange(2026)).toEqual(
      expect.objectContaining({
        start: new Date('2026-04-01T00:00:00.000Z'),
        endInclusive: new Date('2027-03-31T00:00:00.000Z'),
      }),
    );
    expect(getLeaveYearRange(2027)).toEqual(
      expect.objectContaining({
        start: new Date('2027-04-01T00:00:00.000Z'),
        endInclusive: new Date('2028-03-31T00:00:00.000Z'),
      }),
    );
    expect(getLeaveYearRange(2028)).toEqual(
      expect.objectContaining({
        start: new Date('2028-04-01T00:00:00.000Z'),
        endInclusive: new Date('2028-12-31T00:00:00.000Z'),
      }),
    );
    expect(getLeaveYearRange(2029)).toEqual(
      expect.objectContaining({
        start: new Date('2029-01-01T00:00:00.000Z'),
        endInclusive: new Date('2029-12-31T00:00:00.000Z'),
      }),
    );
  });

  it('splits periods that cross a leave exercise boundary', () => {
    expect(
      splitPeriodByLeaveYear(
        new Date('2027-03-28T00:00:00.000Z'),
        new Date('2027-04-04T00:00:00.000Z'),
      ),
    ).toEqual([
      {
        year: 2026,
        startDate: new Date('2027-03-28T00:00:00.000Z'),
        endDate: new Date('2027-03-31T00:00:00.000Z'),
      },
      {
        year: 2027,
        startDate: new Date('2027-04-01T00:00:00.000Z'),
        endDate: new Date('2027-04-04T00:00:00.000Z'),
      },
    ]);
  });
});
