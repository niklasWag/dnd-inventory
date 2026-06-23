/**
 * @app/rules — pure, deterministic rule modules (OUTLINE §6).
 *
 * MVP M0 ships type-signature-only stubs for capacity, attunement, charges,
 * weight, hoard, validation, pricing, and search. They throw at runtime so
 * accidental calls fail loudly. Implementations land per the post-MVP release
 * milestones tracked in docs/roadmap.md.
 *
 * currency.ts (MVP §8) ships its real implementation in MVP M4. inventory.ts
 * lands with M5 and is intentionally NOT exported yet.
 */

export * as capacity from './capacity';
export * as attunement from './attunement';
export * as charges from './charges';
export * as weight from './weight';
export * as hoard from './hoard';
export * as validation from './validation';
export * as pricing from './pricing';
export * as search from './search';
export * as currency from './currency';
