// ─────────────────────────────────────────────────────────────────────────────
// DEPARTMENTS
//
// The same six knowledge domains (see questions.js) are measured within each
// department. Only ONE department is assessed by the live check — the SOP this
// prototype is built from is Pediatrics — so the other three carry illustrative
// mockup scores (see navigators.js). Edit names/order freely.
// ─────────────────────────────────────────────────────────────────────────────

export const DEPARTMENTS = [
  { id: 'pediatrics', name: 'Pediatrics' },
  { id: 'adult', name: 'Adult Medicine' },
  { id: 'obgyn', name: 'OB/GYN' },
  { id: 'behavioral', name: 'Behavioural Health' },
];

// The department the live check actually scores. The check-taker only gets a
// row in this department; elsewhere they show as not-yet-assessed.
export const ASSESSED_DEPT = 'pediatrics';

export const departmentName = (id) => DEPARTMENTS.find((d) => d.id === id)?.name ?? id;
