# Planted Visual System mutations

Same format as `mutations/` (`css` appended at the end of `<head>`, `js` run after DOMContentLoaded), kept in a separate folder so the Layout and Typography results stay comparable. The cases redraw their content with `innerHTML`, so changes to markup are re-applied by a `MutationObserver` after every render. `_tools/build.mjs` regenerates the item files and the table below. Run with:

```
npm run mutate -- booking-baseline carsearch-baseline dashboard-baseline --dir mutations-visual-system
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-visual-system
```

These were written alongside the Visual System checks, not blind to them, so they show that the evidence moves with real visual-system changes rather than measuring how much the checks catch. Contrast, focus, target-size and accessibility failures are check failures (`caught`); palette, icon, motion and peer-treatment drift change an observation (`observation_only`) and leave the decision to the judge. Harmless changes are applied consistently (a retheme, a stronger focus ring, rounder cards, one shared shadow) and should leave the Visual System packet without new lines.

Each item has a symptom (what a user would see), where it shows and a severity. 14 defects and 4 harmless changes across the three baseline interfaces, and 9 defects and 3 harmless changes across the three clean ones. The clean interfaces have no failed Visual System checks and no measurements outside the reference, so each of their defects should be the only Visual System weakness in its packet; they cover colour and emphasis, component treatment (one peer drawn unlike the others) and interaction states, and each is meant to be material (scoring below 4), except `minor-odd-kpi-card-inverted`, which the judges consistently found minor and is now only expected not to score higher. Add `--judge` to score the planted variants against their base (see the root README):

<!-- table -->
| Case | Id | Kind | Severity | What it changes | Evidence that should move |
| --- | --- | --- | --- | --- | --- |
| booking-baseline | muted-text-washed-out | defect | moderate | Secondary text washed out to a pale grey | Required Contrast: text below 4.5:1 |
| booking-baseline | focus-ring-removed | defect | severe | Keyboard focus ring removed from every control | Keyboard Focus Visibility |
| booking-baseline | labels-not-tied-to-fields | defect | moderate | Field labels no longer tied to their fields | Automated Accessibility Violations: label |
| booking-baseline | confirm-colour-drift | defect | minor | Summary Confirm button in a hard-coded near-match of the brand colour | Rendered Style Vocabulary: near-duplicate colour |
| booking-baseline | odd-treatment-card | defect | minor | One treatment card styled differently from the others | Peer Visual Consistency |
| booking-baseline | date-chips-tiny-phone | defect | moderate | Date chips shrink to tiny tap targets on phones | Minimum Pointer Target Size |
| booking-baseline | harmless-retheme-blue | harmless | none | Brand colour changed to blue | none |
| booking-baseline | harmless-visible-focus-ring | harmless | none | A stronger keyboard focus ring | none |
| carsearch-baseline | save-buttons-unnamed | defect | moderate | Save buttons lose their accessible names | Automated Accessibility Violations: button-name |
| carsearch-baseline | deal-badges-low-contrast | defect | moderate | Deal badges drawn in pale text on pale tints | Required Contrast: text below 4.5:1 |
| carsearch-baseline | toggle-buttons-tiny | defect | minor | Fuel and gearbox toggles packed into tiny buttons | Minimum Pointer Target Size |
| carsearch-baseline | harmless-rounder-cards | harmless | none | Car cards get larger rounded corners | none |
| dashboard-baseline | nav-icons-mixed-with-emoji | defect | minor | Two navigation icons replaced with emoji | Rendered Style Vocabulary: icons in more than one kind |
| dashboard-baseline | kpi-values-pulse | defect | minor | KPI values pulse forever, even with reduced motion | Rendered Style Vocabulary: animations under reduced motion |
| dashboard-baseline | odd-kpi-card | defect | minor | One KPI card styled differently from the others | Peer Visual Consistency |
| dashboard-baseline | status-badges-low-contrast | defect | moderate | Order status badges in pale text | Required Contrast: text below 4.5:1 |
| dashboard-baseline | range-and-nav-focus-hidden | defect | moderate | No focus indication on the date range and navigation | Keyboard Focus Visibility |
| dashboard-baseline | harmless-card-elevation | harmless | none | All cards get the same soft shadow | none |
| booking-clean | muted-text-washed-out | defect | moderate | Secondary text washed out to a pale grey | Required Contrast: text below 4.5:1 |
| booking-clean | slots-look-unavailable | defect | moderate | Every third time slot looks unavailable | Peer Visual Consistency |
| booking-clean | focus-ring-removed | defect | severe | Keyboard focus ring removed from every control | Keyboard Focus Visibility |
| booking-clean | harmless-retheme-blue | harmless | none | Brand colour changed to blue | none |
| carsearch-clean | price-ratings-washed-out | defect | moderate | Price ratings drawn in pale text on pale tints | Required Contrast: text below 4.5:1 |
| carsearch-clean | cards-look-sold | defect | moderate | Every third car card looks greyed out | Peer Visual Consistency |
| carsearch-clean | search-fields-unnamed | defect | moderate | Search and filter fields lose their names | Automated Accessibility Violations: label, select-name |
| carsearch-clean | harmless-rounder-cards | harmless | none | Car cards get larger rounded corners | none |
| dashboard-clean | gains-and-losses-pale | defect | moderate | Gains, losses and "Delivered" drawn in pale text | Required Contrast: text below 4.5:1 |
| dashboard-clean | minor-odd-kpi-card-inverted | defect | minor | One metric card inverted to a dark fill | Peer Visual Consistency |
| dashboard-clean | range-and-order-focus-hidden | defect | moderate | No focus indication on the date range and orders | Keyboard Focus Visibility |
| dashboard-clean | harmless-card-elevation | harmless | none | All cards get the same soft shadow | none |
<!-- /table -->
