import {
  countWorkingDays,
  endDateForWorkingDays,
  expandHolidayDateKeys,
} from './working-days';

describe('working days', () => {
  it('excludes weekends and public holidays', () => {
    expect(
      countWorkingDays(
        new Date('2026-05-18T00:00:00.000Z'),
        new Date('2026-05-25T00:00:00.000Z'),
        [{ date: new Date('2026-05-20T00:00:00.000Z') }],
      ),
    ).toBe(5);
  });

  it('applies recurring holidays to every covered year', () => {
    const keys = expandHolidayDateKeys(
      [{ date: new Date('2020-01-01T00:00:00.000Z'), recurring: true }],
      new Date('2025-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z'),
    );

    expect([...keys]).toEqual(['2025-01-01', '2026-01-01']);
  });

  it('extends an inclusive working-day period around holidays and weekends', () => {
    const endDate = endDateForWorkingDays(
      new Date('2026-12-24T00:00:00.000Z'),
      2,
      [{ date: new Date('2026-12-25T00:00:00.000Z') }],
    );

    expect(endDate.toISOString().slice(0, 10)).toBe('2026-12-28');
  });
});
