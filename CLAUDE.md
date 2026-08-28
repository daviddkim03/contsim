# contsim

Container packing simulator. Read PROJECT.md first: it is the spec and the phased build plan.

## Commands

- `npm run dev` / `npm run build` / `npm run preview`
- `npm test` (Vitest, tests live in `tests/**/*.test.ts`), `npm run test:watch`
- `npm run lint` (ESLint + Prettier check), `npm run format`, `npm run typecheck`

## Rules

- `src/core` is pure and framework-free: no DOM, no three.js, no imports from `src/ui` (enforced by ESLint).
- Dims are integers inside `src/core`; unit scaling happens at the UI boundary (PROJECT.md section 2).
- Keep lint and tests green at every commit. One phase of PROJECT.md per commit.
