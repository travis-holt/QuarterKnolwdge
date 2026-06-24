// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATORS — now sourced from Firestore (no more sample data).
//
// In the original prototype this file held SAMPLE_NAVIGATORS (illustrative
// rows). The Firebase pilot removed them: the matrix now starts empty and fills
// with real submissions from the `results` collection (see src/lib/db.js).
//
// The live data shape that flows through the app is unchanged — each navigator
// row is still { name, scores: { [domainId]: percent } }, exactly what
// buildMatrixRows() in lib/scoring.js expects. A Firestore result document maps
// to that shape directly.
//
// This file is intentionally left as a placeholder (no exports) so the data/
// folder still documents where navigator data lives.
// ─────────────────────────────────────────────────────────────────────────────

export {};
