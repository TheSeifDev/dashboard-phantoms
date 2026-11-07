# Execution Plan — SWE Light (Member Details Drawer)

## Objectives
Analyze and fix layout, typography, and spacing defects in the Member Details Drawer in `frontend/` to satisfy:
- R1: Fix Drawer Layout Defects (header accommodates long names > 50 chars without awkward wrapping, RTL close button alignment without floating/overlap).
- R2: Apply Editorial Visual Design (asymmetric grids, generous whitespace, typographic hierarchy, break away from generic SaaS cards).
- R3: Maintain Token Compatibility (8px scale, standard Tailwind token classes, no arbitrary pixel values, CSS variables `var(--surface)`, `var(--text)`).
- Design Principles & Banned Patterns: zero emojis, no purple gradients, no glassmorphism, no Inter, editorial calm precise aesthetic.

## Sequential Stages
1. **Stage 1: Implementation (teamwork_preview_implementer)**
   - Dispatch implementer with verbatim task.
   - Implementer locates component, inspects issues, updates layout/styles, runs tests/build, and returns handoff report.
2. **Stage 2: Review Round 1 (teamwork_preview_reviewer)**
   - Dispatch reviewer with verbatim task and implementer report.
   - Reviewer attempts to break diff, tests edge cases (long names, 390x844 viewport, RTL), refines code and tests.
3. **Stage 3: Review Round 2 (teamwork_preview_reviewer)**
   - Further adversarial stress-testing and refinement against acceptance criteria.
4. **Stage 4: Review Round 3 (teamwork_preview_reviewer)**
   - Final review round meeting the 3-round minimum floor requirement.
5. **Stage 5: Victory Auditor (teamwork_preview_victory_auditor)**
   - Independent verification and audit.
6. **Stage 6: Orchestrator Verification & Final Reporting**
   - Verify diff, re-run test/build commands, format human/parent report, send via `send_message`.
