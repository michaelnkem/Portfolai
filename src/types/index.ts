export interface InvestorProperty {
  // Core identity
  id: string
  uprn?: string
  address: string
  city: string
  postcode: string

  // Property attributes
  type: string
  beds: number
  baths?: number
  sqm?: number
  sqft?: number
  built?: string
  tenure?: string
  leaseYears?: number
  epcRating?: string
  epcScore?: number
  councilTaxBand?: string
  hasGarden?: boolean
  hasParking?: boolean

  // Financials — user-entered
  price: number
  monthlyRent: number
  serviceCharge?: number   // annual
  groundRent?: number      // annual
  managementFee?: number   // percentage
  maintenanceAllowance?: number // percentage of price
  voidWeeks?: number

  // Computed
  grossYield?: number
  netYield?: number
  capitalGrowth?: number   // city 1yr avg
  totalROI?: number
  netMonthly?: number
  pricePerSqft?: number

  // Homedata enrichment
  lastSoldPrice?: number
  lastSoldDate?: string
  latitude?: number
  longitude?: number
  floodRisk?: string
  transactions?: Array<{ date: string; price: number; transaction_type: string }>

  // UI
  img?: string
  tags?: string[]
  investmentHighlights?: string[]
  risks?: string[]
  nearbyComps?: Array<{ address: string; price: number; date: string }>

  // Comparison
  cityAvgYield?: number
  yieldVsArea?: number
  priceVsArea?: number
}

export interface PortfolioEntry {
  property: InvestorProperty
  purchasePrice: number
  purchaseDate: string
  deposit: number
  mortgageRate?: number
  mortgageTerm?: number
  notes?: string
}

export type SortKey = 'totalROI' | 'grossYield' | 'netYield' | 'capitalGrowth' | 'price' | 'netMonthly'

export interface FilterState {
  minYield: number
  maxPrice: number
  cities: string[]
  minBeds: number
  propertyTypes: string[]
  searchQuery: string
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}
