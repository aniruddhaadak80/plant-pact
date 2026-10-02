---
name: Bug report
about: Something is wrong, wrong-numbered, or untrue
labels: bug
body:
  - type: textarea
    id: what-happened
    attributes:
      label: What happened
      description: What did you do, what did you see, and what did you expect instead?
    validations:
      required: true
  - type: textarea
    id: where
    attributes:
      label: Route and control
      description: Which page and which control (the sill rail, commit, MCP tool name, API path)?
    validations:
      required: true
  - type: input
    id: live-or-local
    attributes:
      label: Where did you see it?
      placeholder: Live deployment / npm run dev / npm run test
    validations:
      required: true
  - type: textarea
    id: truthfulness
    attributes:
      label: If a number looked wrong, what should it have been?
      description: This project cares most about claims that do not match reality. If a probability, a factor, a forecast label or a live/offline badge was incorrect, say so here.
  - type: textarea
    id: logs
    attributes:
      label: Console or server output
      render: shell