# React review

> Components, hooks, state and accessibility for React (and React + TypeScript) code.

## Components

- [ ] Components are small and focused; a component over ~200 lines has a reason.
- [ ] Props are typed (TypeScript types or interfaces); no `any`.
- [ ] Lists use stable, unique `key`s, never the array index for reorderable data.
- [ ] No business logic or data fetching mixed into presentational components.
- [ ] File and folder naming follows the project convention (e.g. `PascalCase.tsx` for components).

## Hooks and state

- [ ] Hooks follow the rules: top level only, never inside conditions or loops.
- [ ] `useEffect` dependency arrays are complete and honest; no disabled lint rule without a comment.
- [ ] Effects clean up subscriptions, timers and listeners.
- [ ] Derived values are computed during render, not mirrored into state with an effect.
- [ ] State lives at the lowest common owner; no prop drilling more than ~3 levels without reason.
- [ ] Repeated stateful logic is extracted into a custom `useSomething` hook.

## Rendering and performance

- [ ] No state updates during render; no new objects or functions passed to memoised children
      without `useMemo` / `useCallback` where it matters.
- [ ] Loading, empty and error states are all handled in the UI.

## Forms and data

- [ ] Inputs are controlled (or deliberately uncontrolled) consistently.
- [ ] User input is validated; errors are shown next to the field.
- [ ] API calls handle failure and do not update state after unmount.

## Accessibility

- [ ] Interactive elements are real buttons or links, not clickable `div`s.
- [ ] Images have meaningful `alt` text (or `alt=""` if decorative); form fields have labels.
- [ ] Works with keyboard only; focus is visible and managed in dialogs.

## Styling

- [ ] No inline styles for things the project's styling approach covers.
- [ ] Layout works at mobile width.
