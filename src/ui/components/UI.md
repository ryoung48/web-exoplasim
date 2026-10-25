# UI.md

Use this as the baseline guidance for any UX or UI work in `src\ui\components`.

## Core rules

- Always use shared design tokens for colors, spacing, radius, shadows, typography, and similar visual values.
- Create new shared tokens when an appropriate one does not already exist.
- Never introduce hardcoded colors, font sizes, font families, spacing values, border radii, or ad hoc visual constants when a shared token or helper should exist.
- Prefer existing shared components, primitives, and composites as the starting point for new UI.
- If the current shared building blocks are not enough, create or extend shared components instead of duplicating one-off patterns.
- Keep styling decisions centralized and reusable.

## Component expectations

- Build new screens from shared primitives first, then shared composites, then feature-specific wrappers.
- Reuse the same interaction and visual patterns for buttons, panels, drawers, headers, labels, rows, and controls.
- Avoid copy-pasting markup for common UI structures when a shared component can represent that pattern.
- Keep APIs small, predictable, and composable.

## Styling expectations

- Prefer tokens and shared utilities over inline styles or scattered class values.
- If a repeated visual decision cannot be expressed with existing tokens, add a token instead of hardcoding it locally.
- Keep visual hierarchy consistent across screens.
- Use semantic naming for tokens and components; avoid naming based on a one-off page or temporary context.
- When a new visual pattern is needed more than once, promote it into a shared primitive or composite.

## UX expectations

- Optimize for clarity first: strong hierarchy, readable labels, predictable actions, and obvious states.
- Preserve consistency across loading, empty, error, disabled, and success states.
- Make interactive targets clear and accessible.
- Avoid visual noise and unnecessary novelty.
- When a surface displays real-world-ish metrics or units, always wire every displayed value through the shared conversion/formatting helpers so metric and imperial stay consistent everywhere; do not hardcode display units or one-off conversions in feature files.

## Practical rule of thumb

If a UI decision affects more than one surface, it should usually live in shared tokens, shared utilities, or shared components rather than inside a single feature file.
