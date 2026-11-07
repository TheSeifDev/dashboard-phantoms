# Original User Request

## 2026-10-04T10:13:33Z

# Teamwork Project Prompt — Draft

> Requested team: Small focused team

Analyze and fix the layout, typography, and spacing defects in the Member Details Drawer (shown in the provided image) to align with Anthropic's frontend design principles. Ensure correct RTL alignment, establish a distinct visual hierarchy without templated defaults, and resolve clipping/overlapping issues (such as the header close button and member name).

Working directory: C:\Users\aboha\Desktop\adminstrationsystem\frontend
Integrity mode: demo

## Requirements

### R1. Fix Drawer Layout Defects
Resolve the visual bugs shown in the provided image. The header must accommodate long names without awkward wrapping, and the close button must be properly aligned for RTL (physical right/inline-start, or physical left/inline-end, but without floating weirdly or causing overlaps).

### R2. Apply Editorial Visual Design
Redesign the drawer's internal content layout. Break away from the generic "SaaS-card kit" (identical rounded cards with shadows for every piece of info). Use asymmetric grids, generous whitespace, and typographic hierarchy to structure the information cleanly and distinctively.

### R3. Maintain Token Compatibility
Strictly use the existing 8px spacing/radius scale and base color variables (`var(--surface)`, `var(--text)`, etc.). Achieve the distinctive editorial look through arrangement and typography, not by introducing arbitrary new CSS values.

## Acceptance Criteria

### Layout & Responsiveness
- [ ] The member name does not overlap the close button or wrap awkwardly, even for names exceeding 50 characters.
- [ ] No horizontal overflow is introduced when the drawer is open on a 390x844 viewport.

### Aesthetic Execution
- [ ] The drawer's internal sections are NOT all wrapped in identical bordered/shadowed cards.
- [ ] The design utilizes typographic weight and whitespace for grouping, rather than relying solely on container boxes.

### Code Quality
- [ ] No arbitrary pixel values (e.g., `p-[13px]`) are used for spacing or sizing; all layouts use standard Tailwind token classes matching the 8px scale.
