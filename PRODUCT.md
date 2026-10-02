# Product

## Register

product

## Users

Primary: a warehouse safety supervisor at a desk in a lit office, working through a shift's flagged camera clips (forklift near misses, people in restricted lanes, someone down). They need to see what happened, decide whether it matters, and move on.

Secondary: hackathon judges watching a live demo on a laptop or projector. They need to understand the product in seconds, so the core loop (cameras, alert, review, verdict) must read at a glance.

## Product Purpose

Warehouse Sentinel prioritizes safety footage for human review. A detection pipeline proposes candidate incidents, a vision-language verifier keeps or rejects them, and the supervisor reviews what's left from one place: live cameras, an alert feed, a site floor plan, and an assistant that answers questions from the incident ledger only. Success is a supervisor confidently clearing the queue without missing a real event. It is not an emergency detector, does not identify people, and is not for judging individual workers.

## Brand Personality

Calm, precise, trustworthy. Quiet by default so that a real alert stands out. Plain, specific language; no hype, no surveillance theatrics.

## Anti-references

- Sci-fi surveillance or "hacker" HUDs: neon on black, glows, scanlines, targeting reticles.
- Badge soup: pills, chips, and tiny gray labels on every element competing for attention.

## Design Principles

1. **Quiet until it matters.** Neutral surfaces and restrained color, so severity color is reserved for actual incidents.
2. **One way to say each thing.** A status gets one treatment everywhere; no stacking a dot, a pill, and a label for the same fact.
3. **Footage first.** Video and the floor plan are the content; chrome stays out of their way.
4. **Earned familiarity.** Behave like Linear: dense, precise, keyboard friendly, standard patterns.
5. **Honest about uncertainty.** Candidates, verified, and rejected are always distinguishable, in words, not only color.

## Accessibility & Inclusion

WCAG AA contrast for text and essential UI. Fully keyboard usable (tabs switch with arrow keys, `/` focuses the assistant, 1-4 focus zones, Esc closes review). Respect `prefers-reduced-motion` for pulses and pings. Never rely on color alone for severity or verification state.
