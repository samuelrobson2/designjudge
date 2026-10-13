## 3. Visual System

**What this measures:** Do colors, components, surfaces, icons, and interaction states read as one coherent system? Does visual treatment communicate hierarchy and meaning clearly, consistently, and accessibly?

### Evaluation States:

- **Baseline Desktop:** Representative default state at a 1920 × 1080 desktop viewport (the most common desktop resolution worldwide, StatCounter 2026) with realistic content and normal strings (typical fixture).
- **Baseline Tablet:** The same content and task state at 768 × 1024 in portrait, the most common tablet resolution worldwide (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, tablet user agent).
- **Baseline Mobile:** The same content and task state at 360 × 800, the narrowest common mobile viewport (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, phone user agent).
- **Representative Interactive States:** Task-critical non-default states (such as submitted validation, an applied filter, an open panel, or a selected item), found automatically by clicking each distinct control on a fresh page and keeping up to three per viewport that lead to different screens. The judge sees screenshots of those at desktop and at mobile, and the diagnostics below are measured in them.
- **Controls in Each State:** One example of each kind of control at desktop and at mobile, cut from the page in its default, hover, keyboard-focus, pressed and selected states, with the computed style changes between them. Hover is a real pointer hover, focus is keyboard focus, pressed is forced through the browser's developer protocol, and selected is reached by clicking the control on a freshly loaded page. Touch viewports have no hover.
- **Colour-Vision View:** The desktop first screen as seen with red-green colour blindness (deuteranopia), simulated by the browser.

Collection standards:

- **Render-settled signal:** the load event, document.fonts.ready, 500 ms without network activity, and 500 ms without layout changes, capped at 15 s; the condition that ended the wait is recorded.
- **Content fixtures:** empty, typical, dense, expanded, and stress, supplied through the application's own data interface. The harness passes the fixture name; it never edits rendered text.
- **Determinism:** fixed clock and seeded randomness during collection; animations are completed before screenshots.
- **Probed states:** each baseline and each interactive state the judge sees is loaded again (the interaction replayed), and its rendered styles, the colours behind its text, an axe-core run and, at desktop, a keyboard traversal are captured together with a fresh snapshot of the same page.

### Diagnostic Evidence:

Every finding names the elements involved and the probed state. Colours are reported in sRGB hex after compositing any transparency over what is behind.

1. **Deterministic Findings:**


|                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                               | **Implementation**                                                                                                                                                                                                                                                                                                                                                                                                                                | **Output Example**                                                                                                                                                                                                                                                                                         |
| **Automated Accessibility Violations** (WCAG A and AA rules that axe-core finds violated) | At each probed state, run axe.run() after render settles with WCAG 2.0–2.2 A/AA rules enabled (axe-core's experimental rules stay off, as in its defaults). Treat only violations as failures; report incomplete results separately as unresolved. Disable rules already covered by dedicated checks to avoid duplicates (color-contrast by Required Contrast, target-size by Minimum Pointer Target Size). Report rule ID, impact, affected elements, and failure summary. | **Pass:** axe returns no definite A/AA violations after exclusions. **On failure report:** rule ID, impact, element target, failure summary, viewport, and state. |
| **Required Contrast** (text, form-field boundaries and icon-only controls below their WCAG contrast ratio) | Evaluate visible text and non-text UI indicators needed to identify controls or states: the boundary of each text field, dropdown and text box (its border or fill against what surrounds it) and the icon of each icon-only control. Resolve foreground/background colors from computed styles, compositing through every layer that paints behind the point (found by hit-testing the page) and the element's opacity. Mark complex backgrounds that cannot be reduced to a single color (a picture, video or gradient) as unresolved. Calculate WCAG 2 contrast and apply 4.5:1 for normal text, 3:1 for large text (at least 24 px, or 18.66 px in bold), and 3:1 for required non-text UI information. Placeholder text, disabled controls and text hidden from assistive technology are reported separately, not as failures. | **Pass:** Every resolvable evaluated pair meets its applicable threshold. **On failure report:** element, text/visual role, foreground and background colors, font size/weight where applicable, measured ratio, required ratio, viewport, and state. |
| **Keyboard Focus Visibility** (keyboard focus that shows no visible change) | At the desktop states, traverse visible tabbable elements in native tab order using Playwright Tab, up to 60 stops, stopping when focus returns to a stop already seen. Disabled, hidden, inert, and tabindex="-1" elements are skipped by the browser's own tab order. Animations are completed before each capture. For each focused element, compare its unfocused and :focus-visible states using computed focus-related styles and a crop padded 6 px around it (around its label when the focused control is visually hidden, as a custom checkbox's input is). Flag only when neither computed styles nor rendered pixels change beyond tolerance (4 changed pixels). | **Pass:** Every evaluated keyboard-focusable control produces a persistent visible keyboard-focus indication. **On failure report:** element, accessible role/name, tab position, before/after relevant styles, changed-pixel count/proportion, tolerance used, viewport, and state. |
| **Minimum Pointer Target Size** (pointer targets smaller than 24 × 24 CSS px without the spacing exception) | Evaluate visible enabled pointer targets using getBoundingClientRect(); a visually hidden input is evaluated through its visible label. Pass targets at least 24 × 24 CSS px. For smaller targets, apply the WCAG 2.5.8 spacing exception by testing a 24 px diameter circle centered on the target against neighboring targets and equivalent circles around other undersized targets. Exclude inline text targets (links inside a run of text) and unmodified user-agent controls (checkboxes and radio buttons drawn by the browser at its own size); apply other exceptions only through explicit annotations. | **Pass:** Every evaluated target is at least 24 × 24 CSS px or satisfies an applicable spacing/annotated exception. **On failure report:** element, accessible role/name, rendered bounds, nearest conflicting target, geometric distance/intersection, applicable exception status, viewport, and state. |
<!-- added checks -->
| **Label in Name** (controls whose accessible name leaves out the words they show) | At each probed state, evaluate visible interactive elements with an accessible name: buttons, links, tabs and menu items by the text they show, and form fields by the text of their visible label element. Split the shown text and the accessible name into lower-case words (letters and digits apart); numbers alone are not compared. Fail when more than **half** of the shown words are missing from the accessible name (WCAG 2.5.3 Label in Name: speech-input users say what they see; word order and extra words in the name are allowed). The half threshold is a judgment that tolerates a shortened or reworded name. | **Pass:** Every evaluated control is announced with most of the words it shows. **On failure report:** the control, the text it shows, its accessible name, viewport, and state. |
| **Reduced Motion Support** (animations that keep looping when the page is asked for reduced motion) | At each probed state, load the page a second time with prefers-reduced-motion: reduce and list the animations that run without end (infinite iterations). Fail each one that also loops at a normal load and keeps looping under reduced motion (WCAG 2.2.2 Pause, Stop, Hide and 2.3.3 Animation from Interactions). Whether a looping animation is essential, such as a progress indicator, is left to the judge; every one is reported. | **Pass:** No animation keeps looping when reduced motion is requested. **On failure report:** the animation name, the element, its duration, viewport, and state. |
<!-- end -->


1. **Quantitative Observations:**


|                               |                                                                                                                                                                                                                                                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**                      | **Implementation**                                                                                                                                                                                                                                                                                                                                             | **Output Example**                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Rendered Style Vocabulary** (the colours, corner radii, shadows, icons and motion the interface renders, and values that drift from the rest) | At Baseline Desktop and Baseline Mobile, from the style snapshot of the probed state, collect rendered colors (text, background, border and icon), borders, radii, shadows, icon kind, size, stroke and fill, and motion properties for visible controls, surfaces, icons, and annotated components. Normalize equivalent values, deduplicate exact values, and report closest color pairs in OKLab plus adjacent numeric values for radii, strokes, and icon sizes. A value is reported as drift when it is used by at most 2 elements and lies next to a value used by at least 4: colours within an OKLab distance of 0.01 used for the same purpose, radii within 1 px (a radius nested inside the other's element is not compared), icon sizes within 2 px, or a second stroke width. Also report more than 4 distinct shadows, icons drawn in more than one kind (SVG, text symbols, icon font), a rounded element whose corners are more rounded than the rounded box it sits close inside, and animations that keep running when reduced motion is requested. | **Reference:** Strong systems reuse a compact visual vocabulary. Equivalent components should usually share treatment; isolated near-duplicates may indicate drift. Borders generally communicate structure/state, shadows elevation, and nested radii should feel geometrically related. **Observed:** “9 background colors; 2 one-off colors closely match common values. Radii: 0, 8, 10, 12, 9999 px; 10 px occurs once.” |
| **Rendered Contrast Profile** (APCA lightness contrast of text and UI foregrounds, against the reference for their role) | Reuse resolved foreground/background pairs from contrast checking. Calculate APCA Lc for resolvable text and single-color icons and field boundaries, recording font size/weight and text role (body text as Typography infers it; large text at least 24 px, or 18.66 px in bold). Aggregate identical signatures. Report values below the reference for their role. | **Reference:** Body text: Lc 75+; other readable text: Lc 60+; large text: Lc 45+; UI components: Lc 30+. Higher contrast may be preferable depending on role and context. **Observed:** “Median Lc 82; lowest five Lc 41–53. 13 px metadata renders at Lc 48.” |
| **Peer Visual Consistency** (repeated components whose treatment departs from their peers') | At Baseline Desktop and Baseline Mobile, group by [data-component-type], then variant/state where available; without annotations, group controls and surfaces sharing tag, role and classes. Split each group by declared or class-named state (selected, current, disabled, invalid). Create a normalized visual-style signature for each instance (background, text colour, border, radius, shadow, height) and report the modal treatment plus deviations, in groups of at least three where at least two-thirds share the modal treatment. Differences in height alone follow content and are not reported. | **Reference:** Repeated components in the same role and state should generally share visual treatment. Isolated deviations are more meaningful than intentional variant/state differences. **Observed:** “10 of 11 secondary buttons share the same treatment; one differs in radius and shadow.” |


### Criteria based Evaluation:

You are evaluating the Visual System quality of a generated interface. Use the rendered screenshots, representative interactive states, supplied diagnostic evidence, and accessibility evidence.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive qualities and weaknesses or missed opportunities.
- For every finding, cite the observable visual or diagnostic evidence behind it, explain why it matters to that criterion, and label it material or minor:
  - **Material:** a user doing the primary task would notice the difference. Fixing the weakness, or losing the strength, would change how easily the task is understood or completed.
  - **Minor:** localized or cosmetic. It would not change how easily the primary task is understood or completed.
- Treat reference guidance and quantitative observations as calibration, not automatic violations. A deliberate design choice is not a weakness merely because it differs from a reference value.
- Judge whether visual choices form an intentional and effective system rather than imposing one particular aesthetic.
- Do not evaluate page-level spacing, grouping, alignment, or responsive composition here; those belong to **Layout**. Do not evaluate type scale or text legibility here; those belong to **Typography**.
- Assign each finding to the criterion it most directly affects. Do not count the same issue multiple times.
- Do not assign numeric scores to individual criteria.

++**A/ Color and Emphasis**++

**Criterion:** Color should create a coherent hierarchy, communicate meaning consistently, and direct attention with appropriate restraint.

**Evaluate:**

- **Palette coherence:** Colors form an intentional system rather than accumulating arbitrary or near-duplicate hues and shades.
- **Visual hierarchy:** Neutral, accent, and semantic colors establish clear levels of emphasis; secondary elements do not compete unnecessarily with primary content or actions.
- **Semantic consistency:** Colors used for interaction, selection, success, warning, danger, information, or other recurring meanings retain those meanings throughout the interface.
- **Purposeful emphasis:** Strong filled color is reserved for elements that genuinely require prominence rather than applied broadly as decoration.
- **Perceptual contrast:** Foreground and background combinations provide appropriate distinction for their role, including beyond the minimum accessibility threshold.

**Reference:** Strong color systems are built from a small number of purposeful ramps and semantic roles rather than isolated values. Each color step should have a job.

**Relevant Evidence:**

- **Screenshots:** Desktop, tablet, mobile, representative interactive states, colour-vision view.
- **Diagnostic Evidence:** Required Contrast, Rendered Contrast Profile, Rendered Style Vocabulary.

++**B/ Components and Visual Language**++

**Criterion:** Repeated components, surfaces, shapes, icons, and visual details should feel like parts of the same intentional design system.

**Evaluate:**

- **Component consistency:** Equivalent buttons, inputs, cards, badges, menus, panels, and other repeated components use coherent visual treatment.
- **Surface hierarchy:** Backgrounds, borders, shadows, and elevation make relationships between surfaces understandable without unnecessary layering or decoration.
- **Shape coherence:** Radii and shape choices form a small, intentional vocabulary, with nested shapes relating naturally to one another.
- **Icon coherence:** Icons used together share a compatible family, drawing style, sizing, and optical weight.
- **Optical alignment:** Icons and asymmetric visual elements appear visually aligned with surrounding text and controls rather than relying only on mathematical centering.
- **Detail restraint:** Borders, shadows, effects, and decorative treatments contribute to structure, hierarchy, state, or depth rather than accumulating visual noise.

**Relevant Evidence:**

- **Screenshots:** Desktop, tablet, mobile, controls in each state.
- **Diagnostic Evidence:** Rendered Style Vocabulary, Peer Visual Consistency.

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

**Relevant Evidence:**

- **Screenshots:** Representative interactive states, controls in each state, colour-vision view.
<!-- before added checks -->
- **Diagnostic Evidence:** Automated Accessibility Violations, Required Contrast, Keyboard Focus Visibility, Minimum Pointer Target Size, Peer Visual Consistency.
<!-- end -->
<!-- added checks -->
- **Diagnostic Evidence:** Automated Accessibility Violations, Required Contrast, Keyboard Focus Visibility, Minimum Pointer Target Size, Peer Visual Consistency, Label in Name, Reduced Motion Support.
<!-- end -->

### Overall Visual System Scoring:

Use the criterion findings as evidence to make one holistic judgment about the Visual System as a whole.

Base the score on the severity and consequence of the findings, not their number. Do not average criteria or give each criterion equal weight. Give greatest weight to weaknesses that affect the user's ability to perceive hierarchy, distinguish meaning or state, understand controls, or operate the interface. Accessibility failures should affect the score according to their consequence to the primary experience, not simply because a rule was triggered.

|                     |                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The Visual System materially improves how clearly and confidently the interface can be understood and used. Color, components, visual language, and interaction states form an exceptionally coherent, purposeful, and accessible system across required states. No material Visual System weakness is present.                              |
| **4: Strong:**      | - The Visual System is coherent, purposeful, and accessible across the interface. Color, components, visual language, and interaction states work consistently and effectively together. Minor or localized weaknesses may remain, but none materially affects the primary experience.                                                         |
| **3: Competent**    | - The Visual System is generally coherent and usable, but noticeable inconsistencies or weaknesses in color, components, visual language, interaction states, or accessibility reduce clarity or confidence. The primary experience remains readily understandable and operable.                                                               |
| **2 - Poor:**       | - One or more Visual System weaknesses materially impair the primary experience. Inconsistent or misleading visual treatment, weak state distinction, accessibility problems, or substantial system fragmentation make important information or interactions harder to perceive, understand, or operate. The interface remains usable in part. |
| **1 - Failing:**    | - The Visual System does not reliably communicate or support the interface. Fundamental problems with visual distinction, semantic meaning, accessibility, component consistency, or interaction states make important information or actions difficult or impossible to perceive, understand, or operate reliably.                            |
