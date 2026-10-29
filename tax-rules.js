'use strict';

/* ======================================================================
 * Philippine tax rules used by the calculator.
 * Update this file when laws or rates change; the calculation code in
 * app.js reads everything from here. Users can also override the rates
 * in the "Tax rates" tab.
 * ==================================================================== */

const TAX_RULES_AS_OF = 'October 2026';

// Editable rates. Percentages are stored as whole numbers (12 = 12%).
const DEFAULT_RATES = {
  vatRate: 12,                 // NIRC Sec. 106 / 108
  vatThreshold: 3000000,       // NIRC Sec. 109(CC) & 236(G); EOPT allows CPI adjustment every 3 years
  percentageTax: 3,            // NIRC Sec. 116 (back to 3% from July 1, 2023)
  eightPercent: 8,             // NIRC Sec. 24(A)(2)(b)
  eightPercentExempt: 250000,  // not allowed for mixed-income earners
  osdRate: 40,                 // NIRC Sec. 34(L)
  rcitRate: 25,                // NIRC Sec. 27(A) as amended by CREATE
  rcitSmallRate: 20,
  rcitSmallIncomeCap: 5000000,
  rcitSmallAssetCap: 100000000,
  mcitRate: 2,                 // NIRC Sec. 27(E) (back to 2% from July 1, 2023)
  mcitStartYear: 4,
  sssTotal: 15,                // RA 11199 schedule, 2025
  sssEmployee: 5,
  sssMinMsc: 5000,
  sssMaxMsc: 35000,
  sssEcLow: 10,
  sssEcHigh: 30,
  sssEcCutoff: 15000,
  phRate: 5,                   // RA 11223 (Universal Health Care Act)
  phFloor: 10000,
  phCeiling: 100000,
  pagibigEeRate: 2,            // HDMF, max fund salary ₱10,000 from 2024
  pagibigErRate: 2,
  pagibigMaxBase: 10000,
};

// Graduated income tax for individuals, annual (NIRC Sec. 24(A)(2)(a), TRAIN schedule from Jan 1, 2023).
const GRADUATED_ANNUAL = [
  { over: 0, base: 0, rate: 0 },
  { over: 250000, base: 0, rate: 0.15 },
  { over: 400000, base: 22500, rate: 0.20 },
  { over: 800000, base: 102500, rate: 0.25 },
  { over: 2000000, base: 402500, rate: 0.30 },
  { over: 8000000, base: 2202500, rate: 0.35 },
];

// BIR withholding tax table on compensation, monthly (2023 onwards).
const WTAX_MONTHLY = [
  { over: 0, base: 0, rate: 0 },
  { over: 20833, base: 0, rate: 0.15 },
  { over: 33333, base: 1875, rate: 0.20 },
  { over: 66667, base: 8541.80, rate: 0.25 },
  { over: 166667, base: 33541.80, rate: 0.30 },
  { over: 666667, base: 183541.80, rate: 0.35 },
];

// Legal basis shown in the "Tax rates" tab.
const TAX_SOURCES = [
  ['VAT (12%), ₱3M registration threshold, input VAT and carry-over',
    'NIRC Secs. 105–110 and 236(G), as amended by TRAIN (RA 10963) and the Ease of Paying Taxes Act (RA 11976). VAT is filed quarterly on BIR Form 2550Q.'],
  ['Percentage tax (3%)',
    'NIRC Sec. 116. It was temporarily 1% under CREATE (RA 11534) from July 2020 to June 2023 and has been 3% since July 1, 2023. Filed quarterly on BIR Form 2551Q.'],
  ['8% income tax option',
    'NIRC Sec. 24(A)(2)(b)–(c); RR 8-2018; RMO 23-2018. For individuals only, non-VAT, gross sales and other non-operating income ≤ ₱3M, not subject to other percentage taxes. Elected in the first quarterly return and irrevocable for the year.'],
  ['Graduated income tax for individuals',
    'NIRC Sec. 24(A)(2)(a), TRAIN schedule effective January 1, 2023.'],
  ['Optional standard deduction (40%)',
    'NIRC Sec. 34(L); RR 16-2008. For individuals it is 40% of gross sales; for corporations, 40% of gross income.'],
  ['Corporate income tax (20% / 25%) and MCIT (2%)',
    'NIRC Sec. 27(A) and (E), as amended by CREATE (RA 11534). MCIT has been back at 2% since July 1, 2023.'],
  ['Withholding tax on compensation', 'RR 2-98 as amended by RR 11-2018; the 2023 withholding table.'],
  ['SSS, PhilHealth, Pag-IBIG', 'RA 11199 (SSS, 15% from 2025); RA 11223 (PhilHealth, 5%); HDMF circulars (Pag-IBIG, ₱10,000 maximum fund salary from 2024).'],
];
