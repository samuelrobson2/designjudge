## 4. Content Quality

**What this measures:** Does the interface communicate clearly and efficiently, with useful writing and purposeful imagery, using only as much content as the task needs?

### Evaluation States:

- **Baseline Desktop:** Representative default state at a 1920 × 1080 desktop viewport (the most common desktop resolution worldwide, StatCounter 2026) with realistic content and normal strings (typical fixture).
- **Baseline Mobile:** The same content and task state at 360 × 800, the narrowest common mobile viewport (StatCounter 2026), rendered as a touch viewport (device pixel ratio 2, phone user agent).
- **Representative Interactive States:** One or more task-critical non-default states, such as submitted validation, an applied filter, an open task-critical panel, a selected item, or a completed action. They are found automatically at desktop, tablet and mobile: the harness clicks each distinct control on a fresh page, measures how much the page changes (new or removed content, including panels that slide onto the screen, dialogs or overlays, validation messages, page height, and moved elements), and keeps up to three controls at each viewport whose clicks lead to different screens, those that open or announce something first and then the largest changes. The judge sees screenshots of those at desktop and at mobile; those at tablet are not shown. Steps declared with the interface override discovery.
- **Empty Content:** The Baseline Desktop viewport with the empty fixture, so the interface shows its own empty state. Collected only when the interface exposes a fixture interface.

Each state's text is also given as an outline taken from the page's accessibility tree after it rendered: one line per element in page order, with its role, accessible name and text. The Baseline Desktop outline is complete up to a length limit; the other states list only what differs from their baseline.

Collection standards:

- **Render-settled signal:** the page clock is paused, and each wait gives the page a fixed amount of page time (5 s after a load, 1.5 s after an action, 0.5 s after focus or hover), then holds until the page is quiet: no requests in flight, no running animations, no DOM or layout changes, fonts loaded and images complete. A 30 s wall-clock cap only aborts; no timing value enters the evidence.
- **Content fixtures:** empty, typical, dense, expanded, and stress, supplied through the application's own data interface. The harness passes the fixture name; it never edits rendered text.
- **Determinism:** fixed clock and seeded randomness during collection; animations are completed before screenshots.

### Criteria based Evaluation:

You are evaluating the Content Quality of a generated interface. Use the user request, rendered screenshots, the page text, and representative interface states.

For each criterion:

- Assess every listed evaluation point that is applicable.
- Identify both positive qualities and weaknesses or missed opportunities.
- For every finding, cite the specific text, imagery, or interface state behind it, explain why it matters to that criterion, and label it material or minor:
  - **Material:** a user doing the primary task would notice the difference. Fixing the weakness, or losing the strength, would change how easily the task is understood or completed.
  - **Minor:** localized or cosmetic. It would not change how easily the primary task is understood or completed.
- Judge content in context rather than applying stylistic rules mechanically.
- Do not penalize an interface for omitting content or imagery that the task does not need.
- Assign each finding to the criterion it most directly affects.
- Do not assign numeric scores to individual criteria.

++**A/ Clarity and Actionability**++

**Criterion:** The words on screen should make the interface easy to understand and act on.

**Evaluate:**

- **Clear language:** Labels, descriptions, instructions, and messages use direct, familiar language appropriate to the user, domain, and stakes.
- **Action clarity:** Buttons, links, toggles, and other controls make their action, destination, or resulting state clear when it is not already obvious from context.
- **Useful guidance:** Instructions tell the user what they need to know or do rather than describing the interface itself.
- **State communication:** Empty, validation, success, and error states clearly explain the situation and, where action is required, provide a useful next step or path to recovery.
- **Specificity:** Copy refers concretely to the task and domain rather than relying on vague, generic, promotional, or filler language.

**Reference:** Prefer plain, specific language that can be understood on the first pass. Action labels should name the action or outcome rather than rely on generic wording when the consequence matters. Links should communicate where they lead. Toggle labels should describe the enabled state. Errors should explain how to recover, and empty states should orient the user and point toward a useful next action. Preserve intentional product voice where it remains clear and appropriate.

**Use this criterion for:** whether an individual piece of content is understandable and tells the user what they can do.

++**B/ Concision and Consistency**++

**Criterion:** The interface should communicate only as much as the task requires, using a coherent vocabulary and voice throughout.

**Evaluate:**

- **Necessity:** Each heading, description, instruction, or helper message contributes information the user needs.
- **Redundancy:** Information already communicated by the interface is not unnecessarily restated in nearby headings, descriptions, or controls.
- **Proportion:** The amount of explanation matches the complexity and stakes of the task rather than overwhelming it.
- **Terminology:** The same objects and actions use the same terms throughout the interface and across multi-step flows.
- **Voice and tone:** The product maintains a coherent voice while adapting tone appropriately to context and stakes.
- **Structural restraint:** The interface avoids unnecessary introductions, headings, summaries, explanatory sections, or other content layers when a simpler presentation would communicate the same thing.

**Reference:** Clear and brief is generally preferable to clever or verbose. Remove words that do not contribute meaning. Consistency is more useful than stylistic variety: the same concept should not acquire different names across a flow. Voice should remain coherent, while tone may become warmer in low-stakes moments and calmer, plainer, and more explicit as consequences increase.

**Use this criterion for:** how much content is present and whether content is expressed consistently — not whether an individual label is understandable.

++**C/ Image Fit and Coherence**++

**Criterion:** Imagery should serve the content, suit the task, and form a coherent visual set.

**Evaluate:**

- **Purpose:** Images provide useful context, explanation, identity, evidence, or inspiration rather than arbitrary decoration.
- **Relevance:** The subject and type of imagery fit the content being represented.
- **Framing:** Cropping and sizing preserve the important subject or information.
- **Quality:** Images are appropriate for their displayed size and do not appear visibly stretched, blurred, or degraded.
- **Coherence:** Images serving equivalent roles share an appropriate visual language, treatment, or framing unless variation has a clear purpose.

**Reference:** Imagery should support rather than compete with the task. Images should be relevant to their content, preserve their important subject when cropped, and feel intentionally selected as a set. Judge imagery by how well it serves its role, not by its medium: appropriate illustrations, renderings, or icons can serve as well as photographs. Do not rate imagery lower for not being a photograph, or for not showing the specific real-world item, when it appropriately represents the content.

**Use this criterion for:** image choice and presentation.

### Overall Content Quality Scoring:

Use the criterion findings to make one holistic judgment about the Content Quality as a whole.

Consider which strengths and weaknesses most affect how easily the user can understand and act. Do not average criteria, give each criterion equal weight, or determine the score by counting findings. Imagery should affect the score only when it is present or materially called for by the task.

|                     |                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **5: Exceptional** | - Content is exceptionally clear, concise, and well judged for the task. The writing or imagery meaningfully improves how easily the interface can be understood and used. No material Content Quality weaknesses are present. |
| **4: Strong:**      | - Content is clear, concise, and coherent throughout. No material Content Quality weakness affects understanding or action, though localized improvements are possible.                                                        |
| **3: Competent**    | - Content is generally understandable and usable, but noticeable weaknesses in clarity, concision, consistency, or imagery increase effort or reduce quality. They do not materially impair the primary experience.            |
| **2 - Poor:**       | - One or more Content Quality weaknesses materially make the interface harder to understand or act on. The experience remains usable, but content meaningfully interferes with the primary task.                               |
| **1 - Failing:**    | - Content problems make important information, actions, or states difficult or impossible to understand reliably. The content does not adequately support the primary experience.                                              |
