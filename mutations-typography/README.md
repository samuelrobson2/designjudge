# Planted typography mutations

Same format as `mutations/` (`css` appended at the end of `<head>`, `js` run after DOMContentLoaded), kept in a separate folder so the Layout mutation results stay comparable. Run with:

```
npm run mutate -- booking-baseline --dir mutations-typography
```

The table below is the booking-baseline set; the clean-base sets follow it.

These were written alongside the Typography checks, not blind to them, so they show that the measurements move with real typography changes rather than measuring how much the checks catch. Most typography flaws are judgment calls: they change an observation (`observation_only`) and leave the decision to the judge. Only text that cannot render (Invalid Text Rendering) is a check failure.

| Id | Kind | What it changes | Measurement that should move |
| --- | --- | --- | --- |
| tiny-supporting-text | defect | Descriptions, details, notes and errors at 10 px | Text Size & Weight Profile: text below 12 px |
| light-small-text | defect | Body copy at weight 300, descriptions at 200 | Text Size & Weight Profile: light small text |
| cramped-line-height | defect | Paragraphs at line-height 1.05 | Line Height: multi-line text below 1.4 |
| flat-hierarchy | defect | Title and headings at 15 px/400 | Text Size & Weight Profile: headings no larger than body |
| inverted-heading-hierarchy | defect | h2 at 28 px, h1 at 18 px | Text Size & Weight Profile: inversion |
| too-many-typefaces | defect | Georgia, Courier New, Times New Roman, Verdana | Font Family Usage |
| size-sprawl | defect | Eight near-identical sizes (12.5–16.5 px) | Type Scale & Reuse: near-duplicate chain |
| phone-text-shrinks | defect | Text shrinks to 10 px below 768 px | Responsive Typography: drops below 12 px |
| intro-measure-too-wide | defect | Intro paragraph full width, longer copy | Responsive Typography: longest body line |
| zero-size-note | defect | Summary note at font-size 0 | Invalid Text Rendering (check fails) |
| title-wraps-narrow | defect | Page title limited to 9ch | Heading Line Balance |
| harmless-retheme-blue | harmless | Brand colour only | none |
| harmless-font-swap | harmless | Helvetica throughout | Font Family Usage (still one family) |
| harmless-balanced-headings | harmless | `text-wrap: balance` on headings | none at these widths |
| harmless-title-tracking | harmless | Title letter-spacing −0.02em | none |

## Clean bases

The `*-clean` folders plant defects into the clean controls (`cases/*-clean`), which have no material weakness in any category, so they can also be judged for real (see "Judging planted variants" in `mutations/README.md`): each defect is a material Typography weakness, so a sound judge scores the variant below its clean base, and each harmless change should leave the Typography score unchanged. Run, and judge:

```
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-typography
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-typography --judge
```

Criterion is the rubric criterion the defect targets (A Hierarchy and Emphasis, B Legibility and Reading Comfort, C System Coherence and Restraint, D Responsive Typography Resilience).

| Case | Id | Kind | Criterion | What it changes | Measurement that should move |
| --- | --- | --- | --- | --- | --- |
| booking-clean | headings-set-as-body | defect | A | Title, step and summary headings at 16 px/400, like body text | Text Size & Weight Profile: headings no larger or bolder than body |
| booking-clean | supporting-text-tiny-light | defect | B | Hints, descriptions and summary labels at 11 px/300 | Text Size & Weight Profile: text below 12 px; light small text |
| booking-clean | step-headings-inconsistent | defect | C | Each step heading in its own size, weight, style or case | Type Scale & Reuse: h2 in several sizes |
| booking-clean | harmless-heading-tracking | harmless | – | Title and headings tracked slightly tighter | none |
| carsearch-clean | names-shout-prices-whisper | defect | A | Car names 30 px/800, above the 28 px title; prices 14 px/400 grey | Text Size & Weight Profile: h3 larger than h1 and h2 |
| carsearch-clean | mixed-typefaces | defect | C | Georgia, Courier New, Verdana, Trebuchet MS and Times New Roman by region | Font Family Usage: more than two text families |
| carsearch-clean | phone-text-shrinks | defect | D | Base size 11 px below 768 px | Responsive Typography: drops below 12 px |
| carsearch-clean | harmless-helvetica | harmless | – | Helvetica Neue throughout | none (still one family) |
| dashboard-clean | metrics-demoted | defect | A | Revenue and KPI values 14 px/400; card headings and KPI labels 32 px/700 | Text Size & Weight Profile: h2 larger than h1 |
| dashboard-clean | ultralight-text | defect | B | Small text at weights 300 and 200 | Text Size & Weight Profile: light small text |
| dashboard-clean | narrow-hierarchy-collapses | defect | D | Title, headings and figures at body size below 1024 px | Responsive Typography: largest heading no larger than body |
| dashboard-clean | harmless-accent-teal | harmless | – | Accent colour only | none |
