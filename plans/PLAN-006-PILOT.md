# PLAN-006 — First Real Pilot

## Pilot goal

Use one small, original 3D product-explainer video to prove that the automation is useful before expanding into cloud providers, auto-publishing or a full editor.

## Pilot brief

Create a fictional 30-second tournament-management product explainer with a 9:16 output and a 16:9 variant. Use fictional data, no real-person likeness, approved or self-created assets and a deterministic text overlay.

## Pilot path

```text
brief
  → script draft
  → style bible
  → 5-shot plan
  → reference bundle
  → mock/local generation
  → Blender preview for at least one shot
  → FFmpeg compose
  → captions/audio
  → human review
  → delivery manifest
```

## Pilot measurements

| Metric | Target/observation |
|---|---|
| Time from brief to first preview | Record actual |
| Manual interventions | Count and categorize |
| Accepted shots / attempts | Calculate |
| Retry causes | Continuity, motion, text, tool or policy |
| Local tool health failures | Record |
| Delivery defects | Record |
| Cost | Zero for mock/local; actual if cloud is explicitly approved |
| Agent mistakes | Record instruction/scope/state errors |

## Pilot exit

The pilot succeeds when the user can reproduce the run, understand every manual intervention, recover after a simulated interruption, inspect rights/cost/evidence, and export valid media variants. It fails if the workflow is slower or more confusing than manual work without producing traceability or repeatability benefits.

## Learning loop

After the pilot, remove unnecessary fields, simplify screens, adjust concurrency/retry defaults and update the backlog. Do not respond to friction by adding more generic documentation before testing the actual workflow.
