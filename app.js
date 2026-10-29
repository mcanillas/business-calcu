'use strict';

/* ======================================================================
 * PH Business Calculator
 * All user inputs are monthly; annual = monthly x 12.
 * ==================================================================== */

const STORAGE_KEY = 'phBizCalc.v1';

// Rates, tax tables and legal sources live in tax-rules.js (loaded before this file).

const RATE_GROUPS = [
  ['VAT & percentage tax', [
    ['vatRate', 'VAT rate (%)'],
    ['vatThreshold', 'VAT threshold (₱ gross sales / year)'],
    ['percentageTax', 'Percentage tax, non-VAT (%)'],
  ]],
  ['Income tax', [
    ['eightPercent', '8% option rate (%)'],
    ['eightPercentExempt', '8% option exempt amount (₱ / year)'],
    ['osdRate', 'Optional standard deduction (%)'],
    ['rcitRate', 'Corporate income tax, regular (%)'],
    ['rcitSmallRate', 'Corporate income tax, small (%)'],
    ['rcitSmallIncomeCap', 'Small corp: max net taxable income (₱)'],
    ['rcitSmallAssetCap', 'Small corp: max total assets (₱)'],
    ['mcitRate', 'MCIT on gross income (%)'],
    ['mcitStartYear', 'MCIT starts on year no.'],
  ]],
  ['SSS', [
    ['sssTotal', 'Total contribution (%)'],
    ['sssEmployee', 'Employee share (%)'],
    ['sssMinMsc', 'Minimum monthly salary credit (₱)'],
    ['sssMaxMsc', 'Maximum monthly salary credit (₱)'],
    ['sssEcLow', 'EC, employer (₱) below cutoff'],
    ['sssEcHigh', 'EC, employer (₱) at/above cutoff'],
    ['sssEcCutoff', 'EC cutoff MSC (₱)'],
  ]],
  ['PhilHealth & Pag-IBIG', [
    ['phRate', 'PhilHealth premium, total (%)'],
    ['phFloor', 'PhilHealth salary floor (₱)'],
    ['phCeiling', 'PhilHealth salary ceiling (₱)'],
    ['pagibigEeRate', 'Pag-IBIG employee (%)'],
    ['pagibigErRate', 'Pag-IBIG employer (%)'],
    ['pagibigMaxBase', 'Pag-IBIG max fund salary (₱)'],
  ]],
];

/* ---------------- helpers ---------------- */

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const fmt = n => peso.format(Number.isFinite(n) ? n : 0);
const fmtSigned = n => (n < 0 ? '(' + fmt(-n) + ')' : fmt(n || 0)); // n || 0 avoids "-₱0.00"
const pctFmt = n => (Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : '—');
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const pct = v => num(v) / 100;
const sum = (arr, fn) => arr.reduce((t, x) => t + fn(x), 0);
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = sel => document.querySelector(sel);

// The bracket of a graduated table that an income falls into
function bracketOf(income, table) {
  let found = table[0];
  for (const b of table) if (income > b.over) found = b;
  return found;
}

function bracketTax(income, table) {
  const b = bracketOf(income, table);
  return Math.max(0, b.base + (income - b.over) * b.rate);
}

// VAT, one formula per direction so VAT is never added twice:
// VAT-exclusive amount: VAT = net × rate, total = net + VAT
const vatOnTop = (net, rate) => ({ net, vat: net * rate, gross: net * (1 + rate) });
// VAT-inclusive amount: net = total ÷ (1 + rate), VAT = total − net
function vatInside(gross, rate) {
  const net = gross / (1 + rate);
  return { net, vat: gross - net, gross };
}

/* ---------------- state ---------------- */

const round2 = n => Math.round(n * 100) / 100;

function newIngredient(fields = {}) {
  return { name: '', buyPrice: 0, buyQty: 1, unit: '', useQty: 0, ...fields };
}

function newProduct(fields = {}) {
  const p = { name: '', cost: 0, costHasVat: false, price: 0, qty: 0, targetMargin: 30, batchYield: 1, scaleYield: true, ...fields };
  p.ingredients = Array.isArray(fields.ingredients) ? fields.ingredients.map(g => newIngredient(g)) : [];
  if (p.ingredients.length) p.cost = recipeUnitCost(p);
  return p;
}

// Cost of the amount of one ingredient used in a batch
const ingredientCost = g => (num(g.buyQty) > 0 ? (num(g.buyPrice) / num(g.buyQty)) * num(g.useQty) : 0);
const batchYield = p => (num(p.batchYield) > 0 ? num(p.batchYield) : 1);
const recipeUnitCost = p => sum(p.ingredients, ingredientCost) / batchYield(p);

function newEmployee(fields = {}) {
  const emp = { name: '', position: '', daily: 0, workDays: 26, basic: 0, allowance: 0, govContrib: true, withTax: true, ...fields };
  // Older saved data has no daily rate: derive it from the monthly salary
  if (fields.daily === undefined && num(emp.workDays) > 0) emp.daily = round2(num(emp.basic) / num(emp.workDays));
  return emp;
}

function defaultState() {
  return {
    setup: {
      businessName: '',
      type: 'sole',
      vatStatus: 'auto',
      salesTreatment: 'regular',
      taxOption: 'graduated',
      mixedIncome: false,
      pricesIncludeVat: true,
      totalAssets: 0,
      yearsOperating: 1,
      // Credits and payments already made this year
      vatCarryOver: 0,
      vatWithheld: 0,
      itCwt: 0,
      itPaid: 0,
    },
    products: [
      newProduct({
        name: 'Ube cupcake (sample recipe)', price: 35, qty: 2000, batchYield: 24,
        ingredients: [
          { name: 'Flour', buyPrice: 70, buyQty: 1000, unit: 'g', useQty: 500 },
          { name: 'Sugar', buyPrice: 90, buyQty: 1000, unit: 'g', useQty: 300 },
          { name: 'Eggs', buyPrice: 270, buyQty: 30, unit: 'pc', useQty: 4 },
          { name: 'Butter', buyPrice: 120, buyQty: 225, unit: 'g', useQty: 225 },
          { name: 'Ube halaya', buyPrice: 250, buyQty: 500, unit: 'g', useQty: 250 },
          { name: 'Cupcake liners', buyPrice: 80, buyQty: 100, unit: 'pc', useQty: 24 },
        ],
      }),
      newProduct({ name: 'Sample item B', cost: 250, price: 350, qty: 120 }),
    ],
    expenses: [
      { name: 'Rent', amount: 15000, hasVat: false },
      { name: 'Electricity', amount: 5000, hasVat: true },
      { name: 'Water', amount: 800, hasVat: true },
      { name: 'Internet / phone', amount: 1500, hasVat: true },
      { name: "Business permits & licenses (monthly share)", amount: 1000, hasVat: false },
      { name: 'Supplies & packaging', amount: 2000, hasVat: false },
    ],
    staff: [
      newEmployee({ name: 'Staff 1', position: 'Sales clerk', daily: 650, basic: 16900 }),
    ],
    rates: { ...DEFAULT_RATES },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* storage unavailable or corrupt: fall back to defaults */ }
  return defaultState();
}

function normalize(data) {
  const d = defaultState();
  return {
    setup: { ...d.setup, ...(data.setup || {}) },
    products: Array.isArray(data.products) ? data.products.map(p => newProduct(p)) : d.products,
    expenses: Array.isArray(data.expenses) ? data.expenses : d.expenses,
    staff: Array.isArray(data.staff) ? data.staff.map(newEmployee) : d.staff,
    rates: { ...DEFAULT_RATES, ...(data.rates || {}) },
  };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

let state = loadState();

/* ---------------- calculations ---------------- */

function computePayroll(emp, r) {
  const basic = num(emp.basic);
  const allowance = num(emp.allowance);
  const zero = { basic, allowance, sssEe: 0, phEe: 0, piEe: 0, wtax: 0, deductions: 0, net: basic + allowance,
    sssEr: 0, phEr: 0, piEr: 0, erTotal: 0, thirteenth: 0, cost: basic + allowance, taxable: 0 };
  if (basic <= 0) return zero;

  let sssEe = 0, sssEr = 0, phEe = 0, phEr = 0, piEe = 0, piEr = 0;
  if (emp.govContrib !== false) {
    // SSS: monthly salary credit in ₱500 steps
    const msc = clamp(Math.floor((basic + 250) / 500) * 500, num(r.sssMinMsc), num(r.sssMaxMsc));
    const ec = msc < num(r.sssEcCutoff) ? num(r.sssEcLow) : num(r.sssEcHigh);
    sssEe = msc * pct(r.sssEmployee);
    sssEr = msc * (pct(r.sssTotal) - pct(r.sssEmployee)) + ec;

    // PhilHealth: total premium split 50/50
    const phBase = clamp(basic, num(r.phFloor), num(r.phCeiling));
    phEe = (phBase * pct(r.phRate)) / 2;
    phEr = phEe;

    // Pag-IBIG: 1% employee share if salary is ₱1,500 or less
    const piBase = Math.min(basic, num(r.pagibigMaxBase));
    piEe = piBase * (basic <= 1500 ? 0.01 : pct(r.pagibigEeRate));
    piEr = piBase * pct(r.pagibigErRate);
  }

  const taxable = Math.max(0, basic - sssEe - phEe - piEe);
  const wtax = emp.withTax !== false ? bracketTax(taxable, WTAX_MONTHLY) : 0;
  const deductions = sssEe + phEe + piEe + wtax;
  const erTotal = sssEr + phEr + piEr;
  const thirteenth = basic / 12;

  return {
    basic, allowance, sssEe, phEe, piEe, wtax, deductions,
    net: basic + allowance - deductions,
    sssEr, phEr, piEr, erTotal, thirteenth, taxable,
    cost: basic + allowance + erTotal + thirteenth,
  };
}

function compute(s) {
  const r = s.rates;
  const setup = s.setup;
  const vatR = pct(r.vatRate);
  const warnings = [];

  const threshold = num(r.vatThreshold);
  const treatment = setup.salesTreatment || 'regular';

  // VAT status. Only VATable sales count toward the ₱3M threshold.
  const rawSalesY = sum(s.products, p => num(p.price) * num(p.qty)) * 12;
  const autoVat = treatment === 'regular' && rawSalesY > threshold;
  const vatRegistered = setup.vatStatus === 'vat' || (setup.vatStatus === 'auto' && autoVat);
  // Output VAT (and creditable input VAT) only for VAT-registered sellers of VATable goods/services
  const isVat = vatRegistered && treatment === 'regular';
  const incl = !!setup.pricesIncludeVat;

  // Items
  const items = s.products.map(p => {
    const price = num(p.price), cost = num(p.cost), qty = num(p.qty);
    const sale = !isVat ? { net: price, vat: 0, gross: price } : incl ? vatInside(price, vatR) : vatOnTop(price, vatR);
    const netPrice = sale.net;
    const outVat = sale.vat;
    const costVat = isVat && p.costHasVat;
    const purchase = costVat ? vatInside(cost, vatR) : { net: cost, vat: 0 };
    const netCost = purchase.net;
    const inVat = purchase.vat;
    // Suggested price: net price that gives the target margin, in the same VAT convention as the price input
    const m = pct(p.targetMargin);
    const sugNet = m < 1 ? netCost / (1 - m) : NaN;
    // Round up to the centavo (after trimming floating-point noise)
    const suggested = Math.ceil(Math.round((isVat && incl ? sugNet * (1 + vatR) : sugNet) * 1e6) / 1e4) / 100;
    return {
      netPrice, netCost, qty, suggested, sale,
      sales: netPrice * qty,
      cogs: netCost * qty,
      outputVat: outVat * qty,
      inputVat: inVat * qty,
      profitUnit: netPrice - netCost,
      margin: netPrice ? (netPrice - netCost) / netPrice : NaN,
    };
  });

  // Expenses
  const exps = s.expenses.map(e => {
    const amt = num(e.amount);
    const bill = isVat && e.hasVat ? vatInside(amt, vatR) : { net: amt, vat: 0 };
    return { net: bill.net, inputVat: bill.vat };
  });

  // Payroll
  const pay = s.staff.map(e => computePayroll(e, r));

  const M = {};
  M.sales = sum(items, i => i.sales);
  M.cogs = sum(items, i => i.cogs);
  M.grossProfit = M.sales - M.cogs;
  M.opex = sum(exps, e => e.net);
  M.salaries = sum(pay, p => p.basic + p.allowance);
  M.employerContrib = sum(pay, p => p.erTotal);
  M.thirteenth = sum(pay, p => p.thirteenth);
  M.outputVat = sum(items, i => i.outputVat);
  M.inputVat = sum(items, i => i.inputVat) + sum(exps, e => e.inputVat);
  M.vatPayable = Math.max(0, M.outputVat - M.inputVat);
  M.wtax = sum(pay, p => p.wtax);
  M.sssTotal = sum(pay, p => p.sssEe + p.sssEr);
  M.phTotal = sum(pay, p => p.phEe + p.phEr);
  M.piTotal = sum(pay, p => p.piEe + p.piEr);

  const salesY = M.sales * 12;
  const grossIncomeY = M.grossProfit * 12;
  const isSole = setup.type === 'sole';
  const mixed = isSole && !!setup.mixedIncome;

  // ---- 8% option eligibility (NIRC Sec. 24(A)(2)(b); RR 8-2018) ----
  let option = setup.taxOption;
  if (option === 'eight') {
    let reason = '';
    if (!isSole) reason = 'it is only for individuals (sole proprietors and self-employed), not corporations';
    else if (vatRegistered) reason = 'VAT-registered taxpayers cannot use it';
    else if (treatment === 'other') reason = 'businesses subject to other percentage taxes (NIRC Sec. 117–128) cannot use it';
    else if (salesY > threshold) reason = `gross sales (${fmt(salesY)}/yr) are over the ${fmt(threshold)} limit`;
    if (reason) {
      warnings.push(`The 8% option does not apply because ${reason}. ${isSole ? 'Graduated rates were' : 'Regular corporate income tax was'} used instead.`);
      option = 'graduated';
    }
  }

  // ---- Percentage tax (NIRC Sec. 116) ----
  const ptRateTxt = `${num(r.percentageTax)}%`;
  const pt = { applies: false, unknown: false, amountY: 0, formula: `Percentage tax = Gross sales × ${ptRateTxt}` };
  if (isVat) {
    pt.reason = 'You are VAT-registered, so you pay VAT instead of percentage tax. A business pays one or the other, never both, on the same sales.';
  } else if (treatment === 'exempt') {
    pt.reason = 'Your sales are VAT-exempt under NIRC Sec. 109 because of what you sell (for example, unprocessed agricultural or marine food), not because of the ₱3M threshold. The 3% percentage tax under Sec. 116 covers only sellers who are non-VAT because of the threshold, so it does not apply to you.';
  } else if (treatment === 'other') {
    pt.unknown = true;
    pt.reason = 'Your business is under other percentage taxes (NIRC Sec. 117–128), such as those for transport carriers, franchise holders or amusement places. These have their own rates and bases, which this calculator does not compute.';
    warnings.push('Your percentage tax could not be computed: other percentage taxes (NIRC Sec. 117–128) have their own rates. Check the rate for your business with the BIR or an accountant.');
  } else if (option === 'eight') {
    pt.reason = 'You chose the 8% income tax option. The 8% tax replaces both the graduated income tax and the 3% percentage tax, so no separate percentage tax is due.';
  } else {
    pt.applies = true;
    pt.amountY = salesY * pct(r.percentageTax);
    pt.reason = `You are not VAT-registered, you sell regular (VATable) goods or services, and you are not on the 8% option. Under NIRC Sec. 116, you pay ${ptRateTxt} of your gross sales every quarter.`;
  }
  M.percentageTax = pt.amountY / 12;

  M.totalExpenses = M.opex + M.salaries + M.employerContrib + M.thirteenth + M.percentageTax;
  M.netBeforeTax = M.grossProfit - M.totalExpenses;

  // ---- Income tax (annual) ----
  const cogsY = M.cogs * 12, opexY = M.opex * 12, ptY = pt.amountY;
  const payrollY = (M.salaries + M.employerContrib + M.thirteenth) * 12;
  const it = { steps: [], insufficient: false };
  const bracketStep = taxable => {
    const b = bracketOf(taxable, GRADUATED_ANNUAL);
    return b.rate === 0
      ? [`Tax: taxable income is ₱250,000 or less, which is exempt`, 0]
      : [`Tax: ${fmt(b.base)} + ${b.rate * 100}% × (${fmt(taxable)} − ${fmt(b.over)})`, bracketTax(taxable, GRADUATED_ANNUAL)];
  };
  const itemizedSteps = () => [
    ['Gross sales (excluding VAT)', salesY],
    ['Less: cost of goods sold', -cogsY],
    ['Less: operating expenses', -opexY],
    ['Less: salaries, employer contributions & 13th month', -payrollY],
    ...(ptY ? [['Less: percentage tax', -ptY]] : []),
  ];

  if (isSole && option === 'eight') {
    const exempt = mixed ? 0 : num(r.eightPercentExempt);
    it.regime = 'eight';
    it.label = `Income tax, ${num(r.eightPercent)}% option`;
    it.why = `You are a sole proprietor, not VAT-registered, with gross sales of ${fmt(salesY)} a year, which is within the ${fmt(threshold)} limit, and you chose the 8% option. In this case the law (NIRC Sec. 24(A)(2)(b)) bases the tax on gross sales, not on profit. It replaces both the graduated income tax and the 3% percentage tax. You must choose it in your first quarterly return (BIR Form 1701Q), and you cannot change it for the rest of the year.`
      + (mixed ? ' Because you also earn a salary, the ₱250,000 deduction is not allowed. It is already used up by your salary income.' : '');
    it.formula = mixed
      ? `Income tax = Gross sales × ${num(r.eightPercent)}%   (no ₱250,000 deduction for mixed-income earners)`
      : `Income tax = (Gross sales − ₱250,000) × ${num(r.eightPercent)}%`;
    it.deductions = null; // business expenses are not deductible under the 8% option
    it.taxable = Math.max(0, salesY - exempt);
    it.tax = it.taxable * pct(r.eightPercent);
    it.steps = [
      ['Gross sales', salesY],
      ...(exempt ? [['Less: exempt amount', -exempt]] : []),
      ['Tax base', it.taxable],
      [`Tax: ${fmt(it.taxable)} × ${num(r.eightPercent)}%`, it.tax],
    ];
  } else if (isSole) {
    const osd = option === 'osd';
    const raw = osd ? salesY * (1 - pct(r.osdRate)) : salesY - cogsY - opexY - payrollY - ptY;
    it.regime = osd ? 'osd' : 'itemized';
    it.deductions = salesY - raw;
    it.taxable = Math.max(0, raw);
    it.tax = bracketTax(it.taxable, GRADUATED_ANNUAL);
    it.label = osd ? 'Income tax, graduated rates (40% OSD)' : 'Income tax, graduated rates (itemized)';
    it.why = 'You are a sole proprietor not on the 8% option, so your income tax uses the graduated rates for individuals (NIRC Sec. 24(A)(2)(a)), applied to your taxable income (not to gross sales).'
      + (osd
        ? ` With the Optional Standard Deduction, you deduct a flat ${num(r.osdRate)}% of gross sales instead of your actual costs. Cost of goods sold is not deducted separately, and you don't need receipts to support expenses.`
        : ' With itemized deductions, you subtract your actual business costs. Keep the invoices and receipts that support them.');
    it.formula = (osd ? `Taxable income = Gross sales − (Gross sales × ${num(r.osdRate)}%)` : 'Taxable income = Gross sales − Cost of goods sold − Allowable business expenses')
      + '\nIncome tax = Base tax of bracket + Rate × (Taxable income − Bracket floor)';
    it.steps = [
      ...(osd ? [['Gross sales (excluding VAT)', salesY], [`Less: OSD, ${num(r.osdRate)}% of gross sales`, -it.deductions]] : itemizedSteps()),
      ['Taxable income', raw],
      bracketStep(it.taxable),
    ];
    if (raw < 0) it.note = 'No income tax: the business has a net loss. Under itemized deductions, a net operating loss can be carried over to the next 3 years (NOLCO).';
    if (mixed) {
      it.insufficient = true;
      warnings.push('You also earn a salary. Under graduated rates, your salary and business income are taxed together. This calculator includes only your business income, so your actual income tax may be higher.');
    }
  } else {
    const osd = option === 'osd';
    const raw = osd ? grossIncomeY * (1 - pct(r.osdRate)) : salesY - cogsY - opexY - payrollY - ptY;
    const taxable = Math.max(0, raw);
    const assets = num(setup.totalAssets);
    const small = taxable <= num(r.rcitSmallIncomeCap) && assets <= num(r.rcitSmallAssetCap);
    const rate = small ? pct(r.rcitSmallRate) : pct(r.rcitRate);
    const rcit = taxable * rate;
    const mcitApplies = num(setup.yearsOperating) >= num(r.mcitStartYear);
    const mcit = mcitApplies ? Math.max(0, grossIncomeY) * pct(r.mcitRate) : 0;
    it.regime = osd ? 'corp-osd' : 'corp';
    it.deductions = salesY - raw;
    it.taxable = taxable;
    it.tax = Math.max(rcit, mcit);
    it.label = mcit > rcit ? `Income tax, MCIT ${num(r.mcitRate)}% of gross income` : `Corporate income tax, ${rate * 100}%${osd ? ' (40% OSD)' : ''}`;
    it.why = `Corporations pay income tax on taxable income (NIRC Sec. 27(A), as amended by CREATE). The rate is ${num(r.rcitSmallRate)}% if net taxable income is ${fmt(num(r.rcitSmallIncomeCap))} or less and total assets, excluding land, are ${fmt(num(r.rcitSmallAssetCap))} or less. Otherwise it is ${num(r.rcitRate)}%. Your rate is ${rate * 100}%.`
      + (mcitApplies
        ? ` Starting from the ${num(r.mcitStartYear)}th year of operations, the Minimum Corporate Income Tax (${num(r.mcitRate)}% of gross income) is compared with the regular tax, and you pay whichever is higher.`
        : ` MCIT does not apply yet because it starts in the ${num(r.mcitStartYear)}th year of operations.`)
      + (osd ? ` With OSD, a corporation deducts ${num(r.osdRate)}% of gross income (sales minus cost of sales) instead of its actual expenses.` : '');
    it.formula = (osd ? `Taxable income = Gross income − (Gross income × ${num(r.osdRate)}%), where Gross income = Sales − Cost of sales` : 'Taxable income = Gross sales − Cost of goods sold − Allowable business expenses')
      + `\nRegular income tax = Taxable income × ${rate * 100}%`
      + (mcitApplies ? `\nMCIT = Gross income × ${num(r.mcitRate)}%  →  pay the higher of the two` : '');
    it.steps = [
      ...(osd
        ? [['Gross sales (excluding VAT)', salesY], ['Less: cost of goods sold', -cogsY], ['Gross income', grossIncomeY], [`Less: OSD, ${num(r.osdRate)}% of gross income`, -grossIncomeY * pct(r.osdRate)]]
        : itemizedSteps()),
      ['Taxable income', raw],
      [`Regular tax: ${fmt(taxable)} × ${rate * 100}%`, rcit],
      ...(mcitApplies ? [[`MCIT: ${fmt(Math.max(0, grossIncomeY))} × ${num(r.mcitRate)}%`, mcit], ['Income tax due (the higher amount)', it.tax]] : []),
    ];
    if (assets <= 0) {
      it.insufficient = true;
      warnings.push('Total assets are not entered, so the 20% corporate rate was assumed. Enter total assets in Business setup to confirm which rate applies.');
    }
  }

  // Tax credits and previous payments (reduce what is still payable; they are not expenses)
  it.cwt = num(setup.itCwt);
  it.paid = num(setup.itPaid);
  it.credits = it.cwt + it.paid;
  it.remaining = Math.max(0, it.tax - it.credits);
  it.overpaid = Math.max(0, it.credits - it.tax);
  it.form = isSole ? 'BIR Form 1701Q (quarterly) and 1701 or 1701A (annual)' : 'BIR Form 1702Q (quarterly) and 1702 (annual)';

  M.incomeTax = it.tax / 12;
  M.netProfit = M.netBeforeTax - M.incomeTax;

  // ---- VAT (annual view; filed quarterly on BIR Form 2550Q) ----
  const vat = { applies: isVat };
  vat.salesExclY = salesY;
  vat.outputY = M.outputVat * 12;
  vat.grossY = salesY + vat.outputY;
  vat.inputY = M.inputVat * 12;
  vat.carryOver = isVat ? num(setup.vatCarryOver) : 0;
  vat.withheld = isVat ? num(setup.vatWithheld) : 0;
  const vatNet = vat.outputY - vat.inputY - vat.carryOver - vat.withheld;
  vat.payableY = Math.max(0, vatNet);
  vat.excessY = Math.max(0, -vatNet);
  if (isVat) {
    vat.reason = (setup.vatStatus === 'auto'
      ? `Your projected sales (${fmt(rawSalesY)}/yr) are over the ${fmt(threshold)} threshold, so VAT registration is required (NIRC Sec. 236(G)).`
      : 'You are VAT-registered.')
      + ` You add ${num(r.vatRate)}% VAT to your VATable sales (output VAT) and may subtract creditable input VAT from your purchases.`;
  } else if (treatment === 'exempt') {
    vat.reason = 'Your goods or services are VAT-exempt under NIRC Sec. 109, so you do not charge VAT. Any VAT you pay on purchases is part of your cost and cannot be credited.';
  } else if (treatment === 'other') {
    vat.reason = 'Your business is under other percentage taxes instead of VAT, so no VAT is computed.';
  } else {
    vat.reason = `You are not VAT-registered, and your sales are within the ${fmt(threshold)} threshold, so you do not charge VAT. Do not show VAT on your invoices. VAT you pay to suppliers is part of your cost.`;
  }

  M.taxesY = vat.payableY + pt.amountY + it.tax;
  M.remainingY = vat.payableY + pt.amountY + it.remaining;

  M.remitTotal = M.vatPayable + M.percentageTax + M.incomeTax + M.wtax + M.sssTotal + M.phTotal + M.piTotal;

  // Break-even sales (monthly) = fixed costs / gross margin ratio
  const gmRatio = M.sales ? M.grossProfit / M.sales : 0;
  const fixed = M.opex + M.salaries + M.employerContrib + M.thirteenth;
  M.breakEven = gmRatio > 0 ? fixed / (gmRatio - (M.percentageTax ? pct(r.percentageTax) : 0)) : NaN;

  // Warnings
  if (setup.vatStatus === 'nonvat' && treatment === 'regular' && rawSalesY > threshold) {
    warnings.push(`Your projected annual sales (${fmt(rawSalesY)}) are over the ₱3M VAT threshold. You must register for VAT, or you'll face penalties.`);
  }
  if (setup.vatStatus === 'auto' && isVat) {
    warnings.push('Projected annual sales are over ₱3M, so you are treated as VAT-registered (12%).');
  }
  if (vatRegistered && !isVat) {
    warnings.push('You are marked as VAT-registered, but your sales are VAT-exempt or under other percentage taxes. No output VAT is computed, and input VAT is treated as part of your cost, because input VAT on exempt sales is not creditable.');
  }
  if (vat.excessY > 0) {
    warnings.push(`Your creditable input VAT and VAT credits are higher than your output VAT by ${fmt(vat.excessY)} a year. The excess carries over to the next quarter. It is not refunded in cash, except input VAT on zero-rated sales.`);
  }
  if (it.overpaid > 0) {
    warnings.push(`Your income tax credits and payments are ${fmt(it.overpaid)} more than the estimated income tax. You may choose a refund or a tax credit, or carry it over, in your annual return.`);
  }
  s.products.forEach((p, i) => {
    if (num(p.price) > 0 && items[i].profitUnit < 0) {
      warnings.push(`“${p.name || 'Item ' + (i + 1)}” sells below cost (loss of ${fmt(-items[i].profitUnit)} per unit).`);
    }
  });
  if (M.netProfit < 0) warnings.push('The business is operating at a loss with the current numbers.');

  return { isVat, vatRegistered, treatment, autoVat, option, items, exps, pay, M, vat, pt, it, warnings, isSole };
}

/* ---------------- rendering ---------------- */

function renderSetup() {
  document.querySelectorAll('[data-setup]').forEach(el => {
    const v = state.setup[el.dataset.setup];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  const isCorp = state.setup.type === 'corp';
  document.querySelectorAll('[data-corp-only]').forEach(el => { el.style.display = isCorp ? '' : 'none'; });
  const eightOpt = document.querySelector('[data-sole-only]');
  eightOpt.disabled = isCorp;
  document.querySelectorAll('[data-sole-field]').forEach(el => { el.style.display = isCorp ? 'none' : ''; });
}

function inputCell(list, i, field, value, type = 'number') {
  if (type === 'checkbox') {
    return `<td class="center"><input type="checkbox" data-list="${list}" data-i="${i}" data-field="${field}" ${value ? 'checked' : ''}></td>`;
  }
  const attrs = type === 'number' ? 'min="0" step="any"' : '';
  return `<td><input type="${type}" ${attrs} data-list="${list}" data-i="${i}" data-field="${field}" value="${esc(value)}"></td>`;
}

const removeCell = (list, i) => `<td><button type="button" class="remove" data-remove="${list}" data-i="${i}" title="Remove">✕</button></td>`;
const calcCell = (id) => `<td class="num" id="${id}"></td>`;

// Products whose recipe panel is expanded (by index)
let openRecipes = new Set();

function ingredientCell(pi, j, field, value, type = 'number', placeholder = '') {
  const attrs = type === 'number' ? 'min="0" step="any"' : `placeholder="${placeholder}"`;
  return `<td><input type="${type}" ${attrs} data-ing="${pi}" data-i="${j}" data-field="${field}" value="${esc(value)}"></td>`;
}

// Scale every ingredient (and optionally the yield) by the same factor
function scaleRecipe(i, factor) {
  const p = state.products[i];
  if (!Number.isFinite(factor) || factor <= 0) return;
  p.ingredients.forEach(g => { g.useQty = Math.round(num(g.useQty) * factor * 10000) / 10000; });
  if (p.scaleYield !== false) p.batchYield = round2(batchYield(p) * factor);
  syncRecipeCost(i);
  lastScale = { i, text: `Recipe changed ×${round2(factor)}: all ingredients${p.scaleYield !== false ? ' and pieces made' : ''} adjusted.` };
  renderTables();
  refresh();
}

let lastScale = null;

const ingredientLabel = (g, j) => g.name || `Ingredient ${j + 1}`;

function scaleBox(p, i) {
  let msg = '';
  if (lastScale && lastScale.i === i) {
    msg = `<p class="scale-msg">✓ ${esc(lastScale.text)}</p>`;
    lastScale = null; // show once
  }
  return `<div class="scale-box">
      <h4>Adjust the whole recipe</h4>
      <p class="hint">The first ingredient in the list is your main ingredient (for example beef). Change its amount, and every other ingredient changes in the same proportion.</p>
      <div class="scale-row">
        <span>Main ingredient: <strong id="p${i}-scalecur"></strong> → new amount</span>
        <input type="number" min="0" step="any" data-scale-to="${i}" placeholder="new amount" aria-label="New amount">
        <button type="button" data-scale-apply="${i}">Apply</button>
      </div>
      <div class="scale-row">
        <span>Quick:</span>
        <button type="button" class="small" data-scale-factor="0.5" data-p="${i}">½×</button>
        <button type="button" class="small" data-scale-factor="2" data-p="${i}">2×</button>
        <button type="button" class="small" data-scale-factor="3" data-p="${i}">3×</button>
        <label class="check-inline"><input type="checkbox" data-scale-yield="${i}" ${p.scaleYield !== false ? 'checked' : ''}>
          Also change the number of pieces / servings made</label>
      </div>
      ${msg}
    </div>`;
}

function recipeRow(p, i) {
  const rows = p.ingredients.map((g, j) => `<tr>
      ${ingredientCell(i, j, 'name', g.name, 'text', 'e.g. Flour')}
      ${ingredientCell(i, j, 'buyPrice', g.buyPrice)}
      ${ingredientCell(i, j, 'buyQty', g.buyQty)}
      ${ingredientCell(i, j, 'unit', g.unit, 'text', 'g, ml, pc')}
      ${ingredientCell(i, j, 'useQty', g.useQty)}
      ${calcCell(`p${i}-ing${j}`)}
      <td><button type="button" class="remove" data-remove-ing="${i}" data-i="${j}" title="Remove">✕</button></td>
    </tr>`).join('');
  return `<tr class="recipe-row"><td colspan="12"><div class="recipe">
      <h3>Recipe / ingredients: ${esc(p.name || 'this item')}</h3>
      <p class="hint">List everything that goes into one batch, including packaging (cups, boxes, labels). Use the same unit for purchase qty and qty used. For example, flour bought at ₱70 for 1,000 g, with 500 g used, costs ₱35 in the recipe.</p>
      <label class="inline">This recipe makes
        <input type="number" min="1" step="any" data-recipe-yield="${i}" value="${esc(p.batchYield)}"> pieces / servings</label>
      <div class="table-wrap"><table class="grid ingredients">
        <thead><tr><th>Ingredient / material</th><th>Purchase price (₱)</th><th>Purchase qty</th><th>Unit</th>
          <th>Qty used in recipe</th><th class="num">Cost in recipe</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <button type="button" class="add" data-add-ing="${i}">+ Add ingredient</button>
      ${p.ingredients.length ? scaleBox(p, i) : ''}
      <div class="recipe-summary" id="p${i}-rsum"></div>
    </div></td></tr>`;
}

function renderTables() {
  $('#products-body').innerHTML = state.products.map((p, i) => {
    const costCell = p.ingredients.length
      ? `<td><input type="number" readonly class="computed" data-recipe-cost="${i}" value="${round2(num(p.cost))}" title="Computed from the recipe"><div class="cell-note">from recipe</div></td>`
      : inputCell('products', i, 'cost', p.cost);
    const open = openRecipes.has(i);
    return `<tr>
      ${inputCell('products', i, 'name', p.name, 'text')}
      ${costCell}
      ${inputCell('products', i, 'costHasVat', p.costHasVat, 'checkbox')}
      ${inputCell('products', i, 'targetMargin', p.targetMargin)}
      <td class="num"><span id="p${i}-sugg"></span><button type="button" class="small" data-use-price="${i}" title="Use as selling price">Use</button></td>
      <td><input type="number" min="0" step="any" data-list="products" data-i="${i}" data-field="price" value="${esc(p.price)}"><div class="cell-note" id="p${i}-vatnote"></div></td>
      ${inputCell('products', i, 'qty', p.qty)}
      ${calcCell(`p${i}-unit`)}${calcCell(`p${i}-margin`)}${calcCell(`p${i}-sales`)}${calcCell(`p${i}-gp`)}
      <td class="actions"><button type="button" class="small" data-toggle-recipe="${i}">${open ? 'Hide recipe' : 'Recipe'}</button><button type="button" class="remove" data-remove="products" data-i="${i}" title="Remove">✕</button></td>
    </tr>${open ? recipeRow(p, i) : ''}`;
  }).join('');

  $('#expenses-body').innerHTML = state.expenses.map((e, i) => `<tr>
      ${inputCell('expenses', i, 'name', e.name, 'text')}
      ${inputCell('expenses', i, 'amount', e.amount)}
      ${inputCell('expenses', i, 'hasVat', e.hasVat, 'checkbox')}
      ${calcCell(`e${i}-net`)}${calcCell(`e${i}-vat`)}
      ${removeCell('expenses', i)}
    </tr>`).join('');

  $('#staff-body').innerHTML = state.staff.map((e, i) => `<tr>
      ${inputCell('staff', i, 'name', e.name, 'text')}
      ${inputCell('staff', i, 'position', e.position, 'text')}
      ${inputCell('staff', i, 'daily', e.daily)}
      ${inputCell('staff', i, 'workDays', e.workDays)}
      ${inputCell('staff', i, 'basic', e.basic)}
      ${inputCell('staff', i, 'allowance', e.allowance)}
      ${inputCell('staff', i, 'govContrib', e.govContrib, 'checkbox')}
      ${inputCell('staff', i, 'withTax', e.withTax, 'checkbox')}
      ${['sssEe', 'phEe', 'piEe', 'wtax', 'deductions', 'net', 'sssEr', 'phEr', 'piEr', 'thirteenth', 'cost'].map(k => calcCell(`s${i}-${k}`)).join('')}
      ${removeCell('staff', i)}
    </tr>`).join('');
}

function setText(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('profit', 'loss');
  if (cls) el.classList.add(cls);
}

const plCls = n => (n < 0 ? 'loss' : n > 0 ? 'profit' : '');

function renderCalculated(c) {
  const { M } = c;

  // Products
  c.items.forEach((it, i) => {
    setText(`p${i}-unit`, fmtSigned(it.profitUnit), plCls(it.profitUnit));
    setText(`p${i}-margin`, pctFmt(it.margin), plCls(it.profitUnit));
    setText(`p${i}-sales`, fmt(it.sales));
    setText(`p${i}-gp`, fmtSigned(it.sales - it.cogs), plCls(it.sales - it.cogs));
    setText(`p${i}-sugg`, Number.isFinite(it.suggested) ? fmt(it.suggested) : '—');
    // Show how the price splits into sales and VAT, so it is clear VAT is counted once
    setText(`p${i}-vatnote`, !c.isVat || !it.sale.gross ? ''
      : state.setup.pricesIncludeVat
        ? `= ${fmt(it.sale.net)} + ${fmt(it.sale.vat)} VAT`
        : `+ ${fmt(it.sale.vat)} VAT = ${fmt(it.sale.gross)}`);
    if (openRecipes.has(i)) renderRecipeSummary(state.products[i], it, i);
  });
  $('#products-foot').innerHTML = `<tr><td colspan="9">Total (net of VAT)</td>
    <td class="num">${fmt(M.sales)}</td><td class="num ${plCls(M.grossProfit)}">${fmtSigned(M.grossProfit)}</td><td></td></tr>`;
  $('#price-header').textContent = c.isVat
    ? (state.setup.pricesIncludeVat ? 'Selling price, VAT-inclusive (₱)' : 'Selling price, before VAT (₱)')
    : 'Selling price (₱)';
  $('#products-hint').innerHTML = c.isVat
    ? `You are <strong>VAT-registered</strong>. Sales and profits below are shown <strong>net of 12% VAT</strong>, because the VAT goes to the BIR. ${state.setup.pricesIncludeVat ? 'Your prices include VAT, so VAT = price ÷ 1.12 × 12%.' : 'Your prices are before VAT, so VAT = price × 12% is added on top.'} Tick “Cost has 12% VAT” for supplies bought with a VAT invoice from a VAT-registered supplier, so you can claim the input VAT.`
    : `You are <strong>non-VAT</strong>, so you don't charge VAT. Any VAT your suppliers charge is part of your cost.${c.pt.applies ? ` A ${num(state.rates.percentageTax)}% percentage tax applies to your gross sales.` : ''}`;
  $('#products-hint').innerHTML += ' Click <strong>Recipe</strong> to list an item\'s ingredients and compute its unit cost. The <strong>suggested price</strong> gives you your target margin on that cost. Check <em>Profit or loss</em> to see whether total sales also cover rent, salaries and taxes.';

  // Expenses
  c.exps.forEach((e, i) => {
    setText(`e${i}-net`, fmt(e.net));
    setText(`e${i}-vat`, fmt(e.inputVat));
  });
  $('#expenses-foot').innerHTML = `<tr><td colspan="3">Total</td>
    <td class="num">${fmt(M.opex)}</td><td class="num">${fmt(sum(c.exps, e => e.inputVat))}</td><td></td></tr>`;

  // Staff
  c.pay.forEach((p, i) => {
    for (const k of ['sssEe', 'phEe', 'piEe', 'wtax', 'deductions', 'net', 'thirteenth', 'cost']) setText(`s${i}-${k}`, fmt(p[k]));
    setText(`s${i}-sssEr`, fmt(p.sssEr));
    setText(`s${i}-phEr`, fmt(p.phEr));
    setText(`s${i}-piEr`, fmt(p.piEr));
  });
  const tot = k => fmt(sum(c.pay, p => p[k]));
  $('#staff-foot').innerHTML = `<tr><td colspan="4">Total (${c.pay.length} staff)</td>
    <td class="num">${tot('basic')}</td><td class="num">${tot('allowance')}</td><td colspan="2"></td>
    <td class="num">${tot('sssEe')}</td><td class="num">${tot('phEe')}</td><td class="num">${tot('piEe')}</td>
    <td class="num">${tot('wtax')}</td><td class="num">${tot('deductions')}</td><td class="num">${tot('net')}</td>
    <td class="num">${tot('sssEr')}</td><td class="num">${tot('phEr')}</td><td class="num">${tot('piEr')}</td>
    <td class="num">${tot('thirteenth')}</td><td class="num">${tot('cost')}</td><td></td></tr>`;

  renderStatement(c);
  renderTaxBreakdown(c);
  renderVatExamples();
  renderKpis(c);

  $('#warnings').innerHTML = c.warnings.map(w => `<li>⚠ ${esc(w)}</li>`).join('');
}

function renderRecipeSummary(p, it, i) {
  p.ingredients.forEach((g, j) => setText(`p${i}-ing${j}`, fmt(ingredientCost(g))));
  // Keep the "adjust whole recipe" labels in step with what is typed
  const ref = p.ingredients[0];
  if (ref) setText(`p${i}-scalecur`, `${ingredientLabel(ref, 0)}, ${num(ref.useQty)} ${ref.unit || ''}`.trim());
  const el = document.getElementById(`p${i}-rsum`);
  if (!el) return;
  if (!p.ingredients.length) {
    el.innerHTML = '<p class="hint">Add ingredients to compute this item\'s unit cost automatically.</p>';
    return;
  }
  const batch = sum(p.ingredients, ingredientCost);
  const box = (label, value, cls = '') => `<div><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
  el.innerHTML =
    box('Cost per batch', fmt(batch))
    + box(`Unit cost (÷ ${batchYield(p)} pcs)`, fmt(batch / batchYield(p)))
    + box(`Suggested price at ${num(p.targetMargin)}% margin`, Number.isFinite(it.suggested) ? fmt(it.suggested) : '—')
    + box('Your current price', `${fmt(num(p.price))} · ${pctFmt(it.margin)} margin`, plCls(it.profitUnit));
}

function row(label, m, opts = {}) {
  const cls = [opts.cls || '', opts.indent ? 'indent' : ''].join(' ').trim();
  const signed = opts.signed ? fmtSigned : fmt;
  const color = opts.color ? plCls(m) : '';
  const note = opts.note ? `<div class="note">${esc(opts.note)}</div>` : '';
  return `<tr class="${cls}"><td>${esc(label)}${note}</td>
    <td class="num ${color}">${signed(m)}</td><td class="num ${color}">${signed(m * 12)}</td></tr>`;
}
const section = label => `<tr class="section"><td colspan="3">${esc(label)}</td></tr>`;
const head = `<tr><th></th><th class="num">Monthly</th><th class="num">Annual</th></tr>`;

function renderStatement(c) {
  const { M } = c;
  const name = state.setup.businessName ? `${state.setup.businessName}: ` : '';
  $('#summary-hint').textContent = `${name}${c.isSole ? 'Sole proprietor' : 'Corporation'}, ${c.isVat ? 'VAT-registered' : 'non-VAT'}. Amounts are net of VAT. Income tax here is the estimated tax due, before credits and payments already made.`;

  $('#statement').innerHTML = head
    + section('Revenue')
    + row('Gross sales', M.sales, { indent: true })
    + row('Less: Cost of goods sold (item costs)', M.cogs, { indent: true })
    + row('Gross profit', M.grossProfit, { cls: 'total', signed: true, color: true })
    + section('Operating expenses')
    + row('Rent, utilities & other expenses', M.opex, { indent: true })
    + row('Staff salaries & allowances', M.salaries, { indent: true })
    + row('Employer share: SSS, PhilHealth, Pag-IBIG', M.employerContrib, { indent: true })
    + row('13th month pay (accrued)', M.thirteenth, { indent: true })
    + (M.percentageTax ? row(`Percentage tax (${num(state.rates.percentageTax)}% of gross sales)`, M.percentageTax, { indent: true }) : '')
    + row('Total operating expenses', M.totalExpenses, { cls: 'total' })
    + row('Net income before income tax', M.netBeforeTax, { cls: 'total', signed: true, color: true })
    + row(c.it.label, M.incomeTax, { indent: true, note: 'See the Tax summary above for the full computation.' })
    + row(M.netProfit < 0 ? 'NET LOSS' : 'NET PROFIT', M.netProfit, { cls: 'grand', signed: true, color: true })
    + `<tr><td>Gross margin / Net margin</td><td class="num" colspan="2">${pctFmt(M.sales ? M.grossProfit / M.sales : NaN)} / ${pctFmt(M.sales ? M.netProfit / M.sales : NaN)}</td></tr>`
    + `<tr><td>Break-even sales <div class="note">Sales needed to cover all expenses (before income tax)</div></td>
        <td class="num">${Number.isFinite(M.breakEven) ? fmt(M.breakEven) : '—'}</td>
        <td class="num">${Number.isFinite(M.breakEven) ? fmt(M.breakEven * 12) : '—'}</td></tr>`;

  const isSole = c.isSole;
  $('#remit').innerHTML = `<tr><th>To BIR / agency</th><th class="num">Monthly</th><th class="num">Annual</th></tr>`
    + (c.isVat
      ? section('VAT (BIR Form 2550Q, quarterly)')
        + row('Output VAT (collected from customers)', M.outputVat, { indent: true })
        + row('Less: Input VAT (paid to suppliers)', M.inputVat, { indent: true })
        + row('VAT payable', M.vatPayable, { cls: 'total', note: 'Before carried-over input VAT and VAT withheld (see Tax summary)' })
      : (M.percentageTax ? section('Percentage tax (BIR Form 2551Q, quarterly)') + row('Percentage tax', M.percentageTax, { indent: true }) : ''))
    + section(`Income tax (BIR Form ${isSole ? '1701Q / 1701' : '1702Q / 1702'})`)
    + row('Income tax', M.incomeTax, { indent: true, note: 'Before credits and payments already made' })
    + section('Payroll remittances')
    + row('Withholding tax on compensation (BIR 1601-C)', M.wtax, { indent: true })
    + row('SSS (employee + employer + EC)', M.sssTotal, { indent: true })
    + row('PhilHealth (employee + employer)', M.phTotal, { indent: true })
    + row('Pag-IBIG (employee + employer)', M.piTotal, { indent: true })
    + row('Total to remit', M.remitTotal, { cls: 'grand' });
}

const NA = '<span class="na">Not applicable</span>';
const stepsTable = rows => `<table class="statement small steps">${rows
  .map(([label, value]) => `<tr><td>${esc(label)}</td><td class="num">${fmtSigned(value)}</td></tr>`).join('')}</table>`;

function renderTaxBreakdown(c) {
  const { vat, pt, it, M } = c;
  const r = state.rates;
  const vatTxt = `${num(r.vatRate)}%`;
  const divisor = String(Math.round((1 + pct(r.vatRate)) * 10000) / 10000);
  const line = (label, value, explain, cls = '') =>
    `<tr class="${cls}"><td>${label}</td><td class="num">${value}</td><td class="explain">${explain}</td></tr>`;
  const sec = label => `<tr class="section"><td colspan="3">${label}</td></tr>`;
  const isOsd = it.regime === 'osd' || it.regime === 'corp-osd';
  const vatCredits = vat.carryOver + vat.withheld;

  $('#tax-summary').innerHTML = '<tr><th>Item</th><th class="num">Per year</th><th>What it means</th></tr>'
    + sec('Sales')
    + line('Gross sales / receipts', fmt(vat.grossY), vat.applies
      ? 'The total your customers pay, including VAT.'
      : "The total your customers pay. You don't charge VAT, so this equals your sales.")
    + line('Sales excluding VAT', fmt(vat.salesExclY), vat.applies
      ? `Gross sales ÷ ${divisor}. This is your actual revenue. The VAT portion belongs to the BIR.`
      : 'The same as gross sales, because no VAT is included.')
    + sec('VAT (value-added tax)')
    + line('Output VAT', vat.applies ? fmt(vat.outputY) : NA, `VAT charged on your VATable sales (${vatTxt}).`)
    + line('Less: creditable input VAT', vat.applies ? fmtSigned(-vat.inputY) : NA, 'VAT paid on eligible business purchases with valid VAT invoices, which you can credit against output VAT.')
    + (vat.applies && vatCredits ? line('Less: carried-over input VAT & VAT withheld', fmtSigned(-vatCredits), 'Excess input VAT from the previous quarter, plus VAT withheld by government customers (BIR Form 2307).') : '')
    + line('Net VAT payable', vat.applies ? fmt(vat.payableY) : NA, vat.applies
      ? `What remains after subtracting allowable input VAT credits and adjustments. Paid quarterly, about ${fmt(vat.payableY / 4)} per quarter.`
      : esc(vat.reason), 'total')
    + sec('Income tax')
    + line('Allowable business deductions', it.deductions === null ? NA : fmtSigned(it.deductions), it.deductions === null
      ? 'Not used under the 8% option. Business expenses are not deducted, because the tax is based on gross sales.'
      : isOsd
        ? `The ${num(r.osdRate)}% optional standard deduction${it.regime === 'corp-osd' ? ', plus cost of sales' : ''}.`
        : 'Cost of goods sold, operating expenses, payroll costs and percentage tax.')
    + line(it.regime === 'eight' ? 'Tax base' : 'Taxable income', fmt(it.taxable), it.regime === 'eight'
      ? `Gross sales${state.setup.mixedIncome ? '' : ' minus ₱250,000'}: the amount the 8% rate is applied to.`
      : 'Gross sales minus allowable deductions. Income tax is computed on this amount, not on gross sales.')
    + line('Estimated income tax', fmt(it.tax), `${esc(it.label)}. See the computation below.`, 'total')
    + sec('Percentage tax')
    + line('Estimated percentage tax', pt.unknown ? '<span class="na">Not computed</span>' : pt.applies ? fmt(pt.amountY) : NA, pt.applies
      ? `Gross sales × ${num(r.percentageTax)}%. Paid quarterly, about ${fmt(pt.amountY / 4)} per quarter.`
      : esc(pt.reason), 'total')
    + sec('Credits and payments already made')
    + line('Less: creditable withholding tax (BIR 2307)', fmtSigned(-it.cwt), 'Income tax your customers withheld from their payments to you.')
    + line('Less: income tax paid in earlier quarters', fmtSigned(-it.paid), 'Amounts paid with your quarterly income tax returns this year.')
    + line('Remaining estimated tax payable', fmt(M.remainingY),
      `Net VAT payable + percentage tax + income tax still due after credits (${fmt(it.remaining)})${pt.unknown ? '. Other percentage taxes are not included' : ''}.`, 'grand');

  const card = ({ title, badge, what, why, formula, body = '', filing, warn }) => `<div class="tax-card">
      <div class="tax-card-head"><h3>${title}</h3><span class="badge">${badge}</span></div>
      <p><strong>What it is:</strong> ${what}</p>
      <p><strong>Does it apply to you?</strong> ${esc(why)}</p>
      ${warn ? `<p class="warn-note">⚠ ${warn}</p>` : ''}
      ${formula ? `<div class="formula">${esc(formula).replace(/\n/g, '<br>')}</div>` : ''}
      ${body}
      ${filing ? `<p class="hint filing">${filing}</p>` : ''}
    </div>`;

  const vatBody = vat.applies
    ? stepsTable([
      ['Output VAT on sales', vat.outputY],
      ['Less: creditable input VAT', -vat.inputY],
      ...(vat.carryOver ? [['Less: input VAT carried over from the previous quarter', -vat.carryOver]] : []),
      ...(vat.withheld ? [['Less: VAT withheld by government customers', -vat.withheld]] : []),
      [vat.excessY ? 'Excess input VAT (carried over, nothing to pay)' : 'Net VAT payable', vat.excessY ? vat.excessY : vat.payableY],
    ]) : '';
  const inputVatRules = `<details class="rules"><summary>When is input VAT creditable?</summary><ul>
      <li>You are VAT-registered, and the purchase is for your business.</li>
      <li>The supplier is VAT-registered and gave you a valid VAT invoice that shows the VAT separately and your TIN. Since the Ease of Paying Taxes Act, an official receipt alone is not enough.</li>
      <li>The purchase is for VATable or zero-rated sales. Input VAT on VAT-exempt sales is <strong>not</strong> creditable, and businesses with both kinds of sales must split (allocate) it.</li>
      <li>Purchases from non-VAT suppliers have no input VAT to claim.</li>
      <li>Excess input VAT carries over to the next quarter. It is not refunded in cash, except input VAT on zero-rated sales, which needs a refund claim.</li>
    </ul></details>`;

  $('#tax-cards').innerHTML =
    card({
      title: 'VAT (value-added tax)',
      badge: vat.applies ? `${fmt(vat.payableY)} / yr` : 'Not applicable',
      what: 'A tax on sales that VAT-registered businesses add to their prices and collect from customers. You pay the BIR the difference between the VAT you collected (<em>output VAT</em>) and the creditable VAT you paid on business purchases (<em>input VAT</em>). The VAT passes through your business: it is not your income or your expense.',
      why: vat.reason,
      formula: vat.applies
        ? (state.setup.pricesIncludeVat
          ? `Output VAT = VAT-inclusive sales ÷ ${divisor} × ${vatTxt}`
          : `Output VAT = Sales before VAT × ${vatTxt}`)
          + '\nNet VAT payable = Output VAT − Creditable input VAT − Carried-over input VAT − VAT withheld'
        : '',
      body: vatBody + inputVatRules,
      filing: vat.applies ? 'Filed quarterly on BIR Form 2550Q, by the 25th day after each quarter ends.' : '',
    })
    + card({
      title: 'Percentage tax',
      badge: pt.unknown ? 'Not computed' : pt.applies ? `${fmt(pt.amountY)} / yr` : 'Not applicable',
      what: "A separate business tax for some taxpayers who are not subject to VAT. It is based on gross sales, not profit. Unlike VAT, it is not added on top of your price, and it is not credited against anything. It is your own expense.",
      why: pt.reason,
      warn: pt.unknown ? 'Information is not enough to compute this tax.' : '',
      formula: pt.applies ? pt.formula : '',
      body: pt.applies ? stepsTable([['Gross sales', vat.salesExclY], [`Percentage tax (× ${num(r.percentageTax)}%)`, pt.amountY]]) : '',
      filing: pt.applies ? 'Filed quarterly on BIR Form 2551Q, within 25 days after each quarter ends.' : '',
    })
    + card({
      title: 'Income tax',
      badge: `${fmt(it.tax)} / yr`,
      what: 'A tax on your business income, separate from VAT and percentage tax. Except under the 8% option, it is computed on <em>taxable income</em> (sales minus allowable deductions), not on gross sales.',
      why: it.why + (it.note ? ' ' + it.note : ''),
      warn: it.insufficient ? 'Some information is missing, so this estimate may be off. See the warnings at the top of the page.' : '',
      formula: it.formula,
      body: stepsTable(it.steps)
        + '<h4>Credits and payments already made</h4>'
        + stepsTable([
          ['Estimated income tax due', it.tax],
          ['Less: creditable withholding tax (BIR 2307)', -it.cwt],
          ['Less: income tax paid in earlier quarters', -it.paid],
          [it.overpaid ? 'Overpayment (refund, tax credit or carry-over)' : 'Remaining income tax payable', it.overpaid || it.remaining],
        ]),
      filing: `Filed on ${it.form}.`,
    });
}

function renderVatExamples() {
  const rate = pct(state.rates.vatRate);
  const rTxt = `${num(state.rates.vatRate)}%`;
  const divisor = String(Math.round((1 + rate) * 10000) / 10000);
  const ex = vatOnTop(1000, rate);
  const back = vatInside(ex.gross, rate);
  $('#vat-ex-excl').innerHTML = stepsTable([
    ['Selling price before VAT', ex.net],
    [`VAT (${rTxt} × ${fmt(ex.net)})`, ex.vat],
    ['Total selling price', ex.gross],
  ]);
  $('#vat-ex-incl').innerHTML = stepsTable([
    ['Total selling price including VAT', back.gross],
    [`Sales before VAT (${fmt(back.gross)} ÷ ${divisor})`, back.net],
    [`VAT component (${fmt(back.gross)} − ${fmt(back.net)})`, back.vat],
  ]);
  $('#vat-mistake').textContent = `A common mistake is to compute ${fmt(back.gross)} × ${rTxt} = ${fmt(back.gross * rate)}. That charges VAT on the VAT. The VAT inside a VAT-inclusive price is always total ÷ ${divisor} × ${rTxt} (here, ${fmt(back.vat)}).`;

  const amount = num($('[data-vatcalc="amount"]').value);
  const mode = $('[data-vatcalc="mode"]').value;
  const res = mode === 'incl' ? vatInside(amount, rate) : vatOnTop(amount, rate);
  $('#vat-try-result').innerHTML = stepsTable([
    ['Amount before VAT', res.net],
    [`VAT (${rTxt})`, res.vat],
    ['Total including VAT', res.gross],
  ]);
}

function renderKpis(c) {
  const { M } = c;
  const card = (label, value, sub, cls = '') =>
    `<div class="kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
  $('#kpis').innerHTML =
    card(c.isVat ? 'Sales excl. VAT / month' : 'Gross sales / month', fmt(M.sales), `${fmt(M.sales * 12)} / year`)
    + card('Gross profit / month', fmtSigned(M.grossProfit), `margin ${pctFmt(M.sales ? M.grossProfit / M.sales : NaN)}`, plCls(M.grossProfit))
    + card('Payroll cost / month', fmt(M.salaries + M.employerContrib + M.thirteenth), `${state.staff.length} staff, incl. employer share & 13th month`)
    + card('Estimated taxes / year', fmt(M.taxesY),
      `VAT ${c.vat.applies ? fmt(c.vat.payableY) : 'n/a'} · Percentage ${c.pt.unknown ? 'not computed' : c.pt.applies ? fmt(c.pt.amountY) : 'n/a'} · Income ${fmt(c.it.tax)}`)
    + card(M.netProfit < 0 ? 'Net LOSS / month' : 'Net profit / month', fmtSigned(M.netProfit), `${fmtSigned(M.netProfit * 12)} / year`, plCls(M.netProfit));
}

function renderRates() {
  $('#rates-form').innerHTML = RATE_GROUPS.map(([title, fields]) => `<fieldset><legend>${title}</legend>
      ${fields.map(([key, label]) => `<label>${label}<input type="number" step="any" data-rate="${key}" value="${esc(state.rates[key])}"></label>`).join('')}
    </fieldset>`).join('');

  const tableRows = (table, unit) => {
    const rows = table.map((b, i) => {
      const next = table[i + 1];
      const range = next ? `${fmt(b.over)} – ${fmt(next.over)}` : `Over ${fmt(b.over)}`;
      const rule = b.rate === 0 ? 'Exempt' : `${b.base ? fmt(b.base) + ' + ' : ''}${b.rate * 100}% of excess over ${fmt(b.over)}`;
      return `<tr><td>${range}</td><td>${rule}</td></tr>`;
    });
    return `<tr><th>${unit}</th><th>Tax</th></tr>` + rows.join('');
  };
  $('#table-annual').innerHTML = tableRows(GRADUATED_ANNUAL, 'Annual taxable income');
  $('#table-monthly').innerHTML = tableRows(WTAX_MONTHLY, 'Monthly taxable pay');
  $('#rules-as-of').textContent = TAX_RULES_AS_OF;
  $('#tax-sources').innerHTML = TAX_SOURCES.map(([topic, basis]) => `<li><strong>${esc(topic)}:</strong> ${esc(basis)}</li>`).join('');
}

function refresh() {
  renderCalculated(compute(state));
  saveState();
}

function renderAll() {
  renderSetup();
  renderTables();
  renderRates();
  refresh();
}

/* ---------------- events ---------------- */

// Products with a recipe take their unit cost from it.
function syncRecipeCost(i) {
  const p = state.products[i];
  if (!p.ingredients.length) return;
  p.cost = recipeUnitCost(p);
  const input = document.querySelector(`input[data-recipe-cost="${i}"]`);
  if (input) input.value = round2(p.cost);
}

// Keep daily rate, days worked and monthly salary consistent: monthly = daily x days.
function syncSalary(emp, i, field) {
  const days = num(emp.workDays);
  let target;
  if (field === 'daily' || field === 'workDays') {
    emp.basic = round2(num(emp.daily) * days);
    target = 'basic';
  } else if (field === 'basic') {
    emp.daily = days > 0 ? round2(num(emp.basic) / days) : 0;
    target = 'daily';
  } else {
    return;
  }
  const input = document.querySelector(`input[data-list="staff"][data-i="${i}"][data-field="${target}"]`);
  if (input) input.value = emp[target];
}

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.vatcalc) {
    renderVatExamples();
    return;
  }
  if (el.dataset.setup) {
    state.setup[el.dataset.setup] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.setup === 'type') {
      if (el.value === 'corp' && state.setup.taxOption === 'eight') state.setup.taxOption = 'graduated';
      renderSetup();
    }
  } else if (el.dataset.list) {
    const i = +el.dataset.i;
    const item = state[el.dataset.list][i];
    item[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.list === 'staff') syncSalary(item, i, el.dataset.field);
  } else if (el.dataset.ing) {
    state.products[+el.dataset.ing].ingredients[+el.dataset.i][el.dataset.field] = el.value;
    syncRecipeCost(+el.dataset.ing);
  } else if (el.dataset.scaleYield) {
    state.products[+el.dataset.scaleYield].scaleYield = el.checked;
  } else if (el.dataset.recipeYield) {
    state.products[+el.dataset.recipeYield].batchYield = el.value;
    syncRecipeCost(+el.dataset.recipeYield);
  } else if (el.dataset.rate) {
    state.rates[el.dataset.rate] = el.value;
  } else {
    return;
  }
  refresh();
});

document.addEventListener('click', e => {
  const el = e.target.closest('button');
  if (!el) return;

  if (el.classList.contains('tab')) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === el));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + el.dataset.tab));
    return;
  }
  if (el.dataset.toggleRecipe) {
    const i = +el.dataset.toggleRecipe;
    if (!openRecipes.delete(i)) openRecipes.add(i);
    renderTables();
    refresh();
    return;
  }
  if (el.dataset.addIng) {
    const i = +el.dataset.addIng;
    state.products[i].ingredients.push(newIngredient());
    syncRecipeCost(i);
    renderTables();
    refresh();
    const inputs = document.querySelectorAll(`input[data-ing="${i}"][data-field="name"]`);
    inputs[inputs.length - 1]?.focus();
    return;
  }
  if (el.dataset.scaleApply) {
    const i = +el.dataset.scaleApply;
    const p = state.products[i];
    const ref = p.ingredients[0];
    const target = num(document.querySelector(`input[data-scale-to="${i}"]`).value);
    if (!ref || num(ref.useQty) <= 0) {
      alert('The main (first) ingredient has no quantity yet. Enter its "Qty used in recipe" first.');
    } else if (target <= 0) {
      alert('Type the new amount for the main ingredient first.');
    } else {
      scaleRecipe(i, target / num(ref.useQty));
    }
    return;
  }
  if (el.dataset.scaleFactor) {
    scaleRecipe(+el.dataset.p, +el.dataset.scaleFactor);
    return;
  }
  if (el.dataset.removeIng) {
    const i = +el.dataset.removeIng;
    state.products[i].ingredients.splice(+el.dataset.i, 1);
    syncRecipeCost(i);
    renderTables();
    refresh();
    return;
  }
  if (el.dataset.usePrice) {
    const i = +el.dataset.usePrice;
    const suggested = compute(state).items[i].suggested;
    if (Number.isFinite(suggested)) {
      state.products[i].price = suggested;
      renderTables();
      refresh();
    }
    return;
  }
  if (el.dataset.add) {
    const blank = {
      products: newProduct(),
      expenses: { name: '', amount: 0, hasVat: false },
      staff: newEmployee(),
    }[el.dataset.add];
    state[el.dataset.add].push(blank);
    renderTables();
    refresh();
    const rows = document.querySelectorAll(`#${el.dataset.add}-body tr`);
    rows[rows.length - 1]?.querySelector('input')?.focus();
    return;
  }
  if (el.dataset.remove) {
    const removed = +el.dataset.i;
    state[el.dataset.remove].splice(removed, 1);
    if (el.dataset.remove === 'products') {
      openRecipes = new Set([...openRecipes].filter(x => x !== removed).map(x => (x > removed ? x - 1 : x)));
    }
    renderTables();
    refresh();
    return;
  }

  switch (el.id) {
    case 'btn-print': window.print(); break;
    case 'btn-reset':
      if (confirm('Clear everything and start over with sample data?')) { state = defaultState(); renderAll(); }
      break;
    case 'btn-reset-rates':
      state.rates = { ...DEFAULT_RATES };
      renderRates();
      refresh();
      break;
    case 'btn-export': {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (state.setup.businessName || 'business').replace(/[^\w-]+/g, '_') + '-calculator.json';
      a.click();
      URL.revokeObjectURL(a.href);
      break;
    }
  }
});

// Pressing Enter in the "new amount" box applies the scaling
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.scaleTo) {
    document.querySelector(`button[data-scale-apply="${e.target.dataset.scaleTo}"]`)?.click();
  }
});

$('#btn-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state = normalize(JSON.parse(await file.text()));
    renderAll();
  } catch (err) {
    alert('Could not read that file. Please choose a file exported from this calculator.');
  }
  e.target.value = '';
});

renderAll();
