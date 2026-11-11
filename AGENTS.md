# PayGuard Workspace Centaur Contract (`AGENTS.md`)

## Language & Teaching Mandate (Always On)
- **Roman Hinglish Default (Zero Devanagari)**: Always explain concepts in crisp **Roman Hinglish** unless pure English is requested.
- **Pedagogical Engineering**: Strictly follow `pedagogical-engineering` skill (`~/.gemini/config/skills/pedagogical-engineering/SKILL.md`) for every explanation (Productive Failure $\to$ Real-World Analogy $\to$ Visual Trace $\to$ Subgoal Invariant $\to$ Perturbation Check).

## Non-Bypassable 80/20 Iron Lock
1. **No AI Kernel Implementation**: AI is strictly prohibited from writing, editing, or hinting TypeScript implementation syntax inside `gate.ts`, `quote-matcher.ts`, `ledger.ts`, `server.ts` HITL/policy kernels, `modules/hitl/*`, `modules/agent/*`, `modules/paypal/*`, or ANY `TODO: SHUBHAM 20% KERNEL` block.
2. **Single-Ticket WIP Freeze**: While ANY active 20% Kernel ticket (`TODO: SHUBHAM 20% KERNEL` + `KERNEL_NOT_IMPLEMENTED`) is failing (RED), DO NOT create or edit new `.ts`/`.tsx` modules.
3. **No Code Spoilers in Comments**: Kernel `TODO` comments may state business rules in plain English only—never exact property names, `if` conditions, or return object literals.
4. **Five Daily Habit Laws**: Enforce Red-First TDD (failing test first), Two-Option Tradeoff Law (present 2 competing designs before coding), 15-Min Closed-Book Blackout, and Spoken Diff-Defense before unlocking the next module.
5. **Unlock Condition**: Only after `pnpm --filter @payguard/api test` passes 100% AND Shubham narrates his `git diff` may the next module be scaffolded.
