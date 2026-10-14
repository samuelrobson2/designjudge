## 6. Functionality

**What this measures:** Do all parts of the application function as expected? Do the main paths carry a task through to a result, and does what's on screen reflect the actual data and state rather than a plausible-looking placeholder?

### Evaluation States:

- **Baseline Desktop:** Representative default state at a 1920 × 1080 desktop viewport (the most common desktop resolution worldwide, StatCounter 2026) with realistic content and normal strings (typical fixture).
- **Baseline Mobile:** The same content and task state at 360 × 800, the narrowest common mobile viewport (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, phone user agent).
- **Representative Interactive States:** One or more task-critical non-default states, such as submitted validation, an applied filter, an open task-critical panel, a selected item, or a completed action. They are found automatically at desktop, tablet and mobile: the harness clicks each distinct control on a fresh page, measures how much the page changes, and keeps up to three controls per viewport whose clicks lead to different screens; it then tries a second click from the best of them and applies every choice that changed the page together. The judge sees screenshots of those at desktop and at mobile, of up to two states reached by two clicks or by applying several choices at desktop, and of the screen after each form is submitted. Controls that appear only in the states shown are used as well.
- **Form Submissions:** Each form is submitted on a freshly loaded page twice: as loaded, and after its fields are filled in with deterministic valid values and one option is chosen in each choice group left empty. The judge sees the screen after the filled-in submission.

Collection standards:

- **Render-settled signal:** the page clock is paused, and each wait gives the page a fixed amount of page time (5 s after a load, 1.5 s after an action, 0.5 s after focus or hover), then holds until the page is quiet: no requests in flight, no running animations, no DOM or layout changes, fonts loaded and images complete. A 30 s wall-clock cap only aborts; no timing value enters the evidence.
- **Content fixtures:** empty, typical, dense, expanded, and stress, supplied through the application's own data interface. The harness passes the fixture name; it never edits rendered text.
- **Determinism:** fixed clock and seeded randomness during collection; animations are completed before screenshots.
- **Using the controls:** controls are found on the page at load and in the interactive states shown, and grouped by tag, role, type, classes and data attributes; one control of each group is used (the others are named with it). The page is loaded again (and the interaction replayed) whenever the previous control changed something. Elements that change by themselves (clocks, carousels) during 400 ms of watching before each use are not counted as effects.

### Diagnostic Evidence:

1. **Deterministic Findings:**


|                                     |                                                                                                                                                                                                                                                                                                                           |                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                            | **Implementation**                                                                                                                                                                                                                                                                                                        | **Output Example**                                                                                                                                 |
| **Interactive Control Operability** (controls that cannot be clicked or focused as they are) | Select visible enabled buttons, links, form controls, interactive ARIA roles, and focusable or scripted elements styled as clickable; a visually hidden input is used through its visible label. Use normal Playwright actions with actionability checks enabled and no force (a trial click, which performs the checks without clicking). Flag controls that cannot be clicked/focused because they are hidden, unstable, covered, detached, or not receiving events. Controls inside a closed panel moved off the screen are not evaluated. Reset state between controls. | **Pass:** The action could be performed. It does not establish the correctness of the resulting outcome. **On failure report:** control, reason, viewport, state. |
| **No-Effect Action Controls** (buttons and other action controls that do nothing when clicked) | For visible enabled buttons/action controls, capture URL, ARIA state, dialog/popover visibility, DOM mutations, network requests, scrolling of at least 50 px, and calls that change nothing on the page (copying to the clipboard, opening a window, printing, storing data, changing the history). Click once and wait for settle. Flag when no non-focus effect is detected. | **Pass:** Every evaluated action causes a detectable effect. **On failure:** control, before/after effect signature, viewport, state. |
| **Editable Control Response** (fields that do not keep what is entered) | For visible enabled text inputs, textareas, selects, and editable ARIA controls, enter a fixture value different from the current value and verify the resulting value/selection updates. Fields are filled in page order, as a user fills a form, and every value is read back after the last one is left. Exclude read-only and non-text controls. | **Pass:** Each control accepts and reflects input. **On failure:** control, attempted value, resulting value, viewport, state. |
| **Toggle / Selection State** (toggles and selectable controls whose state does not update consistently) | For checkboxes, radios, switches, tabs, disclosures, and pressed/selected controls, record initial state, interact once, and verify the native/ARIA state changes. Where aria-controls exists, verify associated content changes consistently. Compare the control's rendered appearance before and after as well: a change in one without the other is inconsistent. | **Pass:** Declared and rendered state update consistently. **On failure:** control, state property, before/after value, associated content state. |
| **Internal Navigation Integrity** (same-page and same-site links that lead nowhere or to an error) | Activate visible same-origin links/navigation controls with resolvable targets. Verify the resulting route/fragment matches the target and does not enter a configured error/404 state. A link to a fragment whose element does not exist, and a placeholder link (href="#" or a javascript: URL) that no script responds to, lead nowhere. Exclude external, mail, tel, and download links. | **Pass:** Navigation reaches a valid declared target. **On failure:** control, target, resulting URL/view, error state. |
| **Form Submission Response** (forms that give no response to a valid submission) | Populate required fields with deterministic valid fixture values (every empty field, one option in each choice group with nothing chosen, and each required checkbox), submit the form, and verify a submission effect such as navigation, network request, a visible change on the page, or configured success/error state. A value lost when the next field is used is entered again before submitting. A redraw that changes nothing visible is not an effect, except when every field already held a value: the form is then resubmitted unchanged, and redrawing the same result is reported separately, not as a failure. | **Pass:** Valid submission produces a detectable outcome. **On failure:** form, submit control, validity state, observed effects, viewport, state. |
| **Invalid Submission Feedback** (forms that give no visible response when submitted empty) | For each form whose valid submission produces an effect, submit it as loaded, without filling anything in, on a freshly loaded page. Verify a visible response: a validation or alert message, a field marked invalid, the browser's own validation, new or changed text, or navigation. | **Pass:** Every evaluated form responds visibly to an empty submission. **On failure:** form, submit control, observed effects, viewport, state. |
| **Runtime Errors** (script errors and failed requests while the page loads or is used) | Record uncaught exceptions, console errors, and same-origin requests that fail or return an HTTP error, while each captured state loads and while the controls and forms above are used. Requests for a favicon are ignored. | **Pass:** No uncaught errors, console errors, or failed same-origin requests. **On failure:** error message, what was being done, viewport, state. |
<!-- added checks -->
| **Count Claims** (a stated count that disagrees with the items listed) | In every captured state whose text is the interface's own (the baselines, the interactive states, and the empty and dense fixtures; not the lengthened expanded and stress fixtures or the Responsive Sweep), read from the state's accessibility outline. Find counts in headings, status lines and short paragraphs that describe a collection ("12 cars", "(n = 8)", "Showing 1–10 of 40"), not counts inside the items; numbers followed by a unit or attribute (miles, minutes, doors, reviews) and years are not counts. Compare each with the largest run of repeated items (cards, list items, or table rows other than header rows) in its section or in the next list, table or region. Fail when the count differs from the items listed, unless the count is larger and a control shows more (load more, next page, show all); also fail a count over a section that says it is empty, and, after a single filter option carrying its own count is selected, a result list of a different length. | **Pass:** Every evaluated count matches its items, or exceeds them with a control to show more. **On failure report:** the text, the count, the items listed, viewport, and state. |
| **Totals Against Line Items** (a total that does not add up from its line items) | In every captured state whose text is the interface's own (the baselines, the interactive states, and the empty and dense fixtures; not the lengthened expanded and stress fixtures or the Responsive Sweep), read from the state's accessibility outline. Find text that starts with Total (order, grand, basket or booking total; total due, to pay, price, paid or cost) followed by one amount, or with its amount in the next element. Sum the line items before it in its region, dialog or article: list items and table rows with an amount, each counted by its last amount or by quantity × unit price; a Subtotal line replaces the sum. Fail when the total differs from the sum by more than 0.01. A total is not evaluated when a delivery, shipping, tax, discount, fee or similar adjustment line is listed, or when there are fewer than two line items. | **Pass:** Every evaluated total equals its line items. **On failure report:** the total, the line amounts and their sum, viewport, and state. |
| **Sort-Order Claims** (a stated sort or rank order that the values shown do not follow) | In every captured state whose text is the interface's own (the baselines, the interactive states, and the empty and dense fixtures; not the lengthened expanded and stress fixtures or the Responsive Sweep), read from the state's accessibility outline. Find text outside the items that states an order ("Ranked by revenue", "Sorted by price: low to high", "Nearest first", "Newest") and the option selected in a sort control. Infer the value (amount, number sold, distance, mileage, year or rating) and direction, read that value from each of at least three repeated items in the same section, and fail when any neighbouring pair is out of order. A price followed by "above", "off" or similar is a threshold, not the item's price; a distance needs "away" or "from". | **Pass:** Every evaluated list follows its stated order. **On failure report:** the stated order, the number of pairs out of order, an example pair, viewport, and state. |
| **Period Claims** (a stated time period that the dates or labels shown contradict) | In every captured state whose text is the interface's own (the baselines, the interactive states, and the empty and dense fixtures; not the lengthened expanded and stress fixtures or the Responsive Sweep), read from the state's accessibility outline, except the fixtures. At the fixed clock used for collection, in the page's time zone: fail a short heading, caption or paragraph naming a window (last hour, last 24 hours, today, last 7 or 30 days, this month) over at least two repeated items when any date listed in those items falls outside the window (dates need a real month name); and, when a date-range or period control has an option selected, fail metric labels that name a different period (a comparison such as "vs last month" is not a label of the period). | **Pass:** Every evaluated period matches the dates and labels shown. **On failure report:** the stated period, the dates or labels outside it, viewport, and state. |
| **Opened Detail Identity** (a detail view that names a different item from the one clicked to open it) | In each representative interactive state reached by clicking a control whose name carries an identifier ("#1482", "ORD-2041", "Order 10023"), read the identifiers in the name and headings of each dialog or detail panel open in that state. Fail when the panel shows identifiers and none matches the one clicked. | **Pass:** Every evaluated detail names the item clicked. **On failure report:** the control clicked, the panel's heading, viewport, and state. |
| **Unfilled Template Values** (template placeholders and programming values shown as page text) | In every captured state whose text is the interface's own (the baselines, the interactive states, and the empty and dense fixtures; not the lengthened expanded and stress fixtures or the Responsive Sweep), read from the state's accessibility outline. Fail any text or accessible name that shows an unfilled placeholder ({{name}}, ${name}, <%= name %>, [[name]]); the words undefined, NaN or [object Object]; null or Infinity alone or beside a number, currency sign, colon or percent sign; or a message key (three or more dot- or underscore-joined lower-case segments, not a web address or file name). Link targets and select options are not evaluated. | **Pass:** No page text shows an unfilled template value. **On failure report:** the element, its text, the token found, viewport, and state. |
| **Dependent Action Response** (actions that a selection of items makes available but that do nothing) | For up to two kinds of repeated checkbox outside a form and outside a named group of options (a compare or select box on each item), select one item, then two, then three, each time on a freshly loaded page. After each selection, take the buttons that appeared or stopped being disabled (up to three; ones that only clear, remove or cancel the selection are left out), and use each once on a fresh page with the same selection, watched as for No-Effect Action Controls. Each action is tried at the fewest selected items that make it available. | **Pass:** Every action a selection made available has an effect. **On failure report:** the action, how many items were selected, whether it appeared or became enabled, viewport, and state. |
| **No-Effect Choice Controls** (filter and choice options that change nothing beyond themselves) | For each option used in Toggle / Selection State that sits in a named group (a fieldset, group, radio group, tab list, toolbar or list box), record the changes outside the option itself, its labels and the wrapper that holds only it: DOM changes elsewhere, navigation, requests, calls that store or send something, opened windows and new alert or status messages. Evaluate options whose group or panel is named as a filter, sort or view choice, and options beside another group in the same panel whose use does change the page. Options in a form with a submit button, and in a panel with an Apply-style button, wait to be applied and are not evaluated; an option already selected is not used. | **Pass:** Every evaluated option changes the page beyond itself. **On failure report:** the option, its group, viewport, and state. |
| **Saved State Persistence** (what the page reports as saved is gone after a reload) | For up to three kinds of save-like control outside a form (save, favourite, wishlist, bookmark, shortlist, or a heart or star), use one on a freshly loaded page. The page reports a save when a count next to a saved-items word changes ("Saved (3)", "2 favourites") or a new "Saved" or "Added to your …" message appears. Then reload the page and read the count again, or, for a message, the control's state and name. A control whose click changes only its own pressed state or icon reports nothing and is not evaluated, nor is a message when the control itself did not change. | **Pass:** Every save the page reported is still shown after a reload. **On failure report:** the control, what the page showed after the click, what it shows after the reload, viewport, and state. |
| **Dialog Behaviour** (dialogs and drawers that cannot be closed, let Tab out, or scroll away with the page behind) | For up to four dialogs or drawers that a control opens (a dialog element, role=dialog or alertdialog, aria-modal, or a fixed panel at least half the screen high that was not shown before the click), open each again on a fresh page for every trial. A dialog is modal when the browser marks it so, it has aria-modal="true", or a full-screen layer lies behind it. Fail a dialog that neither Escape nor a close control inside it (Close, Cancel, Done, Back, ×) closes; a non-modal panel that its opener also cannot close. For modal dialogs only, also fail when Tab, pressed once past each control inside, moves focus to an element on the page behind (focus leaving to the browser, or to the page's "Skip to …" link, is allowed), and when wheeling over the backdrop scrolls the page behind by 50 px or more and the dialog moves with it (or leaves the screen); a page that scrolls behind a dialog held in place is not reported. | **Pass:** Every dialog tried can be closed, and every modal one keeps focus inside and stays in place. **On failure report:** the dialog, the control that opened it, what failed, viewport, and state. |
<!-- end -->


1. **Quantitative Observations:**

<!-- before added checks -->
None. Functionality's evidence is what happened when the interface was used.
<!-- end -->
<!-- added checks -->
|                                 |                    |                    |
| ------------------------------- | ------------------ | ------------------ |
| **Name**                        | **Implementation** | **Output Example** |
| **Validation Message Wording** (validation messages that name neither the field nor the fix) | In each representative interactive state, collect the messages that appeared after the interaction and were not on the page at load at the same viewport: text in alert or status regions, text beside a field marked invalid, and text worded as a validation message. When no interactive state at desktop or at mobile shows messages, use the messages that appeared when each form was submitted empty. Report the messages that consist only of a generic phrase ("Error", "Invalid input", "Required", "This field is required", "Something went wrong", "Please fix the errors"). | - **Reference:** A validation message should say which field is wrong and how to fix it (WCAG 3.3.1 Error Identification and 3.3.3 Error Suggestion); a generic phrase helps only when it sits directly beside the one field it refers to. - **Observed:** “2 of the 3 messages that appeared after clicking "Book now" name neither the field nor the fix: "Invalid input", "Required".” |
<!-- end -->

### Criteria based Evaluation:

You are evaluating the Functionality quality of a generated interface. Use the user request, interactive application, resulting states, and supplied diagnostic evidence to evaluate each Functionality criterion below.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive functional qualities and weaknesses or failures.
- For every finding, cite the observable evidence, explain why it matters to that criterion, and label it material or minor:
  - **Material:** a user doing the primary task would notice the difference. Fixing the weakness, or losing the strength, would change how easily the task is understood or completed.
  - **Minor:** localized or cosmetic. It would not change how easily the primary task is understood or completed.
- Judge what actually happens when the interface is used, not what controls appear to promise.
- Exercise important workflows far enough to observe their resulting state.
- Treat deterministic findings as evidence to interpret, not as proof that the application works correctly.
- Distinguish cosmetic interaction from meaningful task completion.
- Judge displayed state and data against the actions that produced them.
- Assign each finding to the criterion it most directly affects. Do not count the same underlying issue multiple times.
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

- **Screenshots:** User request, before/after states, form submissions.
<!-- before added checks -->
- **Diagnostic Evidence:** No-Effect Action Controls, Form Submission Response, Internal Navigation Integrity.
<!-- end -->
<!-- added checks -->
- **Diagnostic Evidence:** No-Effect Action Controls, Form Submission Response, Internal Navigation Integrity, Dependent Action Response.
<!-- end -->

++**B/ Interaction Correctness**++

**Criterion:** Interactive elements should behave consistently with what their presentation and context promise.

**Evaluate:**

- **Control behavior:** Buttons, inputs, navigation, selection, disclosure, and other controls perform their implied actions.
- **Input handling:** Entered and selected values are accepted and used correctly.
- **Consistency:** Equivalent controls behave consistently across the application.
- **Predictability:** Users can reasonably anticipate the result of an interaction from the control's label, state, and context.

**Reference:** Strong interactions are predictable before use and understandable afterward. Controls that look and read the same should behave the same.

**Relevant Evidence:**

- **Screenshots:** Before/after screenshots and interaction states.
<!-- before added checks -->
- **Diagnostic Evidence:** Interactive Control Operability, Editable Control Response, Toggle / Selection State.
<!-- end -->
<!-- added checks -->
- **Diagnostic Evidence:** Interactive Control Operability, Editable Control Response, Toggle / Selection State, No-Effect Choice Controls.
<!-- end -->

++**C/ State and Data Integrity**++

**Criterion:** What the application displays should accurately reflect its actual data, state, and user actions.

**Evaluate:**

- **State accuracy:** Selections, edits, filters, submissions, and navigation are reflected correctly on screen.
- **Data consistency:** The same entity or value remains consistent across views and components.
- **Derived results:** Totals, summaries, charts, statuses, and other outputs update consistently with their inputs.
- **No simulated success:** Fixed, fabricated, or placeholder results are not presented as though produced by the user's action.
- **Persistence where needed:** State is retained across relevant steps when the task requires it.

**Reference:** A strong interface maintains a trustworthy representation of state. User actions should produce causally consistent changes, and the same underlying data should not contradict itself across the experience.

**Relevant Evidence:**

- **Screenshots:** Inputs versus outputs, before/after states, repeated representations of the same data.
<!-- before added checks -->
- **Diagnostic Evidence:** None; judged from the screenshots.
<!-- end -->
<!-- added checks -->
- **Diagnostic Evidence:** Count Claims, Totals Against Line Items, Sort-Order Claims, Period Claims, Opened Detail Identity, Unfilled Template Values, Saved State Persistence.
<!-- end -->

++**D/ Feedback and Recovery**++

**Criterion:** The application should make action outcomes understandable and remain usable when actions are incomplete, invalid, or unsuccessful.

**Evaluate:**

- **Action feedback:** The user can tell whether an action is processing, succeeded, failed, or changed state.
- **Validation:** Invalid or incomplete input is surfaced clearly and can be corrected.
- **Failure handling:** Errors do not falsely appear successful or leave the application in an unexplained state.
- **Recovery:** Users can retry, revise, undo, reset, or otherwise recover where the task reasonably requires it.

**Reference:** Consequential actions should leave users knowing what happened and what to do next. Errors should preserve a practical path forward rather than create unexplained dead ends.

**Relevant Evidence:**

- **Screenshots:** Loading, validation, success, failure, retry, reset, and undo states where applicable.
<!-- before added checks -->
- **Diagnostic Evidence:** Invalid Submission Feedback, Runtime Errors.
<!-- end -->
<!-- added checks -->
- **Diagnostic Evidence:** Invalid Submission Feedback, Runtime Errors, Validation Message Wording, Dialog Behaviour.
<!-- end -->

### Overall Functionality Scoring:

Use the criterion findings as evidence to make one holistic judgment about the Functionality as a whole.

Consider which strengths and weaknesses are most consequential to the requested task, how they interact, and whether they reinforce or undermine confidence that the application actually works. Do not average criterion findings, give each criterion equal weight, or determine the score by counting positive or negative findings.

Give greatest weight to failures that prevent, invalidate, or misrepresent the primary workflow.

Select the 1–5 anchor that best characterizes the overall quality of the Functionality, and explain which findings led to it.

|                     |                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The application performs the requested task exceptionally reliably from start to finish. Primary workflows, interactions, state, data, feedback, and recovery all behave correctly across required states, including meaningful edge or recovery cases. The implementation materially increases confidence in the experience. No material functional weakness is present. |
| **4: Strong:**      | - The requested functionality works reliably. Core workflows complete correctly, controls behave predictably, and displayed state and data reflect user actions. Minor or localized functional weaknesses may remain, but none materially affects the primary task.                                                                                                         |
| **3: Competent**    | - The primary task can be completed, but noticeable functional weaknesses, inconsistencies, or incomplete states increase effort or reduce confidence. They do not materially prevent or invalidate the primary workflow.                                                                                                                                                   |
| **2 - Poor:**       | - One or more functional failures materially impair the primary task. Broken paths, incorrect state, misleading results, or unreliable interactions significantly reduce usability or trust, although meaningful parts of the application still work.                                                                                                                       |
| **1 - Failing:**    | - The application does not reliably perform the requested task. Core workflows cannot be completed, important interactions fail, or displayed state or data cannot be trusted sufficiently to use the application.                                                                                                                                                          |
