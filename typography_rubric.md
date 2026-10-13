## 2. Typography

**What this measures:** Is the type set with intent, legible sizes, sensible measure and line-height, a hierarchy readable at a glance, and no more styles than the interface needs?

### Evaluation States:

- **Baseline Desktop:** Representative default state at a 1920 × 1080 desktop viewport (the most common desktop resolution worldwide, StatCounter 2026) with realistic content and normal strings (typical fixture).
- **Baseline Tablet:** The same content and task state at 768 × 1024 in portrait, the most common tablet resolution worldwide (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, tablet user agent).
- **Baseline Mobile:** The same content and task state at 360 × 800, the narrowest common mobile viewport (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, phone user agent).
- **Combined Stress:** 1920 × 1080 (the Baseline Desktop viewport) with the stress fixture: dense realistic content and expanded or pseudo-localized strings, with form controls filled in as a thorough user would.
- **Representative Interactive States:** Task-critical non-default states (such as submitted validation, an applied filter, an open panel, or a selected item), found automatically by clicking each distinct control on a fresh page and keeping up to three per viewport that lead to different screens. Text measurements are taken in all of them; the judge sees screenshots of those at desktop and at mobile.
- **Responsive Sweep:** Baseline content rendered at regular 80 px steps from 320 px to 1920 px, plus both sides of the default Tailwind CSS breakpoints (639/640, 767/768, 1023/1024, 1279/1280, 1535/1536) and the common 360 and 414 px phone widths. Text measurements are taken at every width; how text changes across widths is reported by Responsive Typography Adaptation, and screenshots are provided only at widths where Invalid Text Rendering starts failing.

Collection standards:

- **Render-settled signal:** the load event, document.fonts.ready, 500 ms without network activity, and 500 ms without layout changes, capped at 15 s; the condition that ended the wait is recorded.
- **Content fixtures:** empty, typical, dense, expanded, and stress, supplied through the application's own data interface. The harness passes the fixture name; it never edits rendered text.
- **Determinism:** fixed clock and seeded randomness during collection; animations are completed before screenshots.

### Diagnostic Evidence:

Text roles are inferred from markup and rendering: headings (h1–h6 or role="heading", with their level), body text (paragraphs, list items, and other text that wraps or runs long), labels (label, legend, th, dt), control text (buttons, links, tabs, and form field values), values (text that is a number, price, or date), and supporting text (other short text set smaller than body text).

1. **Deterministic Findings:**


|                            |                                                                                                                                                                                                                                                                                                                                |                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                   | **Implementation**                                                                                                                                                                                                                                                                                                             | **Output Example**                                                                                                                                                                             |
| **Invalid Text Rendering** (text whose computed metrics or rendered bounds are invalid) | Evaluate visible non-empty text nodes. Read computed font-size and numeric line-height, and obtain rendered text bounds using Range.getClientRects(). Flag non-finite, zero, or negative font sizes/line heights, or text expected to be visible that has no positive rendered dimensions. Do not impose aesthetic thresholds. | **Pass:** All evaluated visible text has valid computed metrics and rendered dimensions. **On failure report:** element, text sample/role, font size, line height, bounds, viewport, state. |


1. **Quantitative Observations:**


|                                      |                                                                                                                                                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**                             | **Implementation**                                                                                                                                                                                                                     | **Output Example**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Type Scale & Reuse** (the distinct font sizes rendered and how often each is used) | Collect computed font-size for every visible text element. Normalize to CSS px. Report each distinct size, usage frequency, one-off sizes, near-duplicate pairs within ≤1 px, and repeated roles using inconsistent sizes. Count distinct text styles (family, size, weight, italic and letter case) and the formats in use (italic, uppercase, letter-spacing). | - **Reference**: A strong product-interface starting point is a compact role-based scale of approximately five core sizes, e.g. ~13 px caption, 16 px body, 18 px heading, 24 px title, and 36 px display. Additional sizes may be appropriate, but strong systems primarily reuse recurring role-based sizes and introduce exceptions sparingly. With one or two weights per size, that is roughly ten distinct text styles; more, or styles used by a single element, suggest unplanned variation. - **Observed**: “11 sizes are rendered: 12, 13, 14, 15, 16, 17, 18, 20, 24, 28 and 36 px. Six account for 94% of text; 15, 17 and 28 px occur once.” |
| **Font Family Usage** (the typefaces rendered, by share of text and role) | Collect computed font families across visible text. Normalize equivalent stacks and report number of primary families, usage frequency, roles, and isolated deviations. Exclude icon/emoji fonts and report monospace/code separately. Record whether each declared family is available to the page or falls back. | - **Reference**: Strong interfaces generally use one primary family or a deliberate two-family system; more than three families should be unusual and clearly role-driven. - **Observed**: “97% of visible text uses Inter. Code uses JetBrains Mono. One button uses Arial through an isolated override.”                                                                                                                                                                                             |
| **Text Size & Weight Profile** (font size and weight for each text role, including each heading level) | Record computed font size and weight by role. Report median/range, smallest recurring sizes, light-weight small text, and deviations among equivalent roles. Count distinct weights across the page and report weights within 50 of each other. | - **Reference**: ~16 px is a strong starting point for primary body text, ~14 px for compact UI text, and ~13 px for captions/supporting text; text below 12 px should be unusual. Below ~18 px, weights of 400+ are generally a stronger readability reference than light weights. A small set of about three weights (e.g. 400, 600 and 700) is a strong reference; weights within ~50 of each other are hard to tell apart and suggest unplanned variation. - **Observed**: “Body text is consistently 16 px. Metadata is predominantly 13 px. Six 13 px labels use weight 300, and one footer element renders at 10 px.”                                                      |
| **Line Height** (line-height relative to font size, by role and line count, and the length of body text lines) | Record computed font size and line height; calculate line-height/font-size ratio where numeric. Group by role and rendered line count. Estimate the characters on the longest line of each body text element from its rendered line widths. | - **Reference**: Short display/headings commonly use tighter leading around ~1.1, while body copy commonly uses ~1.5–1.6. Text spanning three or more lines should generally have at least ~1.4 line-height. Body text commonly reads best at ~45–75 characters per line; lines beyond ~90 characters become hard to follow. - **Observed**: “Body copy uses 1.5. Three four-line card descriptions use 1.18. Display headings range from 1.08–1.12.”                                                                                                                                                                  |
| **Heading Line Balance** (how multi-line headings break across lines) | For multi-line headings, record line count and rendered width of each line using Range.getClientRects(). Report highly imbalanced line widths and computed text-wrap.                                                                  | - **Reference**: Short multi-line headings should form a deliberate, readable shape rather than leaving a very short final fragment. text-wrap: balance is a useful implementation pattern, but naturally or manually balanced wrapping can be equally successful. - **Observed**: “The hero heading wraps to two lines occupying 96% and 28% of available width; text-wrap is wrap.”                                                                                                                  |
| **Responsive Typography Adaptation** (how the same text changes across viewport widths) | Match stable text elements across viewports and record size, weight, line height, line count and measure.                                                                                                                              | - **Reference**: Numerical values may change responsively, but hierarchy, readable sizing, sensible measure and distinctions between roles should remain coherent. Supporting text should not become disproportionately small simply to fit. - **Observed**: “Title changes from 36→28 px and body remains 16 px. Metadata changes from 13→10 px only at 390 px.”                                                                                                                                      |
<!-- added checks -->
| **Squeezed Text Wrapping** (text pressed into a column so narrow that it breaks into many very short lines) | At Baseline Desktop, Baseline Tablet and Baseline Mobile, evaluate visible text elements (not inline runs or form fields). Report text of three or more lines that averages **14** characters per line or fewer in a column narrower than **12×** its font size (about 24 characters). Lengthened stress text is not evaluated, since it is expected to wrap. The thresholds are a judgment. | - **Reference**: Text should have room to set at least a few words per line; names, values and labels broken into fragments of one or two words are hard to read and suggest the column was not given enough width. - **Observed**: “"Free cancellation up to 24 hours before" (supporting text) wraps to 4 lines of about 10 characters each in a 72 px wide column.” |
<!-- end -->


### Criteria based Evaluation:

You are evaluating the Typography quality of a generated interface. Use the user request, rendered screenshots, and supplied diagnostic evidence to evaluate each Typography criterion below.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive design qualities and weaknesses or missed opportunities.
- For every finding, cite the observable evidence, explain why it matters to that criterion, and label it material or minor:
  - **Material:** a user doing the primary task would notice the difference. Fixing the weakness, or losing the strength, would change how easily the content is read, scanned, or understood.
  - **Minor:** localized or cosmetic. It would not change how easily the content is read, scanned, or understood.
- Passing deterministic checks demonstrates rendering robustness, not good typography. Evaluate the quality of the typography, not the absence of defects.
- Treat quantitative observations and reference values as evidence to interpret, not as automatic violations.
- Evaluate typography according to the role of the text; do not apply body-copy conventions indiscriminately to labels, controls, metadata, or display text.
- Assign each finding to the criterion it most directly affects. Do not count the same underlying issue as separate evidence multiple times.
- Do not assign numeric scores to individual criteria.

++**A/ Hierarchy and Emphasis**++

**Criterion:** Typography should make the information hierarchy readable at a glance and direct attention toward the most important content and actions.

**Evaluate:**

- **Role distinction:** Titles, headings, body text, labels, values, and supporting text are visually distinguishable in ways appropriate to their roles.
- **Hierarchical progression:** Typographic prominence generally decreases with information hierarchy; subordinate text does not unintentionally overpower its parent.
- **Task-aligned emphasis:** The strongest typographic emphasis corresponds to the information most important to the requested task.
- **Economy of emphasis:** Hierarchy is achieved with a restrained combination of size, weight, family, and spacing rather than excessive variation.

**Relevant Evidence:**

- **Screenshots:** Desktop, mobile, representative interactive state.
- **Diagnostic Evidence:** Text Size & Weight Profile, Type Scale & Reuse.

++**B/ Legibility and Reading Comfort**++

**Criterion:** Text should be comfortably readable for its role, density, and expected reading duration.

**Evaluate:**

- **Readable sizing:** Text is appropriately sized for its role; primary content is comfortable to read and supporting text does not become unnecessarily small.
- **Appropriate weight:** Weight gives text sufficient clarity without becoming overly faint or unnecessarily heavy.
- **Line height:** Leading supports comfortable reading, with tighter treatment for short headings and more space for multi-line text.
- **Measure:** Sustained-reading text has a comfortable line length rather than becoming excessively wide or narrow.
- **Multi-line treatment:** Headings and longer text break into readable lines without awkward fragments or degraded reading flow.

**Relevant Evidence:**

- **Screenshots:** Desktop, mobile, stress.
<!-- before added checks -->
- **Diagnostic Evidence:** Text Size & Weight Profile, Line Height, Heading Line Balance, Font Family Usage, Invalid Text Rendering.
<!-- end -->
<!-- added checks -->
- **Diagnostic Evidence:** Text Size & Weight Profile, Line Height, Heading Line Balance, Font Family Usage, Invalid Text Rendering, Squeezed Text Wrapping.
<!-- end -->

++**C/ System Coherence and Restraint**++

**Criterion:** Typography should form a simple, intentional system in which repeated roles use consistent treatment and variation serves a clear purpose.

**Evaluate:**

- **Scale coherence:** Font sizes form a compact recurring system rather than accumulating arbitrary or near-duplicate values.
- **Role consistency:** Equivalent text roles receive equivalent treatment across repeated components and regions.
- **Typeface restraint:** Font-family variation is limited and role-driven rather than introduced inconsistently or decoratively.
- **Weight restraint:** A small, purposeful set of weights communicates hierarchy and emphasis without unnecessary variation.

**Relevant Evidence:**

- **Screenshots:** Desktop, mobile, stress.
- **Diagnostic Evidence:** Type Scale & Reuse, Font Family Usage, Text Size & Weight Profile.

++**D/ Responsive Typography Resilience**++

**Criterion:** Typography should preserve its hierarchy, legibility, and coherence as available space and content constraints change.

**Evaluate:**

- **Responsive adaptation:** Type resizes or rewraps appropriately as viewport dimensions change.
- **Hierarchy preservation:** Important distinctions between titles, headings, body text, and supporting text remain clear across viewports.
- **Reading preservation:** Narrower layouts do not produce excessively small text, uncomfortable measure, poor leading, or awkward heading shapes.

**Relevant Evidence:**

- **Screenshots:** Desktop, tablet, mobile, stress, responsive-transition screenshots.
- **Diagnostic Evidence:** Responsive Typography Adaptation, Text Size & Weight Profile, Line Height, Heading Line Balance, Invalid Text Rendering.

### Overall Typography Scoring:

Use the criterion findings as evidence to make one holistic judgment about the Typography as a whole.

Consider which strengths and weaknesses are most consequential to the requested task, how they interact, and whether they reinforce or undermine the overall reading and information experience. Do not average criterion findings, give each criterion equal weight, or determine the score by counting positive or negative findings.

Select the 1–5 anchor that best characterizes the overall quality of the Typography, and explain which findings led to it.

|                     |                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The typography materially improves how easily the interface can be scanned, understood, and read. Hierarchy, legibility, measure, system coherence, and responsive behavior work together exceptionally well across required states. No material Typography weakness is present. |
| **4: Strong:**      | - The typography is clear, readable, and coherent across the interface and required states. Hierarchy and text treatment consistently support the task. Minor or localized weaknesses may remain, but none materially affects reading or scanning.                                 |
| **3: Competent**    | - The typography is generally readable and understandable, but noticeable weaknesses in hierarchy, legibility, consistency, measure, or responsive treatment increase reading or scanning effort. The primary information remains readily usable.                                  |
| **2 - Poor:**       | - One or more Typography weaknesses materially impair reading or scanning. Important information may be harder to distinguish, read, or follow because of problems with hierarchy, sizing, measure, consistency, or responsive treatment.                                          |
| **1 - Failing:**    | - Typography problems make important information difficult or impossible to read, distinguish, or understand reliably. The typographic treatment does not adequately support the primary experience.                                                                               |
