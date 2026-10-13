## 5. Task Fit

**What this measures:** Does the interface reflect what the user is trying to accomplish, provide the capabilities the task needs without unnecessary scope, and feel adapted to the user's domain?

### Evaluation States:

- **Baseline Desktop:** Representative default state at a 1920 × 1080 desktop viewport (the most common desktop resolution worldwide, StatCounter 2026) with realistic content and normal strings (typical fixture).
- **Baseline Mobile:** The same content and task state at 360 × 800, the narrowest common mobile viewport (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, phone user agent).
- **Representative Interactive States:** One or more task-critical non-default states, such as submitted validation, an applied filter, an open task-critical panel, a selected item, or a completed action. They are found automatically at desktop, tablet and mobile: the harness clicks each distinct control on a fresh page, measures how much the page changes (new or removed content, including panels that slide onto the screen, dialogs or overlays, validation messages, page height, and moved elements), and keeps up to three controls at each viewport whose clicks lead to different screens, those that open or announce something first and then the largest changes. The judge sees screenshots of those at desktop and at mobile; those at tablet are not shown. Steps declared with the interface override discovery.

Collection standards:

- **Render-settled signal:** the load event, document.fonts.ready, 500 ms without network activity, and 500 ms without layout changes, capped at 15 s; the condition that ended the wait is recorded.
- **Content fixtures:** empty, typical, dense, expanded, and stress, supplied through the application's own data interface. The harness passes the fixture name; it never edits rendered text.
- **Determinism:** fixed clock and seeded randomness during collection; animations are completed before screenshots.

### Criteria based Evaluation:

You are evaluating the Task Fit of a generated interface. Use the user request, rendered screenshots, and representative interaction states.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive qualities and weaknesses or missed opportunities.
- For every finding, cite the observable evidence, explain why it matters to that criterion, and label it material or minor:
  - **Material:** a user doing the primary task would notice the difference. Fixing the weakness, or losing the strength, would change how easily the task is understood or completed.
  - **Minor:** localized or cosmetic. It would not change how easily the primary task is understood or completed.
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

**Relevant Evidence:** User request, screenshots.

++**D/ Domain Fit**++

**Criterion:** The interface should feel genuinely adapted to the user's domain rather than like a generic template.

**Evaluate:**

- **Domain relevance:** Objects, fields, terminology, and actions fit the requested domain.
- **Specificity:** Content is concrete enough to make the interface understandable and useful.
- **No unsupported fabrication:** Invented facts or data are not presented as though supplied by the user.

**Reference:** Strong domain interfaces use the concepts and language users already work with while avoiding fabricated specificity. Example data should clarify how the product works, not imply facts that are not known.

**Relevant Evidence:** User request, screenshots.

### Overall Task Fit Scoring:

Use the criterion findings to make one holistic judgment about how well the interface fits the requested task. Do not average criteria or reward additional functionality merely because more was built.

|                     |                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5: Exceptional** | - The interface shows an exceptional understanding of the user's goal. Interface choice, requirement coverage, scope, and domain treatment reinforce one another in a way that materially improves how easily or effectively the task can be completed. No material Task Fit weakness is present. |
| **4: Strong:**      | - The interface fits the task very well. The interaction model, capabilities, scope, and domain treatment are appropriate, with no material mismatch affecting the primary task. Minor omissions or unnecessary elements may remain.                                                              |
| **3: Competent**    | - The interface broadly fits the task, but noticeable mismatches, omissions, or unnecessary scope increase effort or reduce usefulness. The primary task remains well supported overall.                                                                                                          |
| **2 - Poor:**       | - One or more Task Fit weaknesses materially impair the primary task. Important capabilities may be missing, the interaction model may be poorly suited, or unnecessary scope may significantly interfere with the experience. The task is still supported in part.                               |
| **1 - Failing:**    | - The interface fundamentally misunderstands or fails to support the user's intended task. The primary goal cannot be adequately accomplished with the interface provided.                                                                                                                        |
