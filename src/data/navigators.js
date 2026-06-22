// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE NAVIGATORS — illustrative data only (no real people).
//
// Each navigator now has scores per DEPARTMENT, and within each department a
// percentage per domain (domain ids from questions.js). Pediatrics holds the
// original values (the department the live check assesses); Adult Medicine,
// OB/GYN, and Behavioural Health are illustrative mockups so the cross-department
// view looks full.
//
// Shape: { name, departments: { [deptId]: { [domainId]: percent } } }
// Edit names and numbers freely before the demo.
// ─────────────────────────────────────────────────────────────────────────────

export const SAMPLE_NAVIGATORS = [
  {
    name: 'Maya',
    departments: {
      pediatrics: { sites: 90, scheduling: 55, providers: 80, routing: 95, insurance: 70, registration: 88 },
      adult: { sites: 78, scheduling: 60, providers: 72, routing: 80, insurance: 65, registration: 75 },
      obgyn: { sites: 60, scheduling: 50, providers: 55, routing: 62, insurance: 58, registration: 65 },
      behavioral: { sites: 72, scheduling: 65, providers: 70, routing: 75, insurance: 60, registration: 70 },
    },
  },
  {
    name: 'Devon',
    departments: {
      pediatrics: { sites: 60, scheduling: 45, providers: 65, routing: 70, insurance: 50, registration: 62 },
      adult: { sites: 55, scheduling: 48, providers: 60, routing: 58, insurance: 45, registration: 55 },
      obgyn: { sites: 48, scheduling: 40, providers: 50, routing: 52, insurance: 45, registration: 50 },
      behavioral: { sites: 58, scheduling: 52, providers: 55, routing: 60, insurance: 50, registration: 58 },
    },
  },
  {
    name: 'Priya',
    departments: {
      pediatrics: { sites: 88, scheduling: 50, providers: 90, routing: 85, insurance: 92, registration: 75 },
      adult: { sites: 85, scheduling: 70, providers: 82, routing: 80, insurance: 88, registration: 78 },
      obgyn: { sites: 92, scheduling: 85, providers: 90, routing: 88, insurance: 90, registration: 86 },
      behavioral: { sites: 80, scheduling: 75, providers: 78, routing: 82, insurance: 80, registration: 76 },
    },
  },
  {
    name: 'Liam',
    departments: {
      pediatrics: { sites: 55, scheduling: 40, providers: 58, routing: 60, insurance: 55, registration: 50 },
      adult: { sites: 50, scheduling: 45, providers: 52, routing: 55, insurance: 48, registration: 45 },
      obgyn: { sites: 45, scheduling: 42, providers: 48, routing: 50, insurance: 44, registration: 46 },
      behavioral: { sites: 52, scheduling: 48, providers: 50, routing: 55, insurance: 50, registration: 48 },
    },
  },
  {
    name: 'Noor',
    departments: {
      pediatrics: { sites: 92, scheduling: 70, providers: 85, routing: 90, insurance: 88, registration: 90 },
      adult: { sites: 88, scheduling: 80, providers: 85, routing: 86, insurance: 82, registration: 90 },
      obgyn: { sites: 85, scheduling: 78, providers: 82, routing: 80, insurance: 84, registration: 88 },
      behavioral: { sites: 90, scheduling: 82, providers: 86, routing: 88, insurance: 85, registration: 90 },
    },
  },
  {
    name: 'Carlos',
    departments: {
      pediatrics: { sites: 65, scheduling: 55, providers: 72, routing: 50, insurance: 60, registration: 58 },
      adult: { sites: 70, scheduling: 62, providers: 68, routing: 55, insurance: 65, registration: 60 },
      obgyn: { sites: 58, scheduling: 55, providers: 60, routing: 52, insurance: 56, registration: 54 },
      behavioral: { sites: 82, scheduling: 78, providers: 80, routing: 75, insurance: 80, registration: 84 },
    },
  },
];
