# Judge Rubric

## Judge Approach

**Key Question:** How can we evaluate design efficiently at both the micro level (individual components) and macro level (overall design)?

Given that we want the best breakdown of how an app looks, functions and feels and for this to be useful if we try and get the harness to align more with this offline rubric - it’s focused on not forcing information loss earlier than necessary

The proposed approach separates **observation**, **criterion-level interpretation**, and **holistic judgment**:

1. **Diagnostic evidence establishes what is happening.**
2. **Criterion evaluations assess the design for specific dimensions of design quality, leveraging diagnostic evidence and screenshots.**
3. **The overall category score evaluates how successfully those dimensions work together.**

This structure is similar to ++[UICrit's](https://people.eecs.berkeley.edu/~bjoern/papers/duan-uicrit-uist2024.pdf)++ expert evaluation protocol, in which designers first identified specific, localized design critiques, then evaluated design dimensions, and finally produced an overall design-quality judgment. 

This preserves the specificity and auditability of checklist-style evaluation while retaining the holistic judgment required to assess interface design. 

### Approach in Detail:

**1. Collect Diagnostic Evidence**

Diagnostic evidence captures specific facts or narrowly scoped observations.

- **Deterministic Findings:** Code returns a binary, objective result (PASS/FAIL) such as unintended overflow, overlap, inaccessible content, or a control that produces no effect.
- **Quantitative Observations:** Code returns contextual values, such as component dimensions, visible area, line wrapping, or spacing variation. These are paired with best practices in those specific areas for the final judge to determine whether the result is appropriate or problematic in context.

*Related Research:*

- ++*[WebDevJudge](https://arxiv.org/pdf/2510.18560)++ similarly uses hierarchical rubric trees whose leaf nodes must be specific, atomic, and verifiable as implemented/not implemented. Its experiments find binary rubric evaluation substantially more reliable than multi-point Likert scoring for absolute evaluation, supporting the use of discrete checks where a condition can genuinely be verified.* 
- ++*[MLLM as a UI Judge](https://arxiv.org/abs/2510.08783)++ found that multimodal models align with human UI judgments on some factors but diverge on others, supporting a combination of model judgment and additional structured evidence.*
- Not all design qualities should be reduced to checks. ++[DesignPref's](https://arxiv.org/pdf/2511.20513)++ study of 12,000 pairwise comparisons from 20 professional designers found substantial disagreement even on binary UI preferences (Krippendorff's α = 0.25). Its rationale analysis shows that designers often agree on the dimensions that matter (hierarchy, density, color, spacing and action prominence), while disagreeing about the appropriate trade-off between them. This motivates using these qualities as structured criteria for contextual judgment rather than universal binary rules.

**2. Evaluate based on Criteria**

Each rubric category contains a small number of sub-criteria. The judge considers:

- The rendered interface
- The user request
- The diagnostic evidence attached to that quality

The judge then produces a structured, evidence-backed evaluation of the criterion. ****Individual criteria do **not** receive numeric scores. The purpose of this stage is to preserve detailed information about the interface before making a holistic scoring decision.

*Related Research:*

- ++[UICrit](https://people.eecs.berkeley.edu/~bjoern/papers/duan-uicrit-uist2024.pdf)++ collects localized expert critiques before overall design ratings, providing precedent for preserving specific design findings before collapsing them into an overall judgment.
- ++[DesignPref](https://arxiv.org/pdf/2511.20513)++ finds that designers often reference common quality dimensions but weight them differently when making final judgments, supporting criterion-level evidence gathering without treating every criterion as an independently calibrated numeric target.

**3. Score Overall Category**

After scoring the qualities, the judge assigns one holistic 1–5 category score by selecting the anchor that best represents how the criteria work together.

*Note: Pairwise comparison can make relative judgments easier: ++[WebDevJudge](https://arxiv.org/pdf/2510.18560)++ reports substantially higher judge agreement under pairwise comparison than independent absolute grading. However, pairwise preference does not by itself define a stable notion of UI quality. DesignPref found substantial disagreement among professional designers even for binary preferences (α = 0.25), with disagreement reflecting different weighting of legitimate design trade-offs rather than simply annotation noise.*

To create an explicit definition of design quality we may want the harness to learn our subjective standard which is why I left it as a rating vs pairwise? Not sure about this though

### Evaluation Information Needed for the Judge (we’ll need to figure out how we provide / guide the judge to collect this):

States:

- **Baseline Desktop:** Representative default state at a 1920 × 1080 desktop viewport (the most common desktop resolution worldwide, StatCounter 2026) with realistic content and normal strings (typical fixture).
- **Baseline Tablet:** The same content and task state at 768 × 1024 in portrait, the most common tablet resolution worldwide (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, tablet user agent).
- **Baseline Mobile:** The same content and task state at 360 × 800, the narrowest common mobile viewport (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, phone user agent) whose layout viewport stays 360 px wide even when content overflows, with safe-area insets applied where the browser supports inset emulation. If insets cannot be applied, this is recorded as missing evidence. Pages without a viewport meta tag are flagged, because phone browsers would lay them out at 980 px.
- **Combined Stress:** 1920 × 1080 (the Baseline Desktop viewport) with the stress fixture: dense realistic content and expanded or pseudo-localized strings. Form controls are then filled in as a thorough user would, through normal input: empty text fields receive long values, dropdowns their longest option, unchecked checkboxes are checked, and single-choice groups with nothing chosen receive an option. A change that navigates, opens a dialog or large overlay, or removes content (such as a filter narrowing results) is undone so the state stays dense.
- **Representative Interactive States:** One or more task-critical non-default states, such as submitted validation, an applied filter, an open task-critical panel, a selected item, or a completed action. They are found automatically at desktop, tablet and mobile: the harness clicks each distinct control on a fresh page, measures how much the layout changes (new or removed content, including panels that slide onto the screen, dialogs or overlays, validation messages, page height, and moved elements), and keeps the three controls with the largest changes at each viewport. All of them are checked; the judge sees screenshots of the largest change at desktop and at mobile, and the check results of the others. Steps declared with the interface override discovery.
- **Responsive Sweep:** Baseline content rendered at regular 80 px steps from 320 px (the WCAG 2.2 reflow width) to 1920 px, plus both sides of the default Tailwind CSS breakpoints (639/640, 767/768, 1023/1024, 1279/1280, 1535/1536) and the common 360 and 414 px phone widths. Browser evidence and screenshots are collected at every width. Screenshots are provided to the judge only at widths where a deterministic check starts failing; other meaningful transitions (a change between adjacent widths in a tracked parent's display, grid column count, or flex-direction, or in which tracked components are visible) are described in text.
- **RTL:** Collected only when the user request requires it; otherwise recorded as not collected.

Collection standards:

- **Render-settled signal:** the load event, document.fonts.ready, 500 ms without network activity, and 500 ms without layout changes, capped at 15 s; the condition that ended the wait is recorded.
- **Content fixtures:** empty, typical, dense, expanded, and stress, supplied through the application's own data interface. The harness passes the fixture name; it never edits rendered text.
- **Determinism:** fixed clock and seeded randomness during collection; animations are completed before screenshots.

  


**Evidence to Capture:** Screenshot, DOM structure and semantic state, computed styles, element geometry, accessibility tree, scroll and visibility data, generator annotations (if we get the builder to add them to help with judging areas like “primary focus”)

## 1. Layout

**What this measures:** Is the interface composed so the important things are found first, and does it hold together at different viewport sizes and with realistic amounts of content?

1. 

### Diagnostic Evidence:

1. **Deterministic Findings:**


|                                                                                                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                                                                                                                                        | **Implementation**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Output**                                                                                                                                                                                                      |
| **Region Overlap** (overlapping labels, controls, cards, badges, and other layout collisions)                                                   | - Build a set of visible layout elements from interactive controls, component roots, semantic regions, and direct children of layout containers. Component roots are elements annotated with data-component-id; without annotations, use interactive controls, landmarks and semantic regions (header, nav, main, aside, footer, section, article, form, fieldset, table, figure), media (img, picture, video, canvas, svg), and non-inline children of layout containers. Exclude ancestor/descendant pairs and elements inside known overlay layers such as dialogs, menus, popovers, tooltips, and fixed overlays. Exclude badges only when they are absolutely positioned on their own host element; in-flow badges remain eligible. Compute intersections between eligible peer elements using getBoundingClientRect(), clipped by any ancestor that clips overflow. Flag geometrically significant overlaps when the intersection exceeds 2 px on **both** axes **and** covers at least **5%** of the smaller element's visible area (configurable). When a failing pair's ancestors also fail as a pair, report only the outermost pair. **Intentional overlaps:** when one element of the pair is media or decorative (img, picture, video, canvas, svg, aria-hidden="true", or when the overlapped part of an element shows only media or a background image, with no text or controls), or when a label overlaps its own associated control, report the pair as a separate media/decorative overlap result; it does not fail the check. | **Pass:** No eligible peer elements exceed the collision threshold. **On failure report:** both element IDs/selectors, bounding boxes, intersection width/height/area, overlap proportion, viewport, and state. Media/decorative overlaps are reported separately with the same fields. |
| **Container Overflow**(text, controls, tables, charts, or other content extending beyond its container)                                        | - Evaluate visible block, flex, grid, table, and annotated component containers. Inline elements, form controls, and replaced elements are not containers; html and body are covered by Page-Level Horizontal Overflow except when they mask overflow (see that check). For each axis, calculate scrollWidth - clientWidth and scrollHeight - clientHeight. Ignore overflow ≤ **2 px** for rounding. Do not fail overflow on an axis whose computed overflow-x/y is auto or scroll. For hidden or clip, report overflow beyond tolerance as clipped overflow. For visible, report it when the overflowing content (descendant elements or the container's own text) extends outside the evaluated container's bounds. Because visible overflow propagates to every ancestor, attribute each overflowing descendant only to the innermost container it overflows, and identify the descendant(s) causing it. Ignore overflow caused only by descendants in excluded overlay layers (as defined for Region Overlap, including badges positioned on their host). **Truncation:** text deliberately truncated with text-overflow: ellipsis or line-clamp is reported as a separate truncated result, including the full text, and does not fail the check. | **Pass:** No eligible container has overflow beyond tolerance on a non-scrollable axis. **On failure report:** container, axis, overflow pixels, computed overflow style, offending descendant(s), viewport, and state. Truncated text is reported separately with its container, full text, viewport, and state. |
| **Page-Level Horizontal Overflow**(the interface unintentionally scrolling beyond the viewport width)                                          | - At each viewport, compare document.documentElement.scrollWidth with document.documentElement.clientWidth. Ignore a maximum **2 px** rounding tolerance. If failed, identify visible elements whose right edge extends beyond the viewport or whose left edge is negative. **Masked overflow:** when html or body computes overflow-x: hidden or clip, the document cannot scroll horizontally and this comparison passes even though content may be cut off at the viewport edge; in that case, visible elements extending beyond the viewport are reported as clipped overflow under Container Overflow, with the document root as the container. Record whether the page declares a viewport meta tag; without one, mobile browsers lay the page out at 980 px and scale it down. | **Pass:** Document width does not exceed viewport width beyond tolerance. **On failure report:** document width, viewport width, overflow pixels, likely offending elements, viewport, and state.               |
| **Interactive Element Reachability**                                                                                                            | - Evaluate visible enabled interactive elements (button, a[href], form controls, elements with interactive ARIA roles, and annotated controls). Exclude elements that are visually hidden by design (clipped to ≤ 1 px, such as skip links and screen-reader-only controls) and elements inside inert, aria-hidden="true", [hidden], or closed details subtrees. Starting with the element's bounding box, intersect it with the viewport and each ancestor whose computed overflow clips or scrolls that axis. Treat clipping by an auto/scroll ancestor as reachable when scrolling that ancestor through its valid scroll range can fully reveal the element; hidden and clip ancestors are not user-scrollable. Page scrolling can reveal content below the fold, and content beyond the right edge only when the document itself scrolls horizontally; it never reveals content at negative coordinates or inside fixed-position containers. An element larger than its scrollport counts as fully revealed when its visible extent fills the scrollport. **Off-canvas controls:** when a control's nearest positioned or transformed container lies entirely outside the viewport (for example, a closed drawer moved off-screen with a transform), report it in a separate possibly-disclosed group rather than failing it. Flag when an element cannot be fully revealed through viewport or ancestor scrolling. Occlusion by fixed, sticky, or overlay layers is evaluated by Occluded Content. | **Pass:** Every evaluated interactive element can be fully revealed. **On failure report:** element, clipped fraction/edges, clipping ancestor, overflow mode, viewport, and state. Possibly-disclosed controls are listed separately with their off-canvas container. |
| **Collapsed Component Dimensions** *(charts, maps, images, avatars, canvases, or other components rendering at unusable or invalid dimensions)* | - Evaluate annotated visual components plus <img>, <canvas>, <svg>, <video> and configured component roles. Only rendered elements are evaluated: exclude elements that are display: none or inside hidden subtrees, svg elements that contain only defs or symbol children (icon sprites), and aria-hidden images of 1 × 1 px or smaller (tracking pixels). Before measuring, scroll through the page and wait for images to finish loading so lazily loaded media are measured at their rendered size. Measure rendered width and height with getBoundingClientRect(). Always fail non-finite, zero, or negative rendered width or height. Apply minimum dimensions only to component types with explicitly configured thresholds (none are configured by default).                                                                                                                                                                                                                            | **Pass:** All evaluated components have valid dimensions and satisfy applicable configured minima. **On failure report:** component ID/type, width, height, threshold, viewport, and state                      |
| **Occluded Content** (text, controls, or media that can never be seen unobstructed: hidden under fixed, sticky, or overlay layers, under the device's unsafe area, or beyond the page edge) | - Evaluate leaf content in each captured state: interactive controls, elements with their own visible text (measured by their text line boxes), and media. Exclude hidden, inert, aria-hidden, [hidden], and visually hidden content, content inside controls (the control is evaluated), and closed off-canvas panels lying wholly outside the page. Scroll the page vertically through its full height in steps of half the viewport height, including the final position. At each position, hit-test up to 15 sample points per element (five across and three down, 3 px inside each edge, so overlaps up to 2 px are tolerated), with pointer events enabled and inert removed so that everything that paints is hit. A point is obstructed when the first painted element above it (a background colour or image, media, a form control, or text) is unrelated to the element. Points hidden by a clipping or scrolling ancestor are left to Container Overflow and Interactive Element Reachability. **Scrolling content** must be clear at every sample point at some scroll position; points at negative page coordinates can never be scrolled to and count as obstructed. **Pinned content** (in a fixed layer, or a sticky layer while it is stuck) must be clear at every position where it is pinned; its points beyond the screen edge count as obstructed. When the page opts into drawing under the device's unsafe areas (viewport-fit=cover), the safe-area insets count as obstructing pinned content. **Top layers:** while a dialog, alertdialog, menu, listbox, tooltip, open popover, aria-modal element, or a fixed painted layer covering at least 30% of the screen is open, only content inside top layers is evaluated. **Deliberate overlays:** elements lying within a media element's bounds (captions, badges, play buttons) and a label over its own control do not obstruct. **Dependency:** in-page hit testing during collection. | **Pass:** Every evaluated element can be seen unobstructed. **On failure report:** each obstruction (element, unsafe area, or page or screen edge), the content it hides, the share of each element's sample points that is never visible, whether the content is pinned, viewport, and state. |
| **Responsive Layout Failures**(objective layout failures introduced at particular viewport sizes)                                              | - Render the same application state and content fixture at each required viewport (the Responsive Sweep widths defined under Evaluation States) and rerun all applicable static layout detectors. **Control availability:** track each interactive control by role and accessible name across the widths; a control that can be used (visible, enabled, not hidden by a clipping container that cannot be scrolled, and on the page) at a narrower and at a wider width but not at the widths between fails. Any instance counts, so a control that moves between regions stays available.                                                                                                                                                                                                                                                                                                                                                                                                                                | **Pass**: Every underlying check passes at every required viewport, and no control is unavailable in a band between widths where it is available. Report: check × viewport failure matrix, including a control-availability row.                                                                                                    |
| **Content-Growth Layout Failures**(objective layout failures introduced by empty, typical, or dense content states)                            | - At each required viewport (Baseline Desktop, Baseline Tablet and Baseline Mobile), render the application using predefined empty, typical, dense, expanded-string, and combined stress (dense content with expanded strings, also used for the Combined Stress state) fixtures through the application's normal data/state interface. Do not mutate rendered DOM text directly. Rerun applicable deterministic checks for every fixture. If the interface exposes no fixture interface, report this check as unavailable (missing evidence), not as a failure.                                                                                                                                                                                                                                                                                 | **Pass:** Every underlying check passes in every required fixture. Report: check × viewport × fixture failure matrix.                                                                                           |


  


1. **Quantitative Observations:**


|                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                            | **Implementation**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Output Example**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Spatial Grouping and Separation** | Identify groups from semantic HTML containers (fieldset, section, ul/ol, table, and form groups: form, role=group, role=radiogroup) and repeated sibling structures under the same layout parent (at least three siblings sharing a tag and class signature or an explicit component-type label). Label each measurement with the basis on which its group was detected. For comparable groups, measure the median edge-to-edge gap between items within each group and the gap between adjacent groups under the same parent (measured between the groups' content extents, so padding and dividers that separate groups count toward the gap). Measure the same relation one level down: for each group's items (for example cards in a grid or rows in a list), compare the gap between neighbouring items' content with the median gap inside items (tables are excluded, since rows are separated by rules). Separately measure minimum edge-to-edge spacing between neighboring bounded elements (interactive controls with a visible border or fill, and boxes of at least 24 × 24 px, such as cards, with a visible border on every side or a fill distinct from what is behind them) and, at narrow viewports, inline inset from top-level content containers to the viewport edge. Classify a control as bordered/filled when its computed style has a visible border on any side or a non-transparent background distinct from its immediate parent.**Dependency:** Semantic DOM or repeated sibling structure | - **Reference:** Inter-group spacing should generally exceed intra-group spacing; ~2× is a useful reference. Neighboring bordered/filled controls and boxes should generally have ~12 px edge-to-edge clearance. At narrow viewports, top-level content containers should generally have ~16 px inline inset from the viewport edge. - **Observed**: “Fields use an 8 px median internal gap and 12 px between sections, a 1.5× ratio. Two neighboring controls are 6 px apart. At 360 px, main content is 8 px from the viewport edge.”           |
| **Responsive Component Adaptation** | Match components in the evaluation set across viewports using stable IDs: explicit data-component-id annotations when present; otherwise the Responsive Sweep resizes a single live page so that harness-assigned element identities remain stable across widths. At each viewport, record x, y, width, height, aspect ratio, width/parent-width, height/parent-height, and DOM order. For the parent, record computed display, grid column count when applicable, and flex-direction when applicable. For components sharing an explicit component-type label, calculate each component’s width, height, and aspect-ratio deviation from the peer median. **Dependency:** Stable component IDs are required (satisfied by annotations or by the in-place sweep). Component-type labels (data-component-type) are required only for peer comparisons; without them, peer comparison is reported as unavailable.                                                                                                                                                   | - **Reference**: Ordinary responsive resizing is expected. Large changes in size or aspect ratio, or large deviations between components sharing the same explicit component-type label, may indicate compression, distortion, or poor responsive adaptation. - **Observed**: “The revenue chart changes from 540 × 280 px to 112 × 74 px between 768 px and 390 px, reducing area by 94.5% and changing aspect ratio from 1.93 to 1.51. The parent changes from two columns to one. One KPI chart is 68% smaller than the peer median.” |
| **Alignment Outliers**              | Group at least three repeated sibling elements under the same parent, or elements sharing the same component-type label. For groups of at least three peers, record left, right, horizontal-center, top, and bottom coordinates with getBoundingClientRect(). Before computing medians, cluster peers into rows (for top and bottom) and columns (for left, right, and horizontal-center) so that multi-row and multi-column grids are compared within each row or column; clusters of fewer than three peers are not compared. Calculate the median for each coordinate within each cluster and each element’s absolute deviation from that median. A coordinate is a shared alignment line when at least two-thirds of the cluster sits within 2 px of its median; the judge receives elements that sit more than 4 px off their cluster's shared lines: off any shared line for peers of similar size (within 10% of the cluster median), or off every shared line for peers of clearly different size (so a card offset from its column is reported, but a half-width field that shares the column's left edge is not). Full measurements are retained for inspection.**Dependency:** Repeated sibling structure is sufficient for simple cases; component-type labels improve peer matching.                                                                                                                                                                                                                                                 | - **Reference:** Repeated peer elements should generally share consistent edges or centers. A large isolated deviation from an otherwise consistent peer group may indicate an alignment problem. - **Observed**:“Five of six pricing cards have left edges within 2 px of the group median; one is offset by 14 px.”                                                                                                                                                                                                                    |
| **Runtime Layout Stability**        | Register a PerformanceObserver for layout-shift before rendering and collect entries for 5 seconds after navigation (the longest window browsers use to group layout shifts), or until the shared render-settled signal (defined under Evaluation States) if that is later, so content that arrives after the page first goes quiet is counted. Measure on fresh loads of Baseline Desktop, Baseline Tablet and Baseline Mobile. Ignore entries with hadRecentInput=true. Record cumulative layout-shift score, largest individual shift, number of shift events, and, for attributed elements, stable ID or selector, tag/role, accessible name where available, and previous/current bounds.**Dependency:** Chromium-based evaluation and a shared render-settled lifecycle.                                                                                                                                                                                                                                                            | - **Reference**: Lower unexpected layout shift is generally better. Larger shifts, especially those affecting primary content or controls, are more consequential than small peripheral shifts. - **Observed:** “Initial render produced four unexpected layout shifts with a cumulative score of 0.16. The largest was 0.11 and affected three elements: #results-panel, .filter-bar, and button[data-action="submit"].”                                                                                                                |


1. 

### Criteria based Evaluation:

You are evaluating the Layout quality of a generated interface. Use the user request, rendered screenshots, and supplied diagnostic evidence to evaluate each Layout criterion below.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive design qualities and weaknesses or missed opportunities.
- For every material positive or negative finding, cite the observable evidence and explain why it matters to that criterion.
- Passing deterministic checks demonstrates technical robustness, not good composition. Evaluate the quality of the composition, not the absence of defects.
- Treat quantitative observations as evidence to interpret, not as automatic violations. Do not infer a weakness from a metric alone.
- Assign each material finding to the criterion it most directly affects. You may reference consequences in other criteria, but do not count the same underlying issue as separate evidence multiple times.
- Do not assign numeric scores to individual criteria.

++**A/ Hierarchy and Grouping**++

**Criterion:** The layout should direct attention efficiently toward the most important task, content, and actions. 

**Evaluate:**

- **Primary focus:** The entry point makes the main task and primary action immediately clear and visually prominent.
- **Task-aligned order:** Content appears in order of importance; supporting information does not precede or compete with the main task. Visual and semantic order progresses naturally from top to bottom and from the leading edge to the trailing edge.
- **Grouping:** Related elements are spatially associated, while distinct groups are clearly separated. Within-group and between-group spacing consistently communicates relationships.
- **Alignment:** Equivalent and related elements follow coherent shared edges, baselines, or alignment patterns. Repeated spacing, alignment, and structural patterns create a coherent visual cadence.
- **Structural restraint:** The layout uses spacing and alignment before introducing cards, containers, dividers, nesting, or decorative structure.
- **Focused composition:** The layout includes only the regions and actions needed to understand and perform the task. 

**Relevant Evidence:**

- **Screenshots:** Desktop, tablet, mobile, stress, representative interactive state.
- **Diagnostic Evidence:** Cross-viewport changes in element geometry and DOM order; Interactive Element Reachability where relevant to prominent actions; Spatial Grouping and Separation, Alignment Outliers, Region Overlap; measured within-group and between-group gaps, control clearance, and viewport inset.

++**B/ Density and Content Fit**++

**Criterion:** The layout should present the appropriate amount of information for the task while keeping it readable, scannable, and efficient to use.

Evaluate:

- **Appropriate density:** The amount of visible information matches the task and expected user needs.
- **Efficient use of space:** The interface avoids unnecessary regions, oversized containers, duplicated information, and avoidable scrolling.
- **Clutter control:** Secondary information is grouped, simplified, or progressively disclosed when displaying it would impair comprehension.
- **Content fit:** Labels, values, controls, tables, lists, and repeated items have enough room to remain readable and comparable. Text wraps, truncates, and occupies space in ways appropriate to its content and importance.

**Relevant evidence**

- **Screenshots:** Desktop, tablet, mobile, stress.
- **Diagnostic Evidence:** Container Overflow, Content-Growth Layout Failures; measured overflow extent and changes in component geometry across typical, dense, and expanded-string states.

++**C/ Integrity and Proportions**++

**Criterion:** In each evaluated state, the composition should be balanced: regions and components should have appropriate size, shape, balance, alignment, and structural integrity.

Evaluate:

- **Usable sizing:** Major regions and components receive enough space to perform their function.
- **Functional proportion:** Width, height, and aspect ratio suit the component’s content, importance, and role.
- **Compositional balance:** Primary and supporting regions have a coherent visual relationship rather than appearing accidentally dominant, diminished, or empty.
- **Peer consistency:** Equivalent components retain coherent dimensions, structure, and geometry unless variation serves a clear purpose.
- **Structural integrity:** Elements do not collide, clip, collapse, crowd edges, or render at unusable dimensions.

**Relevant evidence**

- **Screenshots:** Desktop, tablet, mobile, stress, responsive-transition screenshots.
- **Diagnostic Evidence:** Responsive Component Adaptation, Collapsed Component Dimensions, Region Overlap, Occluded Content, Container Overflow; component dimensions, aspect ratios, parent-relative sizing, peer deviations, and layout structure.

++**D/ Responsive and Content Resilience**++

**Criterion:** The layout should adapt intelligently as available space, content volume, string length, direction, or interface state changes.

**Evaluate:**

- **Adaptive behavior:** Components stack, reorder, resize, simplify, or change presentation without losing their usefulness. 
- **Growth resilience:** Dense data, longer strings, and expanded content do not destabilize the layout.
- **Priority preservation:** Important content and actions retain appropriate prominence as constraints increase.
- **Reachability:** Critical content and actions remain practically accessible as content grows or available space decreases.
- **Scroll behavior:** New scrolling or disclosure introduced by constrained states is intentional, manageable, and discoverable.

**Relevant evidence:**

- **Screenshots:** Desktop, tablet, mobile, stress, representative interactive state, responsive-transition screenshots, RTL when required.
- **Diagnostic Evidence:** Responsive Component Adaptation, Responsive Layout Failures, Content-Growth Layout Failures, Page-Level Horizontal Overflow, Interactive Element Reachability, Runtime Layout Stability; cross-state changes in geometry, order, layout structure, scrolling, and reachability.

  


1. 

### Overall Layout Scoring:

Use the criterion findings as evidence to make one holistic judgment about the Layout as a whole.

Consider which strengths and weaknesses are most consequential to the requested task, how they interact, and whether they reinforce or undermine the overall composition. Do not average criterion findings, give each criterion equal weight, or determine the score by counting positive or negative findings.

Select the 1–5 anchor that best characterizes the overall quality of the Layout, and explain which criterion findings were decisive to that judgment.


|                     |                                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The overall Layout materially improves how easily the requested task can be understood and carried out. Hierarchy, grouping, density, proportions, and responsive behavior work together exceptionally well across required states. No material Layout weakness is present.                                   |
| **4: Strong:**      | - The overall Layout is clear, efficient, and coherent across required states. Important content and actions are appropriately prioritized, grouped, and sized. Minor or localized weaknesses may remain, but none materially affects the primary task.                                                         |
| **3: Competent**    | - The Layout generally supports the task, but noticeable weaknesses in hierarchy, grouping, density, proportions, or responsive behavior increase effort or reduce clarity. The primary experience remains readily understandable and usable.                                                                   |
| **2 - Poor:**       | - One or more Layout weaknesses materially impair the primary experience. Important content or actions may be harder to find, understand, compare, or access, or the composition may become substantially less effective in required states. The task remains possible, but usability is meaningfully degraded. |
| **1 - Failing:**    | - The Layout does not reliably support the requested task. Fundamental composition or responsive failures make important content, relationships, or actions difficult or impossible to understand, access, or use, or cause required states to become unusable.                                                 |


  


## 2. Typography (For Review)

Is the type set with intent, legible sizes, sensible measure and line-height, a hierarchy readable at a glance, and no more styles than the interface needs?

1. 

### Diagnostic Evidence:

  


1. **Deterministic Findings:**


|                            |                                                                                                                                                                                                                                                                                                                                |                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                   | **Implementation**                                                                                                                                                                                                                                                                                                             | **Output Example**                                                                                                                                                                             |
| **Invalid Text Rendering** | Evaluate visible non-empty text nodes. Read computed font-size and numeric line-height, and obtain rendered text bounds using Range.getClientRects(). Flag non-finite, zero, or negative font sizes/line heights, or text expected to be visible that has no positive rendered dimensions. Do not impose aesthetic thresholds. | **Pass:** All evaluated visible text has valid computed metrics and rendered dimensions. **On Failure Provide:** element, text sample/role, font size, line height, bounds, viewport, state. |


  


1. **Quantitative Observations:**


|                                      |                                                                                                                                                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**                             | **Implementation**                                                                                                                                                                                                                     | **Output Example**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Type Scale & Reuse**               | Collect computed font-size for every visible text element. Normalize to CSS px. Report each distinct size, usage frequency, one-off sizes, near-duplicate pairs within ≤1 px, and repeated roles using inconsistent sizes.             | - **Reference**: A strong product-interface starting point is a compact role-based scale of approximately five core sizes, e.g. ~13 px caption, 16 px body, 18 px heading, 24 px title, and 36 px display. Additional sizes may be appropriate, but strong systems primarily reuse recurring role-based sizes and introduce exceptions sparingly. - **Observed**: “11 sizes are rendered: 12, 13, 14, 15, 16, 17, 18, 20, 24, 28 and 36 px. Six account for 94% of text; 15, 17 and 28 px occur once.” |
| **Font Family Usage**                | Collect computed font families across visible text. Normalize equivalent stacks and report number of primary families, usage frequency, roles, and isolated deviations. Exclude icon/emoji fonts and report monospace/code separately. | - **Reference**: Strong interfaces generally use one primary family or a deliberate two-family system; more than three families should be unusual and clearly role-driven. - **Observed**: “97% of visible text uses Inter. Code uses JetBrains Mono. One button uses Arial through an isolated override.”                                                                                                                                                                                             |
| **Text Size & Weight Profile**       | Record computed font size and weight by role. Report median/range, smallest recurring sizes, light-weight small text, and deviations among equivalent roles.                                                                           | - **Reference**: ~16 px is a strong starting point for primary body text, ~14 px for compact UI text, and ~13 px for captions/supporting text; text below 12 px should be unusual. Below ~18 px, weights of 400+ are generally a stronger readability reference than light weights. - **Observed**: “Body text is consistently 16 px. Metadata is predominantly 13 px. Six 13 px labels use weight 300, and one footer element renders at 10 px.”                                                      |
| **Line Height**                      | Record computed font size and line height; calculate line-height/font-size ratio where numeric. Group by role and rendered line count.                                                                                                 | - **Reference**: Short display/headings commonly use tighter leading around ~1.1, while body copy commonly uses ~1.5–1.6. Text spanning three or more lines should generally have at least ~1.4 line-height. - **Observed**: “Body copy uses 1.5. Three four-line card descriptions use 1.18. Display headings range from 1.08–1.12.”                                                                                                                                                                  |
| **Heading Line Balance**             | For multi-line headings, record line count and rendered width of each line using Range.getClientRects(). Report highly imbalanced line widths and computed text-wrap.                                                                  | - **Reference**: Short multi-line headings should form a deliberate, readable shape rather than leaving a very short final fragment. text-wrap: balance is a useful implementation pattern, but naturally or manually balanced wrapping can be equally successful. - **Observed**: “The hero heading wraps to two lines occupying 96% and 28% of available width; text-wrap is wrap.”                                                                                                                  |
| **Responsive Typography Adaptation** | Match stable text elements across viewports and record size, weight, line height, line count and measure.                                                                                                                              | - **Reference**: Numerical values may change responsively, but hierarchy, readable sizing, sensible measure and distinctions between roles should remain coherent. Supporting text should not become disproportionately small simply to fit. - **Observed**: “Title changes from 36→28 px and body remains 16 px. Metadata changes from 13→10 px only at 390 px.”                                                                                                                                      |


  


### 2. Criteria based Evaluation:

You are evaluating the Typography quality of a generated interface. Use the user request, rendered screenshots, and supplied diagnostic evidence to evaluate each Typography criterion below.

  


**For each criterion:**

- Assess every listed evaluation point that is applicable.
- Identify both positive design qualities and weaknesses or missed opportunities.
- For every material positive or negative finding, cite the observable evidence and explain why it matters to that criterion.
- Passing deterministic checks demonstrates rendering robustness, not good typography. Evaluate the quality of the typography, not the absence of defects.
- Treat quantitative observations and reference values as evidence to interpret, not as automatic violations.
- Evaluate typography according to the role of the text; do not apply body-copy conventions indiscriminately to labels, controls, metadata, or display text.
- Assign each material finding to the criterion it most directly affects. Do not count the same underlying issue as separate evidence multiple times.
- Do not assign numeric scores to individual criteria.

  


++**A/ Hierarchy and Emphasis**++

  


**Criterion**: Typography should make the information hierarchy readable at a glance and direct attention toward the most important content and actions.

  


**Evaluate:**

  


- **Role distinction:** Titles, headings, body text, labels, values, and supporting text are visually distinguishable in ways appropriate to their roles.
- **Hierarchical progression:** Typographic prominence generally decreases with information hierarchy; subordinate text does not unintentionally overpower its parent.
- **Task-aligned emphasis:** The strongest typographic emphasis corresponds to the information most important to the requested task.
- **Economy of emphasis:** Hierarchy is achieved with a restrained combination of size, weight, family, and spacing rather than excessive variation.

  


**Relevant Evidence:**

- Screenshots: Desktop, mobile, representative interactive state
- Diagnostic Evidence: Hierarchy Relationships, Type Scale & Reuse, Text Size & Weight Profile.

  


++**B/ Legibility and Reading Comfort**++

**Criterion:** Text should be comfortably readable for its role, density, and expected reading duration.

**Evaluate:**

- **Readable sizing:** Text is appropriately sized for its role; primary content is comfortable to read and supporting text does not become unnecessarily small.
- **Appropriate weight:** Weight gives text sufficient clarity without becoming overly faint or unnecessarily heavy.
- **Line height:** Leading supports comfortable reading, with tighter treatment for short headings and more space for multi-line text.
- **Measure:** Sustained-reading text has a comfortable line length rather than becoming excessively wide or narrow.
- **Multi-line treatment:** Headings and longer text break into readable lines without awkward fragments or degraded reading flow.

**Relevant Evidence:**

- Screenshots: Desktop, mobile, dense-content states.
- Diagnostic Evidence: Text Size & Weight Profile, Line Height, Measure & Line Length, Heading Line Balance, Font Family Usage.

  
  


++**C/ System Coherence and Restraint**++

  


**Criterion**: Typography should form a simple, intentional system in which repeated roles use consistent treatment and variation serves a clear purpose.

  


**Evaluate:**

- Scale coherence: Font sizes form a compact recurring system rather than accumulating arbitrary or near-duplicate values.
- Role consistency: Equivalent text roles receive equivalent treatment across repeated components and regions.
- Typeface restraint: Font-family variation is limited and role-driven rather than introduced inconsistently or decoratively.
- Weight restraint: A small, purposeful set of weights communicates hierarchy and emphasis without unnecessary variation.

  


**Relevant Evidence:**

- Screenshots: Desktop, mobile, repeated-component states.
- Diagnostic Evidence: Type Scale & Reuse, Font Family Usage, Text Size & Weight Profile, Hierarchy Relationships.

  


++**D/ Responsive Typography Resilience**++

  


**Criterion**: Typography should preserve its hierarchy, legibility, and coherence as available space and content constraints change.

  


**Evaluate:**

- Responsive adaptation: Type resizes or rewraps appropriately as viewport dimensions change.
- Hierarchy preservation: Important distinctions between titles, headings, body text, and supporting text remain clear across viewports.
- Reading preservation: Narrower layouts do not produce excessively small text, uncomfortable measure, poor leading, or awkward heading shapes.

  


**Relevant Evidence:**

- Screenshots: Desktop, mobile, stress, responsive-transition screenshots
- Diagnostic Evidence: Responsive Typography Adaptation, Text Size & Weight Profile, Line Height, Measure & Line Length, Heading Line Balance.

### 3. Overall Typography Scoring:

Use the criterion findings as evidence to make one holistic judgment about the Typography as a whole.

  


Consider which strengths and weaknesses are most consequential to the requested task, how they interact, and whether they reinforce or undermine the overall reading and information experience. Do not average criterion findings, give each criterion equal weight, or determine the score by counting positive or negative findings.

  


Select the 1–5 anchor that best characterizes the overall quality of the Typography, and explain which criterion findings were decisive to that judgment.


|                     |                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The typography materially improves how easily the interface can be scanned, understood, and read. Hierarchy, legibility, measure, system coherence, and responsive behavior work together exceptionally well across required states. No material Typography weakness is present. |
| **4: Strong:**      | - The typography is clear, readable, and coherent across the interface and required states. Hierarchy and text treatment consistently support the task. Minor or localized weaknesses may remain, but none materially affects reading or scanning.                                 |
| **3: Competent**    | - The typography is generally readable and understandable, but noticeable weaknesses in hierarchy, legibility, consistency, measure, or responsive treatment increase reading or scanning effort. The primary information remains readily usable.                                  |
| **2 - Poor:**       | - One or more Typography weaknesses materially impair reading or scanning. Important information may be harder to distinguish, read, or follow because of problems with hierarchy, sizing, measure, consistency, or responsive treatment.                                          |
| **1 - Failing:**    | - Typography problems make important information difficult or impossible to read, distinguish, or understand reliably. The typographic treatment does not adequately support the primary experience.                                                                               |


## 3. Visual System (For Review)

**What this measures:** Do colors, components, surfaces, icons, and interaction states read as one coherent system? Does visual treatment communicate hierarchy and meaning clearly, consistently, and accessibly?

1. 

### Diagnostic Evidence

++**Deterministic Findings:**++


|                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                               | **Implementation**                                                                                                                                                                                                                                                                                                                                                                                                                                | **Output**                                                                                                                                                                                                                                                                                                 |
| **Automated Accessibility Violations** | At each required viewport and state, run [axe.run](http://axe.run)() after render settles with WCAG 2.0–2.2 A/AA rules enabled. Treat only violations as failures; report incomplete results separately as unresolved. Disable rules already covered by dedicated checks to avoid duplicates. Report rule ID, impact, affected elements, and failure summary.                                                                                     | **Pass:** axe returns no definite A/AA violations after exclusions. **On failure report:** rule ID, impact, element target, failure summary, viewport, and state.                                                                                                                                         |
| **Required Contrast**                  | Evaluate visible text and non-text UI indicators needed to identify controls or states. Resolve foreground/background colors from computed styles, compositing through ancestor backgrounds. Mark complex backgrounds that cannot be reduced to a single color as unresolved. Calculate WCAG 2 contrast and apply 4.5:1 for normal text, 3:1 for large text, and 3:1 for required non-text UI information.                                        | **Pass:** Every resolvable evaluated pair meets its applicable threshold. **On failure report:** element, text/visual role, foreground and background colors, font size/weight where applicable, measured ratio, required ratio, viewport, and state.                                                      |
| **Keyboard Focus Visibility**          | Traverse visible tabbable elements in native tab order using Playwright Tab / Shift+Tab, excluding disabled, hidden, inert, and tabindex="-1" elements. Disable animations during evaluation. For each focused element, compare its unfocused and :focus-visible states using computed focus-related styles and a fixed padded screenshot crop. Flag only when neither computed styles nor rendered pixels change beyond tolerance.               | **Pass:** Every evaluated keyboard-focusable control produces a persistent visible keyboard-focus indication. **On failure report:** element, accessible role/name, tab position, before/after relevant styles, changed-pixel count/proportion, tolerance used, viewport, and state.                      |
| **Minimum Pointer Target Size**        | Evaluate visible enabled pointer targets using getBoundingClientRect(). Pass targets at least 24 × 24 CSS px. For smaller targets, apply the WCAG 2.5.8 spacing exception by testing a 24 px diameter circle centered on the target against neighboring targets and equivalent circles around other undersized targets. Exclude inline text targets and unmodified user-agent controls; apply other exceptions only through explicit annotations. | **Pass:** Every evaluated target is at least 24 × 24 CSS px or satisfies an applicable spacing/annotated exception. **On failure report:** element, accessible role/name, rendered bounds, nearest conflicting target, geometric distance/intersection, applicable exception status, viewport, and state. |


++**Quantitative Observations**++


|                               |                                                                                                                                                                                                                                                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**                      | **Implementation**                                                                                                                                                                                                                                                                                                                                             | **Output**                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Rendered Style Vocabulary** | From the shared style snapshot, collect rendered colors, borders, radii, shadows, icon size/stroke/fill, and motion properties for visible controls, surfaces, icons, and annotated components. Normalize equivalent values, deduplicate exact values, and report closest color pairs in OKLab plus adjacent numeric values for radii, strokes, and durations. | **Reference:** Strong systems reuse a compact visual vocabulary. Equivalent components should usually share treatment; isolated near-duplicates may indicate drift. Borders generally communicate structure/state, shadows elevation, and nested radii should feel geometrically related. **Observed:** “9 background colors; 2 one-off colors closely match common values. Radii: 0, 8, 10, 12, 9999 px; 10 px occurs once.” |
| **Rendered Contrast Profile** | Reuse resolved foreground/background pairs from contrast checking. Calculate APCA Lc for resolvable text and single-color icons, recording font size/weight and explicit text role where available. Aggregate identical signatures.                                                                                                                            | **Reference:** Body text: **Lc 75+**; other readable text: **Lc 60+**; large text: **Lc 45+**; UI components: **Lc 30+**. Higher contrast may be preferable depending on role and context. **Observed:** “Median Lc 82; lowest five Lc 41–53. 13 px metadata renders at Lc 48.”                                                                                                                                               |
| **Peer Visual Consistency**   | Group by [data-component-type], then variant/state where available. Create a normalized visual-style signature for each instance and report the modal treatment plus deviations.                                                                                                                                                                               | **Reference:** Repeated components in the same role and state should generally share visual treatment. Isolated deviations are more meaningful than intentional variant/state differences. **Observed:** “10 of 11 secondary buttons share the same treatment; one differs in radius and shadow.”                                                                                                                             |


1. 

### Criteria Based Evaluation

You are evaluating the Visual System quality of a generated interface. Use the rendered screenshots, representative interactive states, supplied diagnostic evidence, and accessibility evidence.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive qualities and weaknesses or missed opportunities.
- Cite the observable visual or diagnostic evidence behind every material finding.
- Treat reference guidance and quantitative observations as calibration, not automatic violations. A deliberate design choice is not a weakness merely because it differs from a reference value.
- Judge whether visual choices form an intentional and effective system rather than imposing one particular aesthetic.
- Do not evaluate page-level spacing, grouping, alignment, or responsive composition here; those belong to **Layout**. Do not evaluate type scale or text legibility here; those belong to **Typography**.
- Assign each material finding to the criterion it most directly affects. Do not count the same issue multiple times.
- Do not assign numeric scores to individual criteria.

++**A/ Color and Emphasis**++

**Criterion:** Color should create a coherent hierarchy, communicate meaning consistently, and direct attention with appropriate restraint.

**Evaluate:**

- **Palette coherence:** Colors form an intentional system rather than accumulating arbitrary or near-duplicate hues and shades.
- **Visual hierarchy:** Neutral, accent, and semantic colors establish clear levels of emphasis; secondary elements do not compete unnecessarily with primary content or actions.
- **Semantic consistency:** Colors used for interaction, selection, success, warning, danger, information, or other recurring meanings retain those meanings throughout the interface.
- **Purposeful emphasis:** Strong filled color is reserved for elements that genuinely require prominence rather than applied broadly as decoration.
- **Perceptual contrast:** Foreground and background combinations provide appropriate distinction for their role, including beyond the minimum accessibility threshold.

**Reference:** Strong color systems are built from a small number of purposeful ramps and semantic roles rather than isolated values. Each color step should have a job

**Relevant Evidence:** Screenshots, representative states, Required Contrast, Rendered Visual System Profile.

++**B/ Components and Visual Language**++

**Criterion:** Repeated components, surfaces, shapes, icons, and visual details should feel like parts of the same intentional design system.

**Evaluate:**

- **Component consistency:** Equivalent buttons, inputs, cards, badges, menus, panels, and other repeated components use coherent visual treatment.
- **Surface hierarchy:** Backgrounds, borders, shadows, and elevation make relationships between surfaces understandable without unnecessary layering or decoration.
- **Shape coherence:** Radii and shape choices form a small, intentional vocabulary, with nested shapes relating naturally to one another.
- **Icon coherence:** Icons used together share a compatible family, drawing style, sizing, and optical weight.
- **Optical alignment:** Icons and asymmetric visual elements appear visually aligned with surrounding text and controls rather than relying only on mathematical centering.
- **Detail restraint:** Borders, shadows, effects, and decorative treatments contribute to structure, hierarchy, state, or depth rather than accumulating visual noise.

**Relevant Evidence:** Screenshots, repeated-component states, Rendered Visual System Profile.

++**C/ Interaction States and Accessibility**++

**Criterion:** Interactive components and states should remain clearly perceivable, understandable, and operable across pointer, keyboard, and assistive interaction.

**Evaluate:**

- **State distinction:** Hover, focus, active, selected, disabled, loading, validation, and destructive states are clearly distinguishable where applicable.
- **State consistency:** Equivalent components communicate equivalent states through a coherent visual and semantic language.
- **Focus:** Keyboard focus is clearly visible, persistent, and consistent with the wider visual system.
- **Accessible semantics:** Controls expose appropriate names, roles, values, and states to the accessibility tree, and visible labels agree with their accessible representation.
- **Targeting:** Interactive targets provide sufficient hit area and separation for reliable activation.
- **Redundant meaning:** Important selection, status, validation, or other meaning does not depend on color or motion alone.
- **Motion restraint:** Motion supports feedback, hierarchy, or continuity without becoming the only indication of state or repeatedly drawing attention away from the task.
- **Reduced motion:** Non-essential animation respects reduced-motion preferences where applicable.

**Relevant Evidence:** Automated Accessibility Violations, Required Contrast, Keyboard Focus Visibility, Minimum Pointer Target Size, accessibility tree, representative interactive states, Rendered Visual System Profile.

1. 

### Overall Visual System Scoring

Use the criterion findings as evidence to make one holistic judgment about the Visual System as a whole.

Base the score on the **severity and consequence** of the findings, not their number. Do not average criteria or give each criterion equal weight. Give greatest weight to weaknesses that affect the user's ability to perceive hierarchy, distinguish meaning or state, understand controls, or operate the interface. Accessibility failures should affect the score according to their consequence to the primary experience, not simply because a rule was triggered.

  



|                     |                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The Visual System materially improves how clearly and confidently the interface can be understood and used. Color, components, visual language, and interaction states form an exceptionally coherent, purposeful, and accessible system across required states. No material Visual System weakness is present.                              |
| **4: Strong:**      | - The Visual System is coherent, purposeful, and accessible across the interface. Color, components, visual language, and interaction states work consistently and effectively together. Minor or localized weaknesses may remain, but none materially affects the primary experience.                                                         |
| **3: Competent**    | - The Visual System is generally coherent and usable, but noticeable inconsistencies or weaknesses in color, components, visual language, interaction states, or accessibility reduce clarity or confidence. The primary experience remains readily understandable and operable.                                                               |
| **2 - Poor:**       | - One or more Visual System weaknesses materially impair the primary experience. Inconsistent or misleading visual treatment, weak state distinction, accessibility problems, or substantial system fragmentation make important information or interactions harder to perceive, understand, or operate. The interface remains usable in part. |
| **1 - Failing:**    | - The Visual System does not reliably communicate or support the interface. Fundamental problems with visual distinction, semantic meaning, accessibility, component consistency, or interaction states make important information or actions difficult or impossible to perceive, understand, or operate reliably.                            |


## 4. Content Quality (For Review)

**What this measures:** Does the interface communicate clearly and efficiently, with useful writing and purposeful imagery, using only as much content as the task needs?

1. 

### Criteria Based Evaluation	

You are evaluating the Content Quality of a generated interface. Use the user request, rendered screenshots, and representative interface states.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive qualities and weaknesses or missed opportunities.
- Cite the specific text, imagery, or interface state behind every material finding.
- Judge content in context rather than applying stylistic rules mechanically.
- Do not penalize an interface for omitting content or imagery that the task does not need.
- Assign each finding to the criterion it most directly affects.
- Do not assign numeric scores to individual criteria.

++**A/ Clarity and Actionability**++

**Criterion**: The words on screen should make the interface easy to understand and act on.

**Evaluate**:

- **Clear language:** Labels, descriptions, instructions, and messages use direct, familiar language appropriate to the user, domain, and stakes.
- **Action clarity:** Buttons, links, toggles, and other controls make their action, destination, or resulting state clear when it is not already obvious from context.
- **Useful guidance:** Instructions tell the user what they need to know or do rather than describing the interface itself.
- **State communication:** Empty, validation, success, and error states clearly explain the situation and, where action is required, provide a useful next step or path to recovery.
- **Specificity**: Copy refers concretely to the task and domain rather than relying on vague, generic, promotional, or filler language.

**Reference**: Prefer plain, specific language that can be understood on the first pass. Action labels should name the action or outcome rather than rely on generic wording when the consequence matters. Links should communicate where they lead. Toggle labels should describe the enabled state. Errors should explain how to recover, and empty states should orient the user and point toward a useful next action. Preserve intentional product voice where it remains clear and appropriate.

**Use this criterion for:** whether an individual piece of content is understandable and tells the user what they can do.

++**B/ Concision and Consistency**++

**Criterion**: The interface should communicate only as much as the task requires, using a coherent vocabulary and voice throughout.

**Evaluate**:

- **Necessity**: Each heading, description, instruction, or helper message contributes information the user needs.
- **Redundancy**: Information already communicated by the interface is not unnecessarily restated in nearby headings, descriptions, or controls.
- **Proportion**: The amount of explanation matches the complexity and stakes of the task rather than overwhelming it.
- **Terminology**: The same objects and actions use the same terms throughout the interface and across multi-step flows.
- **Voice** **and** **tone**: The product maintains a coherent voice while adapting tone appropriately to context and stakes.
- **Structural** **restraint**: The interface avoids unnecessary introductions, headings, summaries, explanatory sections, or other content layers when a simpler presentation would communicate the same thing.

**Reference**: Clear and brief is generally preferable to clever or verbose. Remove words that do not contribute meaning. Consistency is more useful than stylistic variety: the same concept should not acquire different names across a flow. Voice should remain coherent, while tone may become warmer in low-stakes moments and calmer, plainer, and more explicit as consequences increase.

**Use this criterion for:** how much content is present and whether content is expressed consistently — not whether an individual label is understandable.

++**C/ Image fit and coherence**++

**Criterion**: Imagery should serve the content, suit the task, and form a coherent visual set.

**Evaluate**:

- **Purpose**: Images provide useful context, explanation, identity, evidence, or inspiration rather than arbitrary decoration.
- **Relevance**: The subject and type of imagery fit the content being represented.
- **Framing**: Cropping and sizing preserve the important subject or information.
- **Quality**: Images are appropriate for their displayed size and do not appear visibly stretched, blurred, or degraded.
- **Coherence**: Images serving equivalent roles share an appropriate visual language, treatment, or framing unless variation has a clear purpose.

**Reference**: Imagery should support rather than compete with the task. Images should be relevant to their content, preserve their important subject when cropped, and feel intentionally selected as a set.

**Use this criterion for**: image choice and presentation.

1. 

### Overall Content Quality Scoring

Use the criterion findings to make one holistic judgment about the Content Quality as a whole.

Consider which strengths and weaknesses most affect how easily the user can understand and act. Do not average criteria, give each criterion equal weight, or determine the score by counting findings. Imagery should affect the score only when it is present or materially called for by the task.

  



|                     |                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **5: Exceptional** | - Content is exceptionally clear, concise, and well judged for the task. The writing or imagery meaningfully improves how easily the interface can be understood and used. No material Content Quality weaknesses are present. |
| **4: Strong:**      | - Content is clear, concise, and coherent throughout. No material Content Quality weakness affects understanding or action, though localized improvements are possible.                                                        |
| **3: Competent**    | - Content is generally understandable and usable, but noticeable weaknesses in clarity, concision, consistency, or imagery increase effort or reduce quality. They do not materially impair the primary experience.            |
| **2 - Poor:**       | - One or more Content Quality weaknesses materially make the interface harder to understand or act on. The experience remains usable, but content meaningfully interferes with the primary task.                               |
| **1 - Failing:**    | - Content problems make important information, actions, or states difficult or impossible to understand reliably. The content does not adequately support the primary experience.                                              |


  


## 5. Task Fit (For Review)

### 1. Criteria based Evaluation:

You are evaluating the Task Fit of a generated interface. Use the user request, rendered screenshots, supplied requirement tree where available, and interactive evidence.

For each criterion:

- Judge against the user's actual goal and requirements, not assumptions about the product category.
- Accept functionally equivalent solutions; do not require literal wording or implementation.
- Do not reward additional features simply for being present.
- Treat unspecified details as design choices, not requirements.
- Assign each finding to the criterion it most directly affects.
- Do not assign numeric scores to individual criteria.

++**A/ Intent and Interface Choice**++

**Criterion:** The interface should reflect what the user is trying to accomplish and use an interaction model suited to that task.

**Evaluate:**

- **Core intent:** The main workflow directly supports the user's underlying goal.
- **Interface choice:** The chosen components and interaction pattern fit the work being done.
- **Task priority:** The primary task is immediately apparent and not displaced by secondary use cases.

**Reference:** Strong product design starts from the user's job and chooses the simplest interaction model that supports it; the interface should make the primary task obvious without requiring users to translate their goal into the product's structure.

**Relevant Evidence:** User request, screenshots, representative interaction state.

++**B/ Requirement Coverage**++

**Criterion:** The interface should provide the capabilities needed to complete the requested task.

**Evaluate:**

- **Explicit requirements:** Capabilities the user named are represented.
- **Necessary support:** Supporting functionality required to complete the task is present.
- **Priority:** Core requirements receive more prominence than optional capabilities.

**Reference:** Strong implementations cover the complete primary workflow before adding secondary functionality. Missing a necessary step is more consequential than omitting an optional enhancement.

**Relevant Evidence:** User request, screenshots, representative interaction state.

++**C/ Scope and Restraint**++

**Criterion:** The interface should contain what the task needs without introducing unnecessary product scope or complexity.

**Evaluate:**

- **Relevant scope:** Features and regions contribute meaningfully to the task.
- **Restraint:** The interface avoids invented workflows, settings, entities, or features without a clear user need.
- **Appropriate defaults:** Ambiguous requirements are resolved with simple, reversible choices rather than unnecessary complexity.

**Reference:** Good product design minimizes unnecessary choices, steps, and features. Additional functionality should earn its complexity by making the primary task meaningfully easier or more capable.

**Relevant Evidence:** User request, screenshots

++**D/ Domain Fit**++

**Criterion:** The interface should feel genuinely adapted to the user's domain rather than like a generic template.

**Evaluate:**

- **Domain relevance:** Objects, fields, terminology, and actions fit the requested domain.
- **Specificity:** Content is concrete enough to make the interface understandable and useful.
- **No unsupported fabrication:** Invented facts or data are not presented as though supplied by the user.

**Reference:** Strong domain interfaces use the concepts and language users already work with while avoiding fabricated specificity. Example data should clarify how the product works, not imply facts that are not known.

**Relevant Evidence:** User request, screenshots

  


### 2. Overall Task Fit Scoring:

Use the criterion findings to make one holistic judgment about how well the interface fits the requested task. Do not average criteria or reward additional functionality merely because more was built.

  



|                     |                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The interface shows an exceptional understanding of the user's goal. Interface choice, requirement coverage, scope, and domain treatment reinforce one another in a way that materially improves how easily or effectively the task can be completed. No material Task Fit weakness is present. |
| **4: Strong:**      | - The interface fits the task very well. The interaction model, capabilities, scope, and domain treatment are appropriate, with no material mismatch affecting the primary task. Minor omissions or unnecessary elements may remain.                                                              |
| **3: Competent**    | - The interface broadly fits the task, but noticeable mismatches, omissions, or unnecessary scope increase effort or reduce usefulness. The primary task remains well supported overall.                                                                                                          |
| **2 - Poor:**       | - One or more Task Fit weaknesses materially impair the primary task. Important capabilities may be missing, the interaction model may be poorly suited, or unnecessary scope may significantly interfere with the experience. The task is still supported in part.                               |
| **1 - Failing:**    | - The interface fundamentally misunderstands or fails to support the user's intended task. The primary goal cannot be adequately accomplished with the interface provided.                                                                                                                        |


  


## 6. Functionality (For Review)

**What this measures:** Do all parts of the application function as expected? Do the main paths carry a task through to a result, and does what's on screen reflect the actual data and state rather than a plausible-looking placeholder?

1. 

### Diagnostic Evidence

**Deterministic Findings**


|                                     |                                                                                                                                                                                                                                                                                                                           |                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                            | **Implementation**                                                                                                                                                                                                                                                                                                        | **Output**                                                                                                                                         |
| **Interactive Control Operability** | Select visible enabled buttons, links, form controls, and interactive ARIA roles. Use normal Playwright actions with actionability checks enabled and no force. Flag controls that cannot be clicked/focused because they are hidden, unstable, covered, detached, or not receiving events. Reset state between controls. | **Pass** means the action could be performed. It does not establish the correctness of the resulting outcome.                                      |
| **No-Effect Action Controls**       | For visible enabled buttons/action controls, capture URL, ARIA state, dialog/popover visibility, DOM mutations, network requests, and configured app events. Click once and wait for settle. Flag when no non-focus effect is detected.                                                                                   | **Pass:** Every evaluated action causes a detectable effect. **On failure:** control, before/after effect signature, viewport, state.              |
| **Editable Control Response**       | For visible enabled text inputs, textareas, selects, and editable ARIA controls, enter a fixture value different from the current value and verify the resulting value/selection updates. Exclude read-only and non-text controls.                                                                                        | **Pass:** Each control accepts and reflects input. **On failure:** control, attempted value, resulting value, viewport, state.                     |
| **Toggle / Selection State**        | For checkboxes, radios, switches, tabs, disclosures, and pressed/selected controls, record initial state, interact once, and verify the native/ARIA state changes. Where aria-controls exists, verify associated content changes consistently.                                                                            | **Pass:** Declared and rendered state update consistently. **On failure:** control, state property, before/after value, associated content state.  |
| **Internal Navigation Integrity**   | Activate visible same-origin links/navigation controls with resolvable targets. Verify the resulting route/fragment matches the target and does not enter a configured error/404 state. Exclude external, mail, tel, and download links.                                                                                  | **Pass:** Navigation reaches a valid declared target. **On failure:** control, target, resulting URL/view, error state.                            |
| **Form Submission Response**        | Populate required fields with deterministic valid fixture values, submit the form, and verify a submission effect such as navigation, network request, DOM/state change, or configured success/error state.                                                                                                               | **Pass:** Valid submission produces a detectable outcome. **On failure:** form, submit control, validity state, observed effects, viewport, state. |


1. 

### Criteria based Evaluation

You are evaluating the Functionality quality of a generated interface. Use the user request, interactive application, resulting states, and supplied diagnostic evidence to evaluate each Functionality criterion below.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive functional qualities and weaknesses or failures.
- Judge what actually happens when the interface is used, not what controls appear to promise.
- Exercise important workflows far enough to observe their resulting state.
- Treat deterministic findings as evidence to interpret, not as proof that the application works correctly.
- Distinguish cosmetic interaction from meaningful task completion.
- Judge displayed state and data against the actions that produced them.
- Assign each material finding to the criterion it most directly affects. Do not count the same underlying issue multiple times.
- Do not assign numeric scores to individual criteria.

++**A/ Task Completion**++

**Criterion:** The application's main workflows should carry the user from their starting point to the intended result.

**Evaluate:**

- **End-to-end completion:** Primary workflows can actually be completed.
- **Meaningful outcome:** Actions produce the task-level result implied by the user's request.
- **Path continuity:** Required steps do not end in dead ends, inert controls, or incomplete intermediate states.
- **Primary-path reliability:** The main workflow works consistently without requiring unusual workarounds.

**Reference:** Strong products support the primary job end to end. A workflow is not functional simply because each screen or control exists; the sequence must produce a meaningful result.

**Relevant Evidence:**  
User request, before/after states, No-Effect Action Controls, Form Submission Response, Internal Navigation Integrity.

++**B/ Interaction Correctness**++

**Criterion:** Interactive elements should behave consistently with what their presentation and context promise.

**Evaluate:**

- **Control behavior:** Buttons, inputs, navigation, selection, disclosure, and other controls perform their implied actions.
- **Input handling:** Entered and selected values are accepted and used correctly.
- **Consistency:** Equivalent controls behave consistently across the application.
- **Predictability:** Users can reasonably anticipate the result of an interaction from the control's label, state, and context.

**Reference:** Strong interactions are predictable before use and understandable afterward. Controls that look and read the same should behave the same.

**Relevant Evidence:**  
Interactive Control Operability, Editable Control Response, Toggle / Selection State, before/after screenshots and interaction states.

**C/ State and Data Integrity**

**Criterion:** What the application displays should accurately reflect its actual data, state, and user actions.

**Evaluate:**

- **State accuracy:** Selections, edits, filters, submissions, and navigation are reflected correctly on screen.
- **Data consistency:** The same entity or value remains consistent across views and components.
- **Derived results:** Totals, summaries, charts, statuses, and other outputs update consistently with their inputs.
- **No simulated success:** Fixed, fabricated, or placeholder results are not presented as though produced by the user's action.
- **Persistence where needed:** State is retained across relevant steps when the task requires it.

**Reference:** A strong interface maintains a trustworthy representation of state. User actions should produce causally consistent changes, and the same underlying data should not contradict itself across the experience.

**Relevant Evidence:**  
Inputs versus outputs, before/after states, repeated representations of the same data

++**D/ Feedback and Recovery**++

**Criterion:** The application should make action outcomes understandable and remain usable when actions are incomplete, invalid, or unsuccessful.

**Evaluate:**

- **Action feedback:** The user can tell whether an action is processing, succeeded, failed, or changed state.
- **Validation:** Invalid or incomplete input is surfaced clearly and can be corrected.
- **Failure handling:** Errors do not falsely appear successful or leave the application in an unexplained state.
- **Recovery:** Users can retry, revise, undo, reset, or otherwise recover where the task reasonably requires it.

**Reference:** Consequential actions should leave users knowing what happened and what to do next. Errors should preserve a practical path forward rather than create unexplained dead ends.

**Relevant Evidence:**  
Loading, validation, success, failure, retry, reset, and undo states where applicable.

1. 

### Overall Functionality Scoring

Use the criterion findings as evidence to make one holistic judgment about the Functionality as a whole.

Consider which strengths and weaknesses are most consequential to the requested task, how they interact, and whether they reinforce or undermine confidence that the application actually works. Do not average criterion findings, give each criterion equal weight, or determine the score by counting positive or negative findings.

Give greatest weight to failures that prevent, invalidate, or misrepresent the primary workflow.

Select the 1–5 anchor that best characterizes the overall quality of the Functionality, and explain which criterion findings were decisive to that judgment.

  



|                     |                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The application performs the requested task exceptionally reliably from start to finish. Primary workflows, interactions, state, data, feedback, and recovery all behave correctly across required states, including meaningful edge or recovery cases. The implementation materially increases confidence in the experience. No material functional weakness is present. |
| **4: Strong:**      | - The requested functionality works reliably. Core workflows complete correctly, controls behave predictably, and displayed state and data reflect user actions. Minor or localized functional weaknesses may remain, but none materially affects the primary task.                                                                                                         |
| **3: Competent**    | - The primary task can be completed, but noticeable functional weaknesses, inconsistencies, or incomplete states increase effort or reduce confidence. They do not materially prevent or invalidate the primary workflow.                                                                                                                                                   |
| **2 - Poor:**       | - One or more functional failures materially impair the primary task. Broken paths, incorrect state, misleading results, or unreliable interactions significantly reduce usability or trust, although meaningful parts of the application still work.                                                                                                                       |
| **1 - Failing:**    | - The application does not reliably perform the requested task. Core workflows cannot be completed, important interactions fail, or displayed state or data cannot be trusted sufficiently to use the application.                                                                                                                                                          |


  
