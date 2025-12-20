# Wytham Woods Birdsong

An interactive visualization of bird vocal activity trends across 81 acoustic loggers placed in a grid at Wytham Woods. Built with SvelteKit, TypeScript, D3.js, and SVG.

## Features

- **Multi-species view**: See all species activity overlaid on a single chart
- **Single species focus**: Click any species to isolate and examine its activity pattern
- **Site-level detail**: Toggle to show individual traces from all 81 acoustic
  loggers

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm, npm, or yarn

### Installation

```bash
# Install dependencies
pnpm install
```

### Development

```bash
# Start development server
pnpm dev

# Type-check
pnpm check

# Build for production
pnpm build
```

The application will typically be available at `http://localhost:5173`.

## Data Format

Place your data at `static/detections/species_data.json` with the following structure:

```json
{
  "metadata": {
    "generatedAt": "2025-12-18T17:38:15",
    "logitThreshold": 10.0,
    "smoothingWindow": 7,
    "dateRange": { "start": "2025-02-15", "end": "2025-09-17" },
    "nSpecies": 10,
    "nSites": 81,
    "nDays": 215
  },
  "species": [
    {
      "name": "Troglodytes troglodytes",
      "total": 1637567,
      "rank": 1,
      "timeSeries": {
        "dates": ["2025-02-15", "2025-02-16", ...],
        "mean": [13.04, 13.11, ...],
        "sites": {
          "A4": [11.25, 14.8, ...],
          "B2": [...]
        }
      }
    }
  ]
}
```

## License

MIT
