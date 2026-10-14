# Planted Content Quality mutations

Same format as `mutations/` (`css` appended at the end of `<head>`, `js` run after DOMContentLoaded), planted into the clean controls (`booking-clean`, `carsearch-clean`, `dashboard-clean`). The cases redraw their content with `innerHTML`, so changes to text and markup are re-applied by a `MutationObserver` after every render; inserted content is placed where it leaves the paths of the interactive states the collector replays unchanged, and the controls those states click keep their labels (the state captions name them). `_tools/build.mjs` regenerates the item files and the table below.

Content Quality has no automated checks, so the free run only confirms each change is collected; the judge sees it in the screenshots and in the page text of the desktop, phone, interactive and empty states. Each defect should be material to Content Quality alone, so a sound judge scores the variant below its clean base; harmless changes reword copy with equal quality and should leave the score unchanged. Run, and judge for real (see "Judging planted variants" in `mutations/README.md`):

```
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-content-quality
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-content-quality --judge
```

Criterion is the rubric criterion the defect targets (A Clarity and Actionability, B Concision and Consistency, C Image Fit and Coherence). 7 defects and 3 harmless changes:

<!-- table -->
| Case | Id | Kind | Criterion | What it changes |
| --- | --- | --- | --- | --- |
| booking-clean | vague-error-messages | defect | A | Validation messages say nothing useful |
| booking-clean | padded-instructions | defect | B | Every step buried in long, repetitive instructions |
| booking-clean | harmless-reworded-hints | harmless | – | Hints reworded |
| carsearch-clean | broken-car-photos | defect | C | Car photos fail to load |
| carsearch-clean | price-ratings-contradict | defect | A | Price ratings contradict their own amounts |
| carsearch-clean | inconsistent-names | defect | B | Same things called by different names |
| carsearch-clean | harmless-reworded-note | harmless | – | Results note and empty-state advice reworded |
| dashboard-clean | jargon-labels | defect | A | Metrics and columns labelled in analyst jargon |
| dashboard-clean | conflicting-periods | defect | A | Figures labelled with periods that contradict each other |
| dashboard-clean | harmless-range-labels | harmless | – | Date range buttons reworded |
<!-- /table -->
