# Planted Task Fit mutations

Same format as `mutations/` (`css` appended at the end of `<head>`, `js` run after DOMContentLoaded), planted into the clean controls (`booking-clean`, `carsearch-clean`, `dashboard-clean`). The cases redraw their content with `innerHTML`, so changes to markup are re-applied by a `MutationObserver` after every render; inserted content is placed where it leaves the paths of the interactive states the collector replays unchanged. `_tools/build.mjs` regenerates the item files and the table below.

Task Fit has no automated checks, so the free run only confirms each change is collected; the judge sees it in the desktop and phone screenshots and the interactive states. Each defect should be material to Task Fit alone, so a sound judge scores the variant below its clean base; harmless changes should leave the Task Fit score unchanged. Run, and judge for real (see "Judging planted variants" in `mutations/README.md`):

```
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-task-fit
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-task-fit --judge
```

Criterion is the rubric criterion the defect targets (A Intent and Interface Choice, B Requirement Coverage, C Scope and Restraint, D Domain Fit). 9 defects and 3 harmless changes:

<!-- table -->
| Case | Id | Kind | Criterion | What it changes |
| --- | --- | --- | --- | --- |
| booking-clean | no-practitioner-step | defect | B | No way to pick a practitioner |
| booking-clean | callback-instead-of-times | defect | A | Call-back request instead of choosing a time |
| booking-clean | pet-details-fields | defect | D | Patient details ask about the patient's pet |
| booking-clean | harmless-reworded-hints | harmless | – | Hints reworded |
| carsearch-clean | no-mileage-fuel-filters | defect | B | No mileage or fuel type filters |
| carsearch-clean | sell-finance-insurance-panels | defect | C | Sell, finance, insurance and warranty panels above the results |
| carsearch-clean | shop-basket-actions | defect | D | Used cars sold like basket items |
| carsearch-clean | harmless-retheme-green | harmless | – | Primary colour changed to green |
| dashboard-clean | no-revenue-trend | defect | B | No revenue trend |
| dashboard-clean | metrics-typed-in-by-hand | defect | A | Metrics are boxes the owner types into |
| dashboard-clean | setup-checklist-and-upsells | defect | C | Store set-up checklist and upgrade offer above the metrics |
| dashboard-clean | harmless-accent-teal | harmless | – | Accent colour changed to teal |
<!-- /table -->
