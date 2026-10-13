# Planted layout mutations

Each JSON file in `mutations/<case-id>/` is one self-contained change to a baseline site: `css` is appended in a `<style>` at the end of `<head>`; `js` (if any) runs once after DOMContentLoaded. `kind` is `defect` or `harmless`.

- booking-baseline: 14 defects, 4 harmless
- dashboard-baseline: 14 defects, 4 harmless
- carsearch-baseline: 13 defects, 4 harmless
- booking-clean: 3 defects, 1 harmless
- carsearch-clean: 3 defects, 1 harmless
- dashboard-clean: 3 defects, 1 harmless

Tools:

- `_tools/build-items.mjs` regenerates all item files and this README.
- `_tools/preview.mjs <case> <item-id|baseline|all> [--vp=..] [--fixture=..] [--base]` serves the case, applies the item and writes screenshots to `_previews/<case>/`.

## Clean bases

The `*-clean` folders plant defects into the clean controls (`cases/*-clean`), which have no material weakness in any category. Each defect is a material Layout weakness, so a sound judge scores the variant below its clean base; each harmless change should leave the Layout score unchanged. `mutations-typography/`, `mutations-task-fit/` and `mutations-content-quality/` have clean-base folders built the same way for their own categories.

## Judging planted variants

`--judge` collects as usual, then judges the clean control and every variant for real, in the folder's category (Layout for `mutations/`, otherwise the one in the folder name; `--category` overrides). With `--rescore <runId>` it judges a previous run's evidence without collecting again:

```
npm run mutate -- booking-clean carsearch-clean dashboard-clean --judge
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-typography --judge
npm run mutate -- --rescore <runId> --dir mutations-typography --judge
```

Each control is judged 5 times (`--base-repeats`) and each variant 3 times (`--repeats`); `--provider`, `--model`, `--effort` and `--prompt` are as for `npm run judge`, and `--provider mock` checks the harness for free. The expected direction comes from the file name alone: a `harmless-*` variant should score the same as its control (means within half a point, compare's `no_change`), a `minor-*` defect, which the judges consistently find minor, should not score more than half a point higher (`no_rise`), and anything else lower (compare's `must_drop`: a lower mean, with at least 80% of control × variant score pairs not higher). A miss with fewer than 3 valid scores on either side reads "needs more repeats".

The judge sees what any interface's judge sees: the base case's request and an opaque interface ID. Before any call, every prompt is checked for the case name and the variant's file name, title and symptom. Results go to `artifacts/mutations/<runId>/judge/<judge run>/` (`report.json`, the requests and judgments), not `artifacts/runs/`, so variants never appear in the viewer or on the rating site.

| Case | Id | Kind | Severity | Where | Title |
| --- | --- | --- | --- | --- | --- |
| booking-baseline | action-bar-covers-notes | defect | moderate | phone; 320–767 px; after: Scroll to the bottom of the page | Fixed action bar covers the end of the form |
| booking-baseline | action-bar-ignores-safe-area | defect | moderate | phone; 320–767 px | Bottom action bar ignores the safe-area inset |
| booking-baseline | option-grid-two-col-phone | defect | moderate | phone; 320–767 px | Treatment cards stay in two columns on phones |
| booking-baseline | layout-min-width-overflow | defect | severe | tablet; 768–867 px | Two-column layout forces horizontal scrolling on tablets |
| booking-baseline | slot-touch-targets-tiny | defect | minor | tablet/phone; 320–1023 px | Time-slot buttons shrink to tiny tap targets |
| booking-baseline | field-errors-overlap-labels | defect | moderate | desktop/tablet/phone; after: Press "Confirm booking" with the form empty, then look at the "Your details" section | Validation messages overlap the next field |
| booking-baseline | date-strip-clipped-phone | defect | severe | phone; 320–767 px | Date strip cannot be scrolled on phones |
| booking-baseline | sticky-header-covers-summary | defect | moderate | desktop/tablet; 768–1920 px; after: Scroll down the page by ~700 px | Sticky header hides the top of the sticky summary |
| booking-baseline | header-overflow-narrow-phone | defect | moderate | phone; 320–384 px | Header overflows on narrow phones |
| booking-baseline | late-promo-banner-shift | defect | moderate | desktop/tablet/phone; after: Watch the first 1-2 seconds after load | Late banner pushes the page down after load |
| booking-baseline | summary-row-nowrap-expanded | defect | moderate | desktop/tablet; 768–1920 px; expanded/stress; after: Select a treatment (and a time) | Summary values overflow the summary card with long text |
| booking-baseline | form-sections-no-separation | defect | minor | desktop/tablet/phone | Form steps run together with no separation |
| booking-baseline | confirm-missing-tablet-band | defect | severe | tablet; 768–1023 px | No Confirm button at tablet widths |
| booking-baseline | inputs-content-box-overflow | defect | minor | desktop/tablet/phone | Text inputs are wider than their fields |
| booking-baseline | harmless-retheme-blue | harmless | none | desktop/tablet/phone | Brand colour changed to blue |
| booking-baseline | harmless-date-strip-scroller | harmless | none | desktop/tablet; 768–1920 px; dense | Date picker becomes a horizontal scroller on larger screens |
| booking-baseline | harmless-desc-line-clamp | harmless | none | desktop/tablet/phone | Treatment descriptions clamped to two lines |
| booking-baseline | harmless-sticky-header-offset | harmless | none | desktop/tablet/phone; after: Scroll down the page | Sticky header with the summary offset below it |
| dashboard-baseline | kpi-min-width-overlap-band | defect | moderate | no fixed viewport; 1440–1559 px | KPI cards overlap each other in a narrow desktop band |
| dashboard-baseline | kpi-label-clipped | defect | minor | phone; 320–767 px; expanded/stress | KPI labels cut off without an ellipsis |
| dashboard-baseline | order-panel-offscreen-phone | defect | severe | phone; 320–767 px; after: Tap an order in "Recent orders" | Order panel wider than the phone screen |
| dashboard-baseline | scrim-above-order-panel | defect | severe | desktop/tablet/phone; after: Click an order in "Recent orders" | Dimmed backdrop covers the order panel |
| dashboard-baseline | topbar-covers-drawer | defect | severe | tablet/phone; 320–1023 px; after: Tap the menu (hamburger) button | Top bar is stacked above the navigation drawer |
| dashboard-baseline | chart-y-axis-too-narrow | defect | moderate | desktop/tablet/phone | Revenue axis labels spill into the chart |
| dashboard-baseline | chart-x-labels-unanchored | defect | minor | desktop/tablet/phone | Chart x-axis labels are off-centre from their points |
| dashboard-baseline | orders-table-nowrap-overflow | defect | moderate | tablet; 768–889 px; stress | Orders table overflows its card at tablet width |
| dashboard-baseline | product-name-nowrap | defect | moderate | desktop/phone; dense/stress | Long product names push revenue out of the card |
| dashboard-baseline | sidebar-fixed-overlaps-main | defect | moderate | desktop; 1024–1920 px | Fixed sidebar covers the left edge of the content |
| dashboard-baseline | chart-late-render-shift | defect | moderate | desktop/tablet/phone; after: Watch the first 1-2 seconds after load | Chart appears late and shoves the page down |
| dashboard-baseline | segmented-overflow-phone | defect | moderate | phone; 320–767 px; expanded/stress | Date-range control overflows the phone screen with long labels |
| dashboard-baseline | orders-list-cramped-phone | defect | minor | phone; 320–767 px | Mobile order list loses its row separation |
| dashboard-baseline | drawer-peeks-when-closed | defect | minor | tablet/phone; 320–1023 px | Closed navigation drawer still peeks in from the left |
| dashboard-baseline | harmless-accent-teal | harmless | none | desktop/tablet/phone | Accent colour changed to teal |
| dashboard-baseline | harmless-product-name-ellipsis | harmless | none | desktop/tablet/phone; dense/stress | Long product names truncated with an ellipsis |
| dashboard-baseline | harmless-orders-table-scroller | harmless | none | tablet; 768–1100 px | Orders table scrolls sideways inside its card |
| dashboard-baseline | harmless-kpi-accent-rule | harmless | none | desktop/tablet/phone | KPI cards get a coloured top rule |
| carsearch-baseline | grid-min-card-width-overflow | defect | severe | tablet/phone; 320–1269 px | Results grid keeps three 300 px columns |
| carsearch-baseline | car-image-cropped-phone | defect | moderate | phone; 320–767 px | Car photos cropped to a thin strip on phones |
| carsearch-baseline | compare-bar-offscreen-expanded | defect | severe | phone; 320–767 px; expanded/stress; after: Tick "Compare" on two cars | Compare bar runs off the phone screen with long text |
| carsearch-baseline | filters-drawer-footer-unreachable | defect | severe | phone; 320–767 px; after: Tap "Filters" to open the filter drawer | Filter drawer footer pushed off the bottom of the screen |
| carsearch-baseline | header-search-fixed-basis | defect | moderate | tablet; 768–849 px | Header search box too wide at small tablet widths |
| carsearch-baseline | active-chips-nowrap | defect | moderate | desktop/tablet/phone; after: Apply several filters (all makes, max price, mileage, fuel, gearbox) | Active filter chips squashed onto one line |
| carsearch-baseline | trim-fixed-height-overlap | defect | moderate | tablet; 768–820 px; expanded/stress | Wrapped trim text overlaps the price |
| carsearch-baseline | car-location-nowrap-hides-compare | defect | moderate | desktop/tablet/phone; expanded/stress | Long location text hides the Compare checkbox |
| carsearch-baseline | grid-gap-collapsed | defect | minor | desktop/tablet; 768–1920 px | Result cards almost touch side by side |
| carsearch-baseline | car-images-late-size-shift | defect | moderate | desktop/tablet/phone; after: Watch the first 1-2 seconds after load | Car images appear late and push the listings down |
| carsearch-baseline | empty-actions-grid-overflow | defect | moderate | tablet/phone; 320–840 px; empty | Empty-state buttons overflow on small screens |
| carsearch-baseline | compare-bar-above-filters-drawer | defect | moderate | phone; 320–767 px; after: Tick "Compare" on two cars, then open Filters | Compare bar sits on top of the filter drawer |
| carsearch-baseline | save-buttons-escape-image | defect | severe | desktop/tablet/phone | Save (heart) buttons pile up in the page corner |
| carsearch-baseline | harmless-green-theme | harmless | none | desktop/tablet/phone | Primary colour changed to green |
| carsearch-baseline | harmless-deal-badge-on-image | harmless | none | desktop/tablet/phone | Deal badge overlaid on the car photo |
| carsearch-baseline | harmless-trim-ellipsis | harmless | none | desktop/tablet/phone; stress | Trim line truncated with an ellipsis |
| carsearch-baseline | harmless-chips-scroller-phone | harmless | none | phone; 320–767 px; after: Apply several filters | Active filter chips scroll sideways on phones |
| booking-clean | date-strip-overflows-phone | defect | severe | phone; 320–639 px | Dates and times run off the side of phone screens |
| booking-clean | treatment-list-clipped | defect | severe | desktop/tablet/phone | Treatment list cut off after two options |
| booking-clean | grouping-inverted | defect | moderate | desktop/tablet/phone | Headings and labels sit closer to the previous item than to their own |
| booking-clean | harmless-roomier-form | harmless | none | desktop; 1024–1920 px | More room inside the form on wide screens |
| carsearch-clean | prices-and-ratings-cut-off | defect | severe | desktop/tablet/phone | Prices and price ratings cut off on every car |
| carsearch-clean | results-overlap-filters | defect | severe | desktop; 1024–1920 px | Results slide over the filter panel on desktop |
| carsearch-clean | search-form-overflows-phone | defect | moderate | phone; 320–767 px | Postcode search runs off the side of phone screens |
| carsearch-clean | harmless-card-padding | harmless | none | desktop/tablet/phone | More padding inside the car cards |
| dashboard-clean | minor-product-rows-misgrouped | defect | minor | desktop/tablet/phone | Top products' bars and sales sit closer to the next product than to their own |
| dashboard-clean | revenue-chart-squashed | defect | severe | desktop/tablet/phone | Revenue chart squashed into a thin strip |
| dashboard-clean | orders-table-clipped-narrow | defect | severe | tablet/phone; 320–1023 px | Orders table cut off on tablets and phones |
| dashboard-clean | harmless-roomier-cards | harmless | none | desktop; 1024–1920 px | More space between and inside the cards on wide screens |
