# AEGIS — Revised Prototype

## Run locally

```bash
npm install
npm run dev
```

Open the localhost URL shown by Vite.

## What this revision adds

- Real OpenStreetMap basemap through MapLibre GL
- Three visible danger levels:
  - Critical
  - High
  - Moderate / extended propagation
- Wind-driven animated particles
- Candidate safe zones approximately 100–200 m from the incident in the prototype geometry
- Rescue-team route
- Personal "Find My Safe Route" flow using browser geolocation
- 3D immersive threat field with nested danger volumes
- 3D wind particles
- 3D safe-zone beacons and rescue path
- Functional mode switching, setup, map controls, route buttons and immersive view

## Important prototype note

The threat-radius formula and safe-zone placement are UI/demo logic. For a real emergency system, replace them with validated fire/explosion models, authoritative building/terrain data, a routing engine, live weather APIs and incident-command validation.
