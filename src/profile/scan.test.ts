import { describe, expect, it } from 'vitest';
import { parseScanText } from './scan';

// The layout of a Styku summary report, with made-up numbers and no personal details.
const report = [
  [
    'Summary Report',
    'Basic Info A PERSON',
    'Full Name A Person Body Fat % 15.0%',
    'Age 30 Fat Mass 25.0 lbs',
    'Gender Male Fat-Free Mass 150.0 lbs',
    'Height & Weight 5 ft 10 in & 175.0 lbs Your body fat % rank is Fit',
    'Email someone@example.com',
    'Scan Date 3/7/2024 9:15:00 AM BMR 1800 Calories/day',
    'Location SOME GYM Health Risks 0% higher than ideal',
  ],
  [
    'Summary Report',
    '3D Scan and Measurements A PERSON',
    'Body Measurements (lbs, in)',
    'Body Fat % 15.0',
    'Fat-Free Mass % 85.0',
    'Fat Mass 25.0',
    'Fat-Free Mass 150.0',
    'Bicep Left Lower 12.0',
    'Bicep Left 14.0',
    'Bicep Right 14.2',
    'Calf Left 15.0',
    'Calf Right 15.1',
    'Chest 42.0',
    'Forearm Left 11.5',
    'Forearm Right 11.6',
    'High Hip 36.0',
    'Hip 39.0',
    'Neck 16.0',
    'Mid-Thigh Left 23.0',
    'Mid-Thigh Right 23.2',
    'Thigh Left Upper 25.0',
    'Waist (Abdominal) 33.0',
    'Waist (Lower) 34.0',
    'Waist (Narrowest) 32.0',
  ],
  ['Summary Report', 'Full Body Posture A PERSON', 'Silhouette Profile'],
];

describe('body scan reports', () => {
  it('reads the measurements into the profile’s units', () => {
    const r = parseScanText(report)!;
    expect(r.units).toBe('imperial');
    expect(new Date(r.date!)).toEqual(new Date(2024, 2, 7, 9, 15, 0));
    expect(r.values).toEqual({
      bodyFat: 15,
      armL: 35.6,
      armR: 36.1,
      calfL: 38.1,
      calfR: 38.4,
      chest: 106.7,
      forearmL: 29.2,
      forearmR: 29.5,
      hips: 99.1,
      neck: 40.6,
      thighL: 58.4,
      thighR: 58.9,
      waist: 83.8,
      height: 177.8,
      weight: 79.4,
    });
    expect(r.extra['Fat Mass']).toEqual({ label: 'Fat Mass', value: 11.3, unit: 'kg' });
    expect(r.extra['Fat-Free Mass %']).toEqual({ label: 'Fat-Free Mass %', value: 85, unit: '%' });
    expect(r.extra['High Hip']).toEqual({ label: 'High Hip', value: 91.4, unit: 'cm' });
    expect(r.extra['Waist (Narrowest)'].value).toBe(81.3);
    expect(r.extra.BMR).toEqual({ label: 'BMR', value: 1800, unit: 'kcal/day' });
    expect(r.warnings).toEqual([]);
  });

  it('keeps no personal details', () => {
    const r = JSON.stringify(parseScanText(report));
    for (const s of ['Person', 'PERSON', 'example.com', 'GYM']) expect(r).not.toContain(s);
  });

  it('leaves out impossible values and reports them', () => {
    const r = parseScanText([report[0], report[1].map((l) => (l.startsWith('Neck') ? 'Neck 160.0' : l))])!;
    expect(r.values.neck).toBeUndefined();
    expect(r.warnings[0]).toMatch(/Neck/);
  });

  it('reads metric reports and ignores other PDFs', () => {
    const metric = parseScanText([['Height & Weight 178 cm & 80 kg', 'Body Measurements (kg, cm)', 'Chest 106.0', 'Hip 99.0', 'Neck 40.5']])!;
    expect(metric.units).toBe('metric');
    expect(metric.values).toMatchObject({ chest: 106, hips: 99, neck: 40.5, height: 178, weight: 80 });
    expect(parseScanText([['Invoice', 'Total 42.00', 'Thank you']])).toBeNull();
  });
});
