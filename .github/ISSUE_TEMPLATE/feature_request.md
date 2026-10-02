---
name: Feature request
about: Suggest a capability that solves a real problem
labels: enhancement
body:
  - type: textarea
    id: problem
    attributes:
      label: The problem
      description: What are you trying to do that this app does not let you do? Describe the situation, not the solution.
    validations:
      required: true
  - type: textarea
    id: why-not-built
    attributes:
      label: Why does the current app not solve it?
      description: If you tried the workbench, the care card, the MCP tools or the verify route first, say which and where it stopped you.
  - type: textarea
    id: evidence
    attributes:
      label: What would "working" look like?
      description: Concretely: which route, which control, and what real state would change.
  - type: checkboxes
    id: constraints
    attributes:
      label: Constraints
      options:
        - label: This works with no user-supplied API key.
        - label: This works without an account.
        - label: This reuses the existing service layer rather than adding a parallel path.
        - label: This needs no new production environment variable.