# SWE Light Execution Plan — Member Details Drawer Redesign & Fixes

## Objectives
Fix layout, typography, and spacing defects in the Member Details Drawer in `frontend` to align with Anthropic's frontend design principles, ensuring RTL alignment, editorial visual hierarchy, 8px token compatibility, and responsiveness (390x844 viewport, long names >50 chars, no overlap).

## Execution Pipeline
1. **Phase 1: Implementation**
   - Dispatch `teamwork_preview_implementer` to locate the Member Details Drawer component, analyze defects against R1, R2, R3, implement the editorial design, and verify via frontend test scripts.
2. **Phase 2: Adversarial Review Round 1**
   - Dispatch `teamwork_preview_reviewer` to break-test the changes, verify long names (>50 chars), RTL alignment, close button positioning, and test suite execution.
3. **Phase 3: Adversarial Review Round 2**
   - Dispatch fresh `teamwork_preview_reviewer` to inspect token compatibility (8px scale, CSS variables, absence of arbitrary pixel classes), asymmetric grid, whitespace, and typographic hierarchy.
4. **Phase 4: Adversarial Review Round 3**
   - Dispatch fresh `teamwork_preview_reviewer` to test mobile responsiveness (390x844 viewport, no horizontal overflow) and ensure zero banned design patterns (no emoji, no gradients, no SaaS-card kit).
5. **Phase 5: Post-Victory Audit**
   - Dispatch `teamwork_preview_victory_auditor` for blocking verification.
6. **Phase 6: Final Verification & Reporting**
   - Orchestrator checks diff & test outcomes, closes open ledger, and reports back to parent via `send_message`.
