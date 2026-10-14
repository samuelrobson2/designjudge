<task>
Interface {{INTERFACE_ID}} was generated for this request:

{{REQUEST}}
</task>

<states>
The interface was captured in these states. The IDs in parentheses name them in the evidence; use them in the states of your findings.

{{STATES}}
</states>

<screenshots>
Each screenshot or sheet is preceded by its ID and a description of what it shows. Red rectangles with a red number tag on the page screenshots were drawn by the evaluation, not by the interface: each marks where an automated check failed, and the number is the issue number in the evidence under the criteria.

{{SCREENSHOTS}}
</screenshots>

{{CRITERIA}}
{{NOTES}}
Assess criteria A, B and C in order, using the evidence under each criterion and any screenshot or sheet. Then make the holistic judgment and choose the score. Return JSON that matches the schema.
