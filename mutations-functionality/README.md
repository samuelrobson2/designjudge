# Planted Functionality mutations

Same format as `mutations/` (`css` appended at the end of `<head>`, `js` run after DOMContentLoaded), kept in a separate folder so the other categories' results stay comparable. The cases attach their listeners to `#app` and redraw with `innerHTML`, so behaviour is broken by listeners on the document in the capture phase (they run first and can stop the case's own), and markup changes are re-applied by a `MutationObserver` after every render. `_tools/build.mjs` regenerates the item files and the table below. Run with:

```
npm run mutate -- booking-baseline carsearch-baseline dashboard-baseline --dir mutations-functionality
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-functionality
```

These were written alongside the Functionality checks, not blind to them, so they show that the evidence moves when behaviour breaks rather than measuring how much the checks catch. Every Functionality finding is a check failure, so a defect should be `caught` where it shows. Harmless changes either change only the look or make a dead control work; they should add no failures (a fixed failure leaves the packet, which does not count against them).

Each item has a symptom (what a user would see), where it shows and a severity. 14 defects and 5 harmless changes across the three baseline interfaces, and 9 defects and 3 harmless changes across the three clean ones. The clean interfaces have no failed Functionality checks, so each of their defects should be the only Functionality weakness in its packet; each is meant to be material (scoring below 4). Two clean defects break State and Data Integrity, which has no checks, so they show only in the screenshots of the clicked state: `make-filter-ignored` (after ticking Audi) and `wrong-order-opens` (after clicking order #1482). Add `--judge` to score the planted variants against their base (see the root README):

<!-- table -->
| Case | Id | Kind | Severity | What it changes | Evidence that should move |
| --- | --- | --- | --- | --- | --- |
| booking-baseline | confirm-swallowed | defect | severe | Confirm booking does nothing | No-Effect Action Controls; Form Submission Response |
| booking-baseline | silent-validation | defect | moderate | Incomplete bookings are silently ignored | Invalid Submission Feedback |
| booking-baseline | date-chips-dead | defect | severe | Dates cannot be changed | Toggle / Selection State |
| booking-baseline | phone-field-rejects-input | defect | moderate | Phone field rejects every character | Editable Control Response |
| booking-baseline | error-links-broken | defect | minor | Error summary links point nowhere | Internal Navigation Integrity |
| booking-baseline | slot-click-throws | defect | minor | Choosing a time raises a script error | Runtime Errors |
| booking-baseline | harmless-retheme-blue | harmless | none | Brand colour changed to blue | none |
| booking-baseline | harmless-notes-counter | harmless | none | Character counter under the notes field | none |
| carsearch-baseline | filters-button-dead | defect | severe | Filters button does nothing on phones | No-Effect Action Controls |
| carsearch-baseline | compare-unticks | defect | moderate | Compare boxes untick themselves | Toggle / Selection State |
| carsearch-baseline | clear-all-throws | defect | moderate | "Clear all" crashes instead of clearing | No-Effect Action Controls; Runtime Errors |
| carsearch-baseline | filter-chip-remove-dead | defect | moderate | Active filter chips cannot be removed | No-Effect Action Controls |
| carsearch-baseline | harmless-save-works | harmless | none | Save buttons toggle a saved state | none (fixes an existing failure) |
| dashboard-baseline | range-state-not-exposed | defect | minor | Date range selection not exposed | Toggle / Selection State |
| dashboard-baseline | order-panel-cannot-close | defect | severe | Order panel cannot be closed | No-Effect Action Controls |
| dashboard-baseline | menu-button-blocked | defect | severe | Invisible layer blocks the menu button | Interactive Control Operability |
| dashboard-baseline | view-all-orders-404 | defect | moderate | "View all orders" opens a missing page | Internal Navigation Integrity |
| dashboard-baseline | harmless-export-toast | harmless | none | Export shows a confirmation | none (fixes an existing failure) |
| dashboard-baseline | harmless-accent-teal | harmless | none | Accent colour changed to teal | none |
| booking-clean | confirm-swallowed | defect | severe | Confirm booking does nothing | No-Effect Action Controls; Form Submission Response |
| booking-clean | email-field-cleared | defect | moderate | Email field empties when the user moves on | Editable Control Response |
| booking-clean | silent-validation | defect | moderate | Incomplete bookings are silently ignored | Invalid Submission Feedback |
| booking-clean | harmless-notes-counter | harmless | none | Character counter under the notes field | none |
| carsearch-clean | filters-button-dead | defect | severe | Filters button does nothing on phones | No-Effect Action Controls |
| carsearch-clean | make-filter-ignored | defect | severe | Ticking a make does not filter the results | none (judged from the screenshots) |
| carsearch-clean | search-throws | defect | moderate | Search fails with a script error and no message | Runtime Errors; Form Submission Response |
| carsearch-clean | harmless-retheme-green | harmless | none | Primary colour changed to green | none |
| dashboard-clean | range-buttons-dead | defect | severe | Date range cannot be changed | No-Effect Action Controls; Toggle / Selection State |
| dashboard-clean | order-panel-cannot-close | defect | severe | Order panel cannot be closed | No-Effect Action Controls |
| dashboard-clean | wrong-order-opens | defect | severe | Clicking an order opens the next one | none (judged from the screenshots) |
| dashboard-clean | harmless-accent-teal | harmless | none | Accent colour changed to teal | none |
<!-- /table -->
