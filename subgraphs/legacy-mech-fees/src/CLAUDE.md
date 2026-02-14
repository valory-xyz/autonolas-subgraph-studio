# src/

AssemblyScript mapping handlers for legacy mech fee tracking.

## Files

| File | What | When to read |
| --- | --- | --- |
| `README.md` | Handler architecture, burn filtering, fee flow, known edge cases | Understanding fee tracking design, debugging calculations, known data gaps |
| `mapping.ts` | Event/call handlers for mech creation, fee-in, fee-out, price updates | Modifying fee tracking, adding new handlers |
| `utils.ts` | Global state, daily aggregation, mech-daily tracking helpers | Modifying aggregation logic, adding new utility functions |
| `constants.ts` | Burn address constant | Changing burn address filtering |
