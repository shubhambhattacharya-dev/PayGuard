# PayGuard Workspace Centaur Contract (`AGENTS.md`)

## Non-Bypassable 80/20 Iron Lock
1. **No AI Kernel Implementation**: AI is strictly prohibited from writing or hinting TypeScript implementation syntax inside `apps/api/src/modules/policy/gate.ts` or any `TODO: SHUBHAM 20% KERNEL` block.
2. **Single-Ticket WIP Gate**: Do not create or edit new `.ts` modules while `gate.spec.ts` is failing (RED).
3. **No Code Spoilers in Comments**: Kernel `TODO` comments may state business rules in plain English only—never exact property names, `if` conditions, or return object literals.
4. **Unlock Condition**: Only after `pnpm --filter @payguard/api test` passes 5/5 tests written by Shubham may the next T-shaped module (LLM Security / System Design / DevOps) be scaffolded.
