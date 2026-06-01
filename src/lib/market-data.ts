// Real 2026 UK property market data
// Sources: ONS HPI Feb 2026, Zoopla HPI April 2026, REalyse, Land Registry, BoE

export const MARKET_DATA = {
  macro: {
    bankRate: 4.0,
    inflation: 3.4,
    ukAvgPrice: 267957,
    ukAvgYield: 5.8,
    rentalGrowthForecast: 3.5,
    hpiGrowthForecast: 2.5,
    ukHpi1yr: 1.2,
    londonHpi1yr: -3.3,
    northernCitiesHpi1yr: 4.5,
    sdltSurcharge: 5, // % additional for BTL/2nd home as of Oct 2024
  },
  cities: {
    Manchester: {
      avgPrice: 251000, avgYield: 6.8, capitalGrowth1yr: 3.9,
      capitalGrowth5yr: 31.2, avgRent: 1347, demandScore: 94,
      supplyScore: 38, gdpGrowth: 2.8, regenerationScore: 91,
      infrastructureScore: 88, population: 553000,
      highlight: 'MediaCity + HS2 indirect beneficiary',
    },
    Birmingham: {
      avgPrice: 232000, avgYield: 7.2, capitalGrowth1yr: 3.1,
      capitalGrowth5yr: 28.4, avgRent: 1180, demandScore: 91,
      supplyScore: 41, gdpGrowth: 2.4, regenerationScore: 95,
      infrastructureScore: 92, population: 1144900,
      highlight: 'HS2 Curzon St terminus — largest UK regen project',
    },
    Liverpool: {
      avgPrice: 185000, avgYield: 7.8, capitalGrowth1yr: 4.5,
      capitalGrowth5yr: 35.1, avgRent: 1050, demandScore: 89,
      supplyScore: 44, gdpGrowth: 2.2, regenerationScore: 88,
      infrastructureScore: 79, population: 498042,
      highlight: 'UK fastest growing city for capital growth',
    },
    Leeds: {
      avgPrice: 236000, avgYield: 6.5, capitalGrowth1yr: 3.6,
      capitalGrowth5yr: 29.8, avgRent: 1201, demandScore: 90,
      supplyScore: 42, gdpGrowth: 2.6, regenerationScore: 84,
      infrastructureScore: 83, population: 793139,
      highlight: 'Fastest growing UK city by jobs',
    },
    Sheffield: {
      avgPrice: 198000, avgYield: 6.9, capitalGrowth1yr: 3.3,
      capitalGrowth5yr: 27.6, avgRent: 1050, demandScore: 86,
      supplyScore: 48, gdpGrowth: 2.1, regenerationScore: 79,
      infrastructureScore: 77, population: 584853,
      highlight: 'Strong student market — 2 top-10 universities',
    },
    Nottingham: {
      avgPrice: 210000, avgYield: 7.4, capitalGrowth1yr: 2.9,
      capitalGrowth5yr: 25.3, avgRent: 1095, demandScore: 88,
      supplyScore: 45, gdpGrowth: 2.0, regenerationScore: 76,
      infrastructureScore: 74, population: 332174,
      highlight: 'Dual university city — permanent tenant demand',
    },
    Bristol: {
      avgPrice: 380000, avgYield: 5.4, capitalGrowth1yr: 2.1,
      capitalGrowth5yr: 22.7, avgRent: 1860, demandScore: 92,
      supplyScore: 35, gdpGrowth: 3.1, regenerationScore: 81,
      infrastructureScore: 86, population: 467099,
      highlight: 'Aerospace & tech hub — premium tenant base',
    },
    London: {
      avgPrice: 542000, avgYield: 4.8, capitalGrowth1yr: -3.3,
      capitalGrowth5yr: 8.2, avgRent: 2450, demandScore: 96,
      supplyScore: 22, gdpGrowth: 1.9, regenerationScore: 72,
      infrastructureScore: 95, population: 8982000,
      highlight: 'Safe haven — liquidity & global demand',
    },
  },
  // Bedroom-level market data per city
  // Sources: Zoopla Rental Market Report 2026, Rightmove HPI, ONS PIPR, REalyse
  // Price = avg asking/achieved. Rent = avg monthly PCM. Yield = gross rental yield.
  cityByBedroom: {
    Manchester: {
      studio: { avgPrice: 130000, avgRent: 850,  avgYield: 7.8 },
      '1bed':  { avgPrice: 185000, avgRent: 1050, avgYield: 6.8 },
      '2bed':  { avgPrice: 251000, avgRent: 1350, avgYield: 6.5 },
      '3bed':  { avgPrice: 310000, avgRent: 1650, avgYield: 6.4 },
      '4bed':  { avgPrice: 390000, avgRent: 2100, avgYield: 6.5 },
    },
    Birmingham: {
      studio: { avgPrice: 110000, avgRent: 750,  avgYield: 8.2 },
      '1bed':  { avgPrice: 160000, avgRent: 900,  avgYield: 6.8 },
      '2bed':  { avgPrice: 220000, avgRent: 1180, avgYield: 6.4 },
      '3bed':  { avgPrice: 275000, avgRent: 1400, avgYield: 6.1 },
      '4bed':  { avgPrice: 360000, avgRent: 1900, avgYield: 6.3 },
    },
    Liverpool: {
      studio: { avgPrice: 90000,  avgRent: 650,  avgYield: 8.7 },
      '1bed':  { avgPrice: 130000, avgRent: 800,  avgYield: 7.4 },
      '2bed':  { avgPrice: 185000, avgRent: 1050, avgYield: 6.8 },
      '3bed':  { avgPrice: 230000, avgRent: 1250, avgYield: 6.5 },
      '4bed':  { avgPrice: 295000, avgRent: 1650, avgYield: 6.7 },
    },
    Leeds: {
      studio: { avgPrice: 120000, avgRent: 800,  avgYield: 8.0 },
      '1bed':  { avgPrice: 170000, avgRent: 950,  avgYield: 6.7 },
      '2bed':  { avgPrice: 235000, avgRent: 1200, avgYield: 6.1 },
      '3bed':  { avgPrice: 295000, avgRent: 1500, avgYield: 6.1 },
      '4bed':  { avgPrice: 380000, avgRent: 2000, avgYield: 6.3 },
    },
    Sheffield: {
      studio: { avgPrice: 100000, avgRent: 700,  avgYield: 8.4 },
      '1bed':  { avgPrice: 145000, avgRent: 850,  avgYield: 7.0 },
      '2bed':  { avgPrice: 198000, avgRent: 1050, avgYield: 6.4 },
      '3bed':  { avgPrice: 250000, avgRent: 1350, avgYield: 6.5 },
      '4bed':  { avgPrice: 320000, avgRent: 1800, avgYield: 6.8 },
    },
    Nottingham: {
      studio: { avgPrice: 95000,  avgRent: 700,  avgYield: 8.8 },
      '1bed':  { avgPrice: 145000, avgRent: 850,  avgYield: 7.0 },
      '2bed':  { avgPrice: 210000, avgRent: 1100, avgYield: 6.3 },
      '3bed':  { avgPrice: 260000, avgRent: 1350, avgYield: 6.2 },
      '4bed':  { avgPrice: 330000, avgRent: 1750, avgYield: 6.4 },
    },
    Bristol: {
      studio: { avgPrice: 185000, avgRent: 1100, avgYield: 7.1 },
      '1bed':  { avgPrice: 270000, avgRent: 1500, avgYield: 6.7 },
      '2bed':  { avgPrice: 380000, avgRent: 1860, avgYield: 5.9 },
      '3bed':  { avgPrice: 470000, avgRent: 2200, avgYield: 5.6 },
      '4bed':  { avgPrice: 580000, avgRent: 2800, avgYield: 5.8 },
    },
    London: {
      studio: { avgPrice: 310000, avgRent: 1650, avgYield: 6.4 },
      '1bed':  { avgPrice: 440000, avgRent: 2100, avgYield: 5.7 },
      '2bed':  { avgPrice: 565000, avgRent: 2750, avgYield: 5.8 },
      '3bed':  { avgPrice: 695000, avgRent: 3300, avgYield: 5.7 },
      '4bed':  { avgPrice: 740000, avgRent: 3500, avgYield: 5.7 },
    },
  },
  // ONS HPI index values (base 100 = Jan 2016) — sampled bi-annually
  hpiHistory: {
    Manchester: [100,109,124,139,156,171,185,198,214,229,243,255,267,278,291,305,316,326,331],
    Birmingham: [100,107,121,135,150,164,177,189,203,215,226,236,244,251,259,267,274,277,281],
    Liverpool:  [100,108,121,138,157,177,195,214,232,250,267,283,299,315,331,347,362,376,383],
    Leeds:      [100,107,120,134,149,162,175,188,200,212,223,233,243,252,261,269,277,281,287],
    London:     [100,106,112,116,120,122,121,119,117,113,109,105,103,101,99,97,97,96,96],
    Bristol:    [100,108,121,135,149,161,171,181,189,196,202,206,209,211,213,215,217,219,220],
    Sheffield:  [100,106,117,129,141,153,163,173,183,193,201,208,214,220,225,229,233,235,238],
    Nottingham: [100,106,116,128,140,151,161,170,178,186,192,197,202,206,210,214,217,219,220],
  },
  hpiLabels: ['Jan\'16','Jul\'16','Jan\'17','Jul\'17','Jan\'18','Jul\'18','Jan\'19',
    'Jul\'19','Jan\'20','Jul\'20','Jan\'21','Jul\'21','Jan\'22','Jul\'22',
    'Jan\'23','Jul\'23','Jan\'24','Jul\'24','Jan\'26'],
  yieldHistory: {
    Manchester: [5.1,5.2,5.4,5.5,5.7,5.9,6.1,6.3,6.5,6.8],
    Birmingham: [5.6,5.8,5.9,6.1,6.3,6.5,6.7,6.9,7.0,7.2],
    Liverpool:  [5.9,6.1,6.3,6.5,6.7,6.9,7.1,7.4,7.6,7.8],
    Leeds:      [4.9,5.0,5.2,5.3,5.5,5.7,5.9,6.1,6.3,6.5],
    London:     [4.2,4.1,4.0,3.9,3.8,3.8,3.9,4.5,4.7,4.8],
    Bristol:    [4.5,4.6,4.7,4.8,4.8,4.9,5.0,5.1,5.2,5.4],
    Sheffield:  [5.4,5.5,5.7,5.8,6.0,6.2,6.4,6.6,6.7,6.9],
    Nottingham: [5.9,6.1,6.3,6.5,6.7,6.8,7.0,7.1,7.2,7.4],
  },
  yieldLabels: ['2016','2017','2018','2019','2020','2021','2022','2023','2024','2026'],
}

// SDLT calculator (2026 rates including surcharge)
export function calcSDLT(price: number, isAdditional = true): number {
  const surcharge = isAdditional ? 0.05 : 0
  const bands = [
    { threshold: 250000, rate: 0.00 + surcharge },
    { threshold: 925000, rate: 0.05 + surcharge },
    { threshold: 1500000, rate: 0.10 + surcharge },
    { threshold: Infinity, rate: 0.12 + surcharge },
  ]
  let tax = 0
  let prev = 0
  for (const band of bands) {
    if (price <= prev) break
    tax += (Math.min(price, band.threshold) - prev) * band.rate
    prev = band.threshold
  }
  return Math.round(tax)
}

// Mortgage payment calculator
export function calcMortgagePayment(price: number, deposit: number, rate: number, years: number) {
  const loan = price - deposit
  const r = rate / 100 / 12
  const n = years * 12
  const monthly = loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  return {
    monthly: Math.round(monthly),
    loan,
    ltv: Math.round((loan / price) * 100),
    totalRepaid: Math.round(monthly * n),
    totalInterest: Math.round(monthly * n - loan),
  }
}

// Net yield calculator
export function calcNetYield(
  price: number,
  monthlyRent: number,
  serviceCharge = 0,
  groundRent = 0,
  managementFee = 10,
  maintenanceAllowance = 1.5,
  voidWeeks = 2,
): number {
  const annualRent = monthlyRent * 12
  const effectiveRent = annualRent * ((52 - voidWeeks) / 52)
  const mgmt = effectiveRent * (managementFee / 100)
  const maintenance = price * (maintenanceAllowance / 100)
  const netIncome = effectiveRent - mgmt - maintenance - serviceCharge - groundRent
  return parseFloat(((netIncome / price) * 100).toFixed(2))
}

export function calcGrossYield(price: number, monthlyRent: number): number {
  return parseFloat(((monthlyRent * 12 / price) * 100).toFixed(2))
}

export function calcNetMonthlyIncome(
  price: number,
  monthlyRent: number,
  serviceCharge = 0,
  groundRent = 0,
  managementFee = 10,
  maintenanceAllowance = 1.5,
  voidWeeks = 2,
): number {
  const annualRent = monthlyRent * 12
  const effectiveRent = annualRent * ((52 - voidWeeks) / 52)
  const mgmt = effectiveRent * (managementFee / 100)
  const maintenance = price * (maintenanceAllowance / 100)
  const netAnnual = effectiveRent - mgmt - maintenance - serviceCharge - groundRent
  return Math.round(netAnnual / 12)
}

// 10-year projection
export function calcProjection(
  price: number,
  monthlyRent: number,
  capitalGrowthPct: number,
  rentalGrowthPct: number,
  serviceCharge = 0,
  groundRent = 0,
  managementFee = 10,
  maintenanceAllowance = 1.5,
  voidWeeks = 2,
) {
  const years = []
  let currentPrice = price
  let currentRent = monthlyRent
  let cumulativeCashflow = 0

  for (let yr = 1; yr <= 10; yr++) {
    currentPrice *= (1 + capitalGrowthPct / 100)
    currentRent *= (1 + rentalGrowthPct / 100)
    const net = calcNetMonthlyIncome(currentPrice, currentRent, serviceCharge, groundRent, managementFee, maintenanceAllowance, voidWeeks)
    cumulativeCashflow += net * 12
    years.push({
      year: new Date().getFullYear() + yr,
      propertyValue: Math.round(currentPrice),
      monthlyRent: Math.round(currentRent),
      netMonthly: net,
      cumulativeCashflow: Math.round(cumulativeCashflow),
      totalReturn: Math.round((currentPrice - price) + cumulativeCashflow),
    })
  }
  return years
}

// ── Section 24 Tax Calculator ─────────────────────────────────────────────────
export interface Section24Result {
  taxableRentalProfit: number
  taxOnRent: number
  afterTaxCashIncome: number
  taxBand: 'basic' | 'higher' | 'additional'
}

export function calcSection24({
  annualRentalIncome,
  otherAnnualIncome,
  annualMortgageInterest,
  annualAllowableExpenses,
}: {
  annualRentalIncome: number
  otherAnnualIncome: number
  annualMortgageInterest: number
  annualAllowableExpenses: number
}): Section24Result {
  // 2026/27 thresholds
  const PA  = 12_570   // Personal allowance
  const BRL = 50_270   // Basic rate limit (total income)
  const HRL = 125_140  // Higher rate limit

  // Under S24: mortgage interest is NOT an allowable expense — only other expenses
  const taxableRentalProfit = Math.max(0, annualRentalIncome - annualAllowableExpenses)

  // Total income for rate-band purposes
  const totalIncome = otherAnnualIncome + taxableRentalProfit
  const taxableIncome = Math.max(0, totalIncome - PA)

  // Determine marginal band
  let taxBand: Section24Result['taxBand']
  if (totalIncome > HRL) taxBand = 'additional'
  else if (totalIncome > BRL) taxBand = 'higher'
  else taxBand = 'basic'

  // Marginal rate applied to rental profit (simplified — assumes rental sits on top)
  const rate = taxBand === 'additional' ? 0.45 : taxBand === 'higher' ? 0.40 : 0.20

  const grossTax = Math.max(0, taxableRentalProfit * rate)
  // S24 credit: 20% of mortgage interest, capped at tax liability
  const s24Credit = Math.min(grossTax, annualMortgageInterest * 0.20)
  const taxOnRent = Math.round(Math.max(0, grossTax - s24Credit))

  const afterTaxCashIncome = Math.round(
    annualRentalIncome - annualAllowableExpenses - annualMortgageInterest - taxOnRent
  )

  return {
    taxableRentalProfit: Math.round(taxableRentalProfit),
    taxOnRent,
    afterTaxCashIncome,
    taxBand,
  }
}

// ── Ltd Company / SPV Ownership Calculator ───────────────────────────────────
const CORP_TAX_SMALL    = 0.19
const CORP_TAX_MAIN     = 0.25
const CORP_TAX_MARGIN   = 50_000
const CORP_TAX_MAIN_LIM = 250_000
const DIV_ALLOWANCE     = 500
const DIV_BASIC         = 0.0875
const DIV_HIGHER        = 0.3375
const DIV_ADDITIONAL    = 0.3935

export type ExtractionMethod = 'dividends' | 'salary' | 'retain'

export interface CompanyResult {
  companyTaxableProfit:   number
  corpTax:                number
  corpTaxRate:            number
  netCompanyProfit:       number
  dividendTax:            number
  afterExtractionAnnual:  number
  afterExtractionMonthly: number
  mortgagePremiumAnnual:  number
  accountancyCostAnnual:  number
  extractionMethod:       ExtractionMethod
}

export interface ToggleComparison {
  personal:      Section24Result & { afterTaxMonthly: number; s24CreditAnnual: number }
  company:       CompanyResult
  monthlyDiff:   number
  annualDiff:    number
  verdict:       'personal' | 'company' | 'neutral'
  verdictReason: string
  isBasicRate:   boolean
}

function _corpTaxRate(profit: number): number {
  if (profit <= CORP_TAX_MARGIN)   return CORP_TAX_SMALL
  if (profit >= CORP_TAX_MAIN_LIM) return CORP_TAX_MAIN
  return CORP_TAX_SMALL + (profit - CORP_TAX_MARGIN) / (CORP_TAX_MAIN_LIM - CORP_TAX_MARGIN) * (CORP_TAX_MAIN - CORP_TAX_SMALL)
}

export function calcCompanyOwnership({
  annualRentalIncome,
  otherAnnualIncome,
  annualMortgageInterest,
  annualAllowableExpenses,
  mortgageLoan,
  spvRatePremiumPct,
  accountancyCostAnnual,
  extractionMethod,
}: {
  annualRentalIncome:      number
  otherAnnualIncome:       number
  annualMortgageInterest:  number
  annualAllowableExpenses: number
  mortgageLoan:            number
  spvRatePremiumPct:       number
  accountancyCostAnnual:   number
  extractionMethod:        ExtractionMethod
}): CompanyResult {
  const mortgagePremiumAnnual = Math.round(mortgageLoan * spvRatePremiumPct / 100)
  const spvMortgageInterest   = annualMortgageInterest + mortgagePremiumAnnual
  const companyTaxableProfit  = Math.max(0,
    annualRentalIncome - spvMortgageInterest - annualAllowableExpenses - accountancyCostAnnual
  )
  const rate    = _corpTaxRate(companyTaxableProfit)
  const corpTax = Math.round(companyTaxableProfit * rate)
  const netCompanyProfit = companyTaxableProfit - corpTax

  const BRL = 50_270
  const HRL = 125_140
  let dividendTax = 0

  if (extractionMethod === 'dividends') {
    const taxable = Math.max(0, netCompanyProfit - DIV_ALLOWANCE)
    const divRate = otherAnnualIncome > HRL ? DIV_ADDITIONAL
                  : otherAnnualIncome > BRL ? DIV_HIGHER
                  : DIV_BASIC
    dividendTax = Math.round(taxable * divRate)
  } else if (extractionMethod === 'salary') {
    const PA          = 12_570
    const totalIncome = otherAnnualIncome + netCompanyProfit
    const taxRate     = totalIncome > HRL ? 0.45 : totalIncome > BRL ? 0.40 : 0.20
    const taxableSlice  = Math.max(0, netCompanyProfit - Math.max(0, PA - otherAnnualIncome))
    const nicBaseBand   = Math.max(0, Math.min(netCompanyProfit, Math.max(0, BRL - Math.max(otherAnnualIncome, PA))))
    const nicUpperBand  = Math.max(0, netCompanyProfit - Math.max(0, BRL - otherAnnualIncome))
    dividendTax = Math.round(taxableSlice * taxRate + nicBaseBand * 0.08 + nicUpperBand * 0.02)
  }

  const afterExtractionAnnual = netCompanyProfit - dividendTax
  return {
    companyTaxableProfit,
    corpTax,
    corpTaxRate: rate,
    netCompanyProfit,
    dividendTax,
    afterExtractionAnnual,
    afterExtractionMonthly: Math.round(afterExtractionAnnual / 12),
    mortgagePremiumAnnual,
    accountancyCostAnnual,
    extractionMethod,
  }
}

export function calcOwnershipComparison({
  annualRentalIncome,
  otherAnnualIncome,
  annualMortgageInterest,
  annualAllowableExpenses,
  mortgageLoan,
  spvRatePremiumPct,
  accountancyCostAnnual,
  extractionMethod,
}: {
  annualRentalIncome:      number
  otherAnnualIncome:       number
  annualMortgageInterest:  number
  annualAllowableExpenses: number
  mortgageLoan:            number
  spvRatePremiumPct:       number
  accountancyCostAnnual:   number
  extractionMethod:        ExtractionMethod
}): ToggleComparison {
  const s24 = calcSection24({
    annualRentalIncome,
    otherAnnualIncome,
    annualMortgageInterest,
    annualAllowableExpenses,
  })

  const grossTax = Math.max(0, s24.taxableRentalProfit *
    (s24.taxBand === 'additional' ? 0.45 : s24.taxBand === 'higher' ? 0.40 : 0.20)
  )
  const s24CreditAnnual = Math.round(Math.min(grossTax, annualMortgageInterest * 0.20))

  const personal = {
    ...s24,
    afterTaxMonthly: Math.round(s24.afterTaxCashIncome / 12),
    s24CreditAnnual,
  }

  const company = calcCompanyOwnership({
    annualRentalIncome,
    otherAnnualIncome,
    annualMortgageInterest,
    annualAllowableExpenses,
    mortgageLoan,
    spvRatePremiumPct,
    accountancyCostAnnual,
    extractionMethod,
  })

  const monthlyDiff = company.afterExtractionMonthly - personal.afterTaxMonthly
  const annualDiff  = monthlyDiff * 12
  const isBasicRate = s24.taxBand === 'basic'

  let verdict: ToggleComparison['verdict']
  let verdictReason: string

  if (Math.abs(monthlyDiff) < 30) {
    verdict = 'neutral'
    verdictReason = 'Minimal difference — personal ownership is usually simpler to manage'
  } else if (monthlyDiff > 0) {
    verdict = 'company'
    verdictReason = isBasicRate
      ? `Ltd company shows £${Math.abs(annualDiff).toLocaleString()}/yr benefit, but as a basic-rate taxpayer the admin overhead may not justify the saving`
      : `Ltd company saves approx £${Math.abs(annualDiff).toLocaleString()}/yr — typically worthwhile for higher/additional rate taxpayers`
  } else {
    verdict = 'personal'
    verdictReason = `Personal ownership is £${Math.abs(annualDiff).toLocaleString()}/yr ahead once the SPV mortgage premium and accountancy costs are factored in`
  }

  return { personal, company, monthlyDiff, annualDiff, verdict, verdictReason, isBasicRate }
}

// ── Investment Signals Calculator ─────────────────────────────────────────────
// Maps UK postcode area prefix → nearest city in MARKET_DATA
const POSTCODE_CITY: Record<string, string> = {
  // London inner
  'E':  'London', 'EC': 'London', 'N':  'London', 'NW': 'London',
  'SE': 'London', 'SW': 'London', 'W':  'London', 'WC': 'London',
  // London outer
  'BR': 'London', 'CR': 'London', 'DA': 'London', 'EN': 'London',
  'HA': 'London', 'IG': 'London', 'KT': 'London', 'RM': 'London',
  'SM': 'London', 'TN': 'London', 'TW': 'London', 'UB': 'London',
  'WD': 'London',
  // Manchester / Greater Manchester
  'M':  'Manchester', 'SK': 'Manchester', 'OL': 'Manchester',
  'BL': 'Manchester', 'WN': 'Manchester', 'WA': 'Manchester',
  // Liverpool / Merseyside
  'L':  'Liverpool', 'CH': 'Liverpool', 'PR': 'Liverpool',
  // Leeds / West Yorkshire
  'LS': 'Leeds', 'BD': 'Leeds', 'HX': 'Leeds', 'HG': 'Leeds', 'WF': 'Leeds',
  // Sheffield / South Yorkshire
  'S':  'Sheffield', 'DN': 'Sheffield',
  // Birmingham / West Midlands
  'B':  'Birmingham', 'CV': 'Birmingham', 'WS': 'Birmingham',
  'WV': 'Birmingham', 'DY': 'Birmingham',
  // Nottingham / East Midlands
  'NG': 'Nottingham', 'DE': 'Nottingham', 'LE': 'Nottingham',
  // Bristol / South West
  'BS': 'Bristol', 'BA': 'Bristol', 'GL': 'Bristol', 'SN': 'Bristol',
}

// Per postcode-area score adjustments relative to city baseline (d=demand s=supplyGap r=regen i=infra)
const OUTCODE_ADJ: Record<string, { d: number; s: number; r: number; i: number; area: string }> = {
  // Inner London — above city avg
  'EC': { d:  9, s: 12, r:  4, i:  9, area: 'East Central London'  },
  'WC': { d:  8, s: 11, r:  3, i:  8, area: 'West Central London'  },
  'W':  { d:  5, s:  4, r:  2, i:  6, area: 'West London'          },
  'SW': { d:  4, s:  3, r:  2, i:  4, area: 'South West London'    },
  'NW': { d:  3, s:  5, r:  5, i:  3, area: 'North West London'    },
  'N':  { d:  2, s:  4, r:  4, i:  2, area: 'North London'         },
  'E':  { d:  5, s:  8, r: 13, i:  3, area: 'East London'          },
  'SE': { d:  1, s:  3, r:  7, i:  1, area: 'South East London'    },
  // Outer London — below city avg
  'EN': { d:  -8, s:  -6, r:  -4, i:  -7, area: 'Enfield'          },
  'IG': { d: -10, s:  -8, r:  -6, i:  -9, area: 'Ilford/Redbridge' },
  'RM': { d: -12, s:  -7, r:  -5, i: -10, area: 'Romford'          },
  'DA': { d: -11, s:  -6, r:   3, i:  -8, area: 'Bexley/Dartford'  },
  'CR': { d:  -9, s:  -5, r:  -3, i:  -6, area: 'Croydon'          },
  'BR': { d: -10, s:  -4, r:  -4, i:  -7, area: 'Bromley'          },
  'TW': { d:  -7, s:  -3, r:  -2, i:  -5, area: 'Twickenham'       },
  'KT': { d:  -6, s:  -2, r:  -2, i:  -4, area: 'Kingston'         },
  'HA': { d:  -9, s:  -6, r:  -3, i:  -6, area: 'Harrow'           },
  'UB': { d:  -8, s:  -5, r:   2, i:  -5, area: 'Hillingdon'       },
  'WD': { d: -11, s:  -7, r:  -5, i:  -8, area: 'Watford'          },
  'SM': { d:  -8, s:  -4, r:  -3, i:  -6, area: 'Sutton/Merton'    },
  // Greater Manchester periphery
  'SK': { d:  -5, s:  -3, r:  -4, i:  -5, area: 'Stockport'        },
  'OL': { d:  -8, s:  -4, r:  -5, i:  -7, area: 'Oldham'           },
  'BL': { d:  -9, s:  -5, r:  -6, i:  -8, area: 'Bolton'           },
  'WN': { d: -10, s:  -6, r:  -7, i:  -9, area: 'Wigan'            },
  'WA': { d:  -7, s:  -4, r:  -5, i:  -6, area: 'Warrington'       },
  // West Yorkshire periphery
  'BD': { d:  -6, s:  -3, r:  -4, i:  -6, area: 'Bradford'         },
  'HX': { d:  -8, s:  -5, r:  -6, i:  -8, area: 'Halifax'          },
  'HG': { d:  -5, s:  -4, r:  -5, i:  -6, area: 'Harrogate'        },
  'WF': { d:  -6, s:  -4, r:  -5, i:  -7, area: 'Wakefield'        },
  // South Yorkshire periphery
  'DN': { d:  -5, s:  -3, r:  -4, i:  -5, area: 'Doncaster'        },
  // West Midlands periphery
  'CV': { d:  -5, s:  -3, r:  -4, i:  -5, area: 'Coventry'         },
  'WS': { d:  -6, s:  -4, r:  -5, i:  -6, area: 'Walsall'          },
  'WV': { d:  -7, s:  -5, r:  -6, i:  -7, area: 'Wolverhampton'    },
  'DY': { d:  -6, s:  -4, r:  -4, i:  -6, area: 'Dudley'           },
  // East Midlands periphery
  'DE': { d:  -4, s:  -2, r:  -3, i:  -4, area: 'Derby'            },
  'LE': { d:  -3, s:  -2, r:  -2, i:  -3, area: 'Leicester'        },
  // South West periphery
  'BA': { d:  -5, s:  -3, r:  -4, i:  -5, area: 'Bath'             },
  'GL': { d:  -7, s:  -5, r:  -6, i:  -7, area: 'Gloucester'       },
  'SN': { d:  -8, s:  -6, r:  -7, i:  -8, area: 'Swindon'          },
}

function _postcodeArea(postcode: string): string {
  const outcode = postcode.trim().toUpperCase().split(/\s+/)[0] ?? ''
  return outcode.replace(/\d.*$/, '') // strip from first digit onward
}

function _clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

function _signalLabel(score: number): string {
  if (score >= 90) return 'Very Strong'
  if (score >= 75) return 'Strong'
  if (score >= 60) return 'Good'
  if (score >= 45) return 'Moderate'
  return 'Weak'
}

export interface InvestmentSignalInput {
  postcode: string
  cityName: string
}

export interface SignalScore {
  score: number
  label: string
  source: string
  confidence: number
}

export interface InvestmentSignals {
  demand:         SignalScore
  supplyGap:      SignalScore
  regeneration:   SignalScore
  infrastructure: SignalScore
  sourceLevel:    'outcode' | 'city' | 'national'
  areaDescription: string
}

export function calculateInvestmentSignals({ postcode, cityName }: InvestmentSignalInput): InvestmentSignals {
  const prefix   = _postcodeArea(postcode)
  const outAdj   = OUTCODE_ADJ[prefix]
  const mappedCity = POSTCODE_CITY[prefix] || cityName
  const baseCity = MARKET_DATA.cities[mappedCity as keyof typeof MARKET_DATA.cities]
    || MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]

  const hasOutcodeAdj = !!outAdj && !!prefix
  const sourceLevel   = hasOutcodeAdj ? 'outcode' : (baseCity ? 'city' : 'national')
  const confidence    = hasOutcodeAdj ? 85 : baseCity ? 70 : 50

  // Base scores from city data (supply gap = inverted supply score)
  const baseDemand   = baseCity?.demandScore         ?? 75
  const baseSupplyGap = baseCity ? (100 - baseCity.supplyScore) : 62
  const baseRegen    = baseCity?.regenerationScore   ?? 65
  const baseInfra    = baseCity?.infrastructureScore ?? 70

  const demandScore   = _clamp(baseDemand    + (outAdj?.d ?? 0))
  const supplyScore   = _clamp(baseSupplyGap + (outAdj?.s ?? 0))
  const regenScore    = _clamp(baseRegen     + (outAdj?.r ?? 0))
  const infraScore    = _clamp(baseInfra     + (outAdj?.i ?? 0))

  const areaName = outAdj?.area ?? mappedCity ?? cityName
  const outcode  = postcode.trim().toUpperCase().split(/\s+/)[0] ?? ''
  const sourceDesc = hasOutcodeAdj
    ? `Local area data · ${areaName}`
    : `City-level data · ${mappedCity || cityName}`

  if (process.env.NODE_ENV === 'development') {
    console.debug('[investment-signals]', {
      postcode, prefix, outcode, mappedCity, sourceLevel, areaName,
      demandScore, supplyGapScore: supplyScore, regenScore, infraScore,
    })
  }

  const make = (score: number): SignalScore => ({
    score,
    label: _signalLabel(score),
    source: sourceDesc,
    confidence,
  })

  const areaDescription = hasOutcodeAdj
    ? `${outcode}${areaName !== outcode ? `, ${areaName}` : ''}${cityName ? `, ${cityName}` : ''}`
    : (cityName || 'UK Average')

  return {
    demand:         make(demandScore),
    supplyGap:      make(supplyScore),
    regeneration:   make(regenScore),
    infrastructure: make(infraScore),
    sourceLevel,
    areaDescription,
  }
}

// ── HMO ROOM RENT DATA ─────────────────────────────────────────────────────
export const HMO_ROOM_RENTS: Record<string, {
  single: number
  double: number
  ensuite: number
}> = {
  London:     { single: 900,  double: 1050, ensuite: 1200 },
  Manchester: { single: 580,  double: 680,  ensuite: 780  },
  Birmingham: { single: 520,  double: 620,  ensuite: 720  },
  Liverpool:  { single: 480,  double: 560,  ensuite: 650  },
  Leeds:      { single: 550,  double: 640,  ensuite: 740  },
  Sheffield:  { single: 480,  double: 570,  ensuite: 660  },
  Nottingham: { single: 500,  double: 590,  ensuite: 680  },
  Bristol:    { single: 680,  double: 780,  ensuite: 880  },
}

export const HMO_MIN_ROOM_SIZES = {
  singleAdult:  6.51,
  twoAdults:    10.22,
  childUnder10: 4.64,
  absoluteMin:  4.64,
}
