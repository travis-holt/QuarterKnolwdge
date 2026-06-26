// ─────────────────────────────────────────────────────────────────────────────
// DEPARTMENTS
//
// The same six knowledge domains (see questions.js) are measured within each
// department. Departments in ASSESSED_DEPTS have a live question bank derived
// from their SOP; the rest carry illustrative mockup scores. Edit names/order
// freely; adding a department to ASSESSED_DEPTS requires a questions-<dept>.js
// seed file + SOP grounding in api/_sop-context.js.
// ─────────────────────────────────────────────────────────────────────────────

export const DEPARTMENTS = [
  { id: 'pediatrics', name: 'Pediatrics' },
  { id: 'adult', name: 'Adult Medicine' },
  { id: 'obgyn', name: 'OB/GYN' },
  { id: 'behavioral', name: 'Behavioural Health' },
];

// Departments with a live check (own active question bank + SOP grounding).
// Adult Medicine and Behavioural Health remain mockup.
export const ASSESSED_DEPTS = ['pediatrics', 'obgyn'];

// Default department for supervisor view on first load.
export const DEFAULT_DEPT = 'pediatrics';

// Back-compat alias used by scoring.test.js and any import that hasn't been
// updated yet. Points to the original single-department value.
export const ASSESSED_DEPT = DEFAULT_DEPT;

/** True if the department has a live check (its own question bank + SOP). */
export const isAssessed = (id) => ASSESSED_DEPTS.includes(id);

export const departmentName = (id) => DEPARTMENTS.find((d) => d.id === id)?.name ?? id;
