STRICT IMPLEMENTATION SPECIFICATION — DEAL FINDER KPI DRILL-DOWN LISTS, LIVE LISTING ROW CARDS, AND PROPERTY ANALYSIS OVERRIDES

ROLE:
Act as a senior frontend engineer, product engineer, and elite UX/UI designer.

OBJECTIVE:
Enhance the Deal Finder page so KPI cards are interactive drill-down entry points.

When a user clicks:
1. Top Deals KPI card
   → show a dedicated list of properties that generated the Top Deals count.

2. New Listings KPI card
   → show a dedicated list of properties that generated the New Listings count.

The drill-down lists must:
- use live listing data from Homedata
- show one property per row
- look modern, clear, premium, and consistent with the Portfolai brand
- remain fully interactive
- allow the user to click a property and open the Property Analysis page
- preserve live listing asking price and live listing property attributes where available

CRITICAL NON-NEGOTIABLE RULE:
Do not change the working valuation engine, EPC mapping, bedroom/bathroom inference, Homedata integration, Land Registry logic, or existing calculations outside this requested Deal Finder drill-down behaviour.

Only modify:
- Deal Finder KPI click behaviour
- Deal Finder drill-down list rendering
- Deal Finder result filtering for Top Deals and New Listings
- live listing result card/row UI
- Property Analysis context handling when opened from a live listing
- asking price / live listing attribute overrides where available

==================================================
1. KPI CARD CLICK BEHAVIOUR
==================================================

The following KPI cards must become clickable:

A. Top Deals
B. New Listings

Each card must have:
- cursor pointer
- hover state
- active/focus state
- accessible button semantics
- keyboard activation support

Do not make KPI cards look like static metrics if they are clickable.

Recommended markup:

<button
  type="button"
  onClick={() => openDealFinderDrilldown('top_deals')}
  className="kpi-card"
  aria-label="View top deal properties"
>
  ...
</button>

<button
  type="button"
  onClick={() => openDealFinderDrilldown('new_listings')}
  className="kpi-card"
  aria-label="View newly listed properties"
>
  ...
</button>

==================================================
2. DRILL-DOWN VIEW STATE
==================================================

Create a clear state model for the drill-down mode.

Recommended state:

type DealFinderDrilldownType = 'top_deals' | 'new_listings' | null

const [activeDrilldown, setActiveDrilldown] =
  useState<DealFinderDrilldownType>(null)

When Top Deals is clicked:

setActiveDrilldown('top_deals')

When New Listings is clicked:

setActiveDrilldown('new_listings')

The page should then render the corresponding list.

==================================================
3. DRILL-DOWN PAGE / PANEL BEHAVIOUR
==================================================

When a KPI is clicked, the user should see a dedicated results list.

Acceptable implementations:
- same page section below KPI cards
- route query state such as /deal-finder?view=top-deals
- slide-in panel only if enough space and clear UX

Preferred implementation:
Use the same Deal Finder page and update the main content area.

Example:

if activeDrilldown === 'top_deals':
  show Top Deals list

if activeDrilldown === 'new_listings':
  show New Listings list

Add a back/reset control:

← Back to Deal Finder overview

==================================================
4. TOP DEALS LIST DEFINITION
==================================================

Top Deals list must show the properties that generated the Top Deals KPI.

A property qualifies as a Top Deal if it meets the app’s existing deal scoring logic or, if no explicit deal score exists, the following fallback criteria.

Preferred:
Use existing dealScore field if available.

Top Deal criteria:
- dealScore >= 70
OR
- grossYield >= user threshold
OR
- netYield >= user threshold
OR
- totalROI >= user threshold
OR
- asking price below estimated current value where both exist
OR
- cashflow positive where cashflow exists

Sort order:
1. highest dealScore
2. highest net yield
3. highest total ROI
4. highest monthly cashflow
5. most recent listing

Do not fabricate top deals.
Only list properties from the live listing result pool.

==================================================
5. NEW LISTINGS LIST DEFINITION
==================================================

New Listings list must show properties that generated the New Listings KPI.

A property qualifies as a New Listing if it is returned from Homedata live listings and has a recent listed/added date.

Use Homedata fields where available:
- added_date
- listed_date
- created_at
- first_seen_date

Preferred field:
added_date

Default new listing window:
30 days

If the existing KPI uses a different window, use the same window as the KPI.

Sort order:
1. newest added_date first
2. then highest dealScore
3. then highest net yield

Do not include old listings if they do not match the New Listings KPI definition.

==================================================
6. DATA SOURCE REQUIREMENT
==================================================

The drill-down lists must use the same Homedata live listing data source powering Deal Finder.

Do not use:
- static mock data
- hardcoded properties
- Land Registry-only data
- old recently viewed records
- random fallback properties

The list should be generated from:

/api/deal-finder/live-listings

or the existing internal live listing endpoint if already implemented.

Frontend must not call Homedata directly.

==================================================
7. DRILL-DOWN RESULT HEADER
==================================================

Each drill-down list must have a clear header.

For Top Deals:

Title:
Top Deals

Subtitle:
Properties ranked highest by investment fit, yield, ROI, pricing and risk profile.

Counter:
44 properties

For New Listings:

Title:
New Listings

Subtitle:
Recently listed properties from live Homedata listing data.

Counter:
43 properties

Also include:
- sort dropdown
- optional filter chips
- back button
- refresh button if supported

==================================================
8. DRILL-DOWN LIST DESIGN REQUIREMENT
==================================================

The drill-down list must be clear, modern, spacious and consistent with the Portfolai brand.

Use:
- warm off-white page background
- white cards
- rounded 18px–22px corners
- subtle border #E7E5DD
- soft shadows
- emerald action buttons
- gold highlights for high-opportunity metrics
- serif section headings
- clean sans-serif body text

Do not use:
- dark cards
- cramped table rows
- tiny text
- excessive metrics
- old dark property card design

==================================================
9. ONE PROPERTY PER ROW REQUIREMENT
==================================================

Each drill-down result must display one property per row.

Desktop layout per row:

[Image] [Core property info + badges] [Financial metrics] [Deal score / status] [Actions]

Recommended grid:

grid-template-columns:
180px minmax(260px, 1.5fr) minmax(360px, 2fr) 140px 160px

Each property row should be approximately:
- min-height: 180px
- padding: 18px–22px
- gap: 18px
- full width of content area

Do not use 3 cards per row in KPI drill-down lists.
The KPI drill-down list must use row cards for readability.

==================================================
10. PROPERTY ROW CARD CONTENT
==================================================

Each property row must include enough information for a deal-focused user without overcrowding.

Required visual content:
- listing image
- image fallback if no image exists
- property address
- postcode/location
- property type
- bedrooms
- bathrooms if available
- EPC rating if available
- tenure if available

Required financial content:
- asking price where available
- estimated current value as reference where available
- estimated monthly rent
- gross yield
- net yield
- total ROI
- monthly cashflow if available
- deal score
- confidence badge
- risk badge

Required actions:
- View Analysis
- Save
- Ask AI
- Compare, optional if already supported

==================================================
11. PROPERTY ROW CARD CROWDING RULE
==================================================

The row must not be crowded.

Display key metrics as a clean grid:

Metric grid:
- Asking Price
- Est. Value
- Gross Yield
- Net Yield
- ROI
- Cashflow

Use badges for:
- EPC
- Risk
- Confidence
- Below Market Value
- New Listing
- Reduced

Do not show long descriptions by default.

If description is needed:
- show max 1 short line
- truncate with ellipsis
- allow expand/details if supported

==================================================
12. PROPERTY IMAGE REQUIREMENT
==================================================

Use live listing image from Homedata where available.

Possible image fields:
- images[0]
- image_url
- imageUrl
- thumbnail
- media[0].url

If no image exists:
show a clean branded placeholder:
- soft emerald background
- small house icon
- text: No image available

Do not leave broken image icons.

==================================================
13. ROW INTERACTIVITY REQUIREMENT
==================================================

Each property row must be interactive.

User interactions:

A. Clicking the row:
opens Property Analysis page for that listing.

B. Clicking View Analysis:
opens Property Analysis page for that listing.

C. Clicking Save:
saves/favourites the listing using existing save behaviour.

D. Clicking Ask AI:
opens AI Analysis using that property context, if currently supported.

E. Clicking Compare:
adds to compare flow if currently supported.

Prevent event conflicts:
- action buttons must call e.stopPropagation()
- clicking Save must not accidentally open Property Analysis unless intended

==================================================
14. OPEN PROPERTY ANALYSIS FROM DRILL-DOWN RESULT
==================================================

When a property is opened from Top Deals or New Listings:

1. Preserve the full normalized live listing object.
2. Pass it into Property Analysis.
3. Mark source context:

sourceContext = 'homedata_live_listing'

4. Preserve:
- liveListingAskingPrice
- liveListingPriceSource
- liveListingAttributes
- listingUrl
- imageUrl
- raw Homedata listing reference if already used

Recommended payload:

{
  sourceContext: 'homedata_live_listing',
  property: normalizedProperty,
  liveListing: normalizedListing,
  liveListingAskingPrice: normalizedListing.askingPrice,
  liveListingPriceSource: normalizedListing.askingPriceSource,
  liveListingAttributes: {
    bedrooms,
    bathrooms,
    propertyType,
    floorAreaSqm,
    epcRating,
    tenure,
    imageUrl,
    listingUrl
  }
}

==================================================
15. ASKING PRICE OVERRIDE RULE
==================================================

For properties opened from Deal Finder drill-down lists:

If asking price exists in the Homedata live listing:
asking price must override Estimated Current Value as the active purchase price basis in Property Analysis.

This applies only when:

sourceContext === 'homedata_live_listing'
AND liveListingAskingPrice > 0

Do not globally overwrite the AVM.

Do not change estimated current value calculation.

Do not remove estimated current value.

Instead, display both where possible:

Primary purchase price:
Asking Price
£485,000

Reference valuation:
Estimated Current Value
£515,000

Difference:
£30,000 below estimated value

==================================================
16. PROPERTY ANALYSIS FINANCIAL CALCULATION BASIS
==================================================

For Deal Finder-origin properties with asking price:

Gross Yield must use asking price.

Net Yield must use asking price.

ROI must use asking price.

Cashflow must use asking price where purchase price is needed.

If asking price is missing:
fall back to existing Property Analysis logic.

This override must not affect normal Property Analysis searches.

==================================================
17. LIVE LISTING ATTRIBUTE OVERRIDE RULE
==================================================

For sale properties opened from Deal Finder / Homedata live listings:

Where live listing property attributes are available, they must override missing or weaker Property Analysis attributes.

This applies to displayed attributes only and calculation inputs where those inputs are directly dependent on property attributes.

Live listing attributes that may override:

- bedrooms
- bathrooms
- property type
- tenure
- floor area
- EPC rating
- garden
- parking
- listing image
- listing status
- asking price
- listing URL

Override rule:

If live listing attribute exists and is valid:
use live listing attribute.

If live listing attribute is missing/null/invalid:
fall back to existing Property Analysis data.

Do not overwrite existing verified data with null.

==================================================
18. ATTRIBUTE VALIDATION BEFORE OVERRIDE
==================================================

Before using a live listing attribute, validate it.

Examples:

bedrooms:
must be number > 0 and <= 12

bathrooms:
must be number > 0 and <= 10

askingPrice:
must be number > 0

floorAreaSqm:
must be number > 10

EPC rating:
must match A-G

propertyType:
must be non-empty string

Do not override good existing data with:
- null
- undefined
- empty string
- 0
- invalid value
- unknown

==================================================
19. ATTRIBUTE SOURCE LABELLING
==================================================

Where attributes come from the live listing, optionally label source in UI.

Example:
Bedrooms: 3
Source: Live listing

Or tooltip:
Provided by Homedata live listing

Do not clutter the UI.
Use subtle tooltips or small badges only.

==================================================
20. TOP DEALS / NEW LISTINGS FILTER CONSISTENCY
==================================================

The KPI count and the drill-down list must match.

If Top Deals KPI says:
44

Then Top Deals drill-down should show:
44 properties

If New Listings KPI says:
43

Then New Listings drill-down should show:
43 properties

If pagination is used:
Header may say:
Showing 20 of 43 new listings

Do not show mismatched counts unless explained by pagination.

==================================================
21. SORTING IN DRILL-DOWN LISTS
==================================================

Top Deals default sort:
Best Deal Score

New Listings default sort:
Newest Listed

Available sort options:
- Best Deal Score
- Newest Listed
- Highest Gross Yield
- Highest Net Yield
- Highest ROI
- Highest Cashflow
- Lowest Asking Price
- Lowest Risk

==================================================
22. EMPTY STATE
==================================================

If KPI list has no properties:

Top Deals empty state:
No top deals found
Try widening the search area, lowering your yield target, or increasing your budget.

New Listings empty state:
No new listings found
Try widening your location or checking again later.

Do not show fake properties.

==================================================
23. LOADING STATE
==================================================

When drilling into a KPI list:
- show skeleton row cards
- keep page layout stable
- show loading label:
Loading top deals...
or
Loading new listings...

Do not flash old unrelated results.

==================================================
24. ERROR STATE
==================================================

If live listing data fails:
Show:
Unable to load listings

Subtext:
Please try again. If the issue continues, check the live listing data connection.

Do not crash page.
Do not show fake data.

==================================================
25. DESIGN DETAILS FOR DRILL-DOWN ROW
==================================================

Suggested row layout:

┌────────────────────────────────────────────────────────────────────────────┐
│ [Image 180x140]  121 Albany Park Avenue, Enfield EN3 5NX        Score 84  │
│                Terraced · 3 bed · 1 bath · EPC C · Freehold              │
│                                                                            │
│ Asking Price   Est. Value    Gross Yield   Net Yield   ROI   Cashflow      │
│ £485,000       £515,000      7.2%          5.6%        18.4% £326/mo       │
│                                                                            │
│ [High confidence] [Low risk] [Below market] [New listing]                  │
│                                                                            │
│                                     [View Analysis] [Save] [Ask AI]        │
└────────────────────────────────────────────────────────────────────────────┘

==================================================
26. RESPONSIVE BEHAVIOUR
==================================================

Desktop:
- one row per property
- image left
- metrics centre/right
- actions right

Tablet:
- one row per property
- image left
- metrics wrap below title
- actions below metrics

Mobile:
- card becomes vertical
- image full width
- metrics in two-column grid
- actions full width

==================================================
27. FILE-SCOPE PROTECTION
==================================================

Allowed to modify:
- Deal Finder page/component
- Deal Finder KPI card click handlers
- Deal Finder drill-down view state
- Deal Finder result list component
- Deal Finder row card component
- Deal Finder filtering/sorting of already-loaded live listing pool
- Property Analysis opening context from Deal Finder
- Property Analysis price basis resolver for live listing context
- Property Analysis attribute resolution for live listing context
- shared formatters/display helpers if needed

Do NOT modify:
- core AVM valuation engine
- existing estimated current value calculation
- EPC API mapping
- bedroom/bathroom inference engines
- Land Registry logic
- Homedata API route except if required to return live listing fields already available
- portfolio persistence
- saved/favourites persistence
- database schema
- unrelated pages
- global design system unless needed for row-card styling

==================================================
28. ACCEPTANCE TESTS
==================================================

Test 1 — Top Deals KPI click:
Click Top Deals KPI card.

Expected:
- drill-down list opens
- title says Top Deals
- list shows properties that generated the Top Deals count
- one property per row
- no unrelated/random properties shown

==================================================

Test 2 — New Listings KPI click:
Click New Listings KPI card.

Expected:
- drill-down list opens
- title says New Listings
- list shows newly listed properties that generated the New Listings count
- sorted newest first

==================================================

Test 3 — Row card layout:
Open drill-down list.

Expected:
- each property is one row
- listing image visible
- asking price visible where available
- location visible
- ROI visible
- gross yield visible
- net yield visible
- relevant badges visible
- card is not overcrowded

==================================================

Test 4 — Open Property Analysis:
Click a drill-down property row.

Expected:
- Property Analysis opens for that property
- live listing context is preserved
- asking price is passed through if available

==================================================

Test 5 — Asking price override:
Live listing has:
askingPrice = 485000
estimatedCurrentValue = 515000

Expected in Property Analysis:
- active purchase price uses £485,000
- estimated current value remains visible as reference
- yield/ROI calculations use £485,000

==================================================

Test 6 — No asking price:
Live listing has no asking price.

Expected:
- Property Analysis uses existing estimated current value logic
- no fake asking price is created

==================================================

Test 7 — Attribute override:
Live listing has:
bedrooms = 3
bathrooms = 1
propertyType = Terraced
epcRating = C

Expected:
- Property Analysis uses these live listing attributes where available
- invalid/missing live listing attributes do not overwrite verified data

==================================================

Test 8 — Count consistency:
Top Deals KPI shows 44.

Expected:
Top Deals drill-down header shows 44 properties or "Showing X of 44" if paginated.

New Listings KPI shows 43.

Expected:
New Listings drill-down header shows 43 properties or "Showing X of 43" if paginated.

==================================================

Test 9 — No data regression:
Existing Deal Finder overview still works.
Existing Property Analysis still works.
Normal Property Analysis searches are unaffected.
Existing good data remains unchanged.
