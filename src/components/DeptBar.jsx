import { DEPARTMENTS, ASSESSED_DEPT } from '../data/departments.js';

// Department selector — scopes the matrix, dashboards and training to one
// department at a time. The assessed department (live check) is marked; the
// others are illustrative mockups.
export default function DeptBar({ selectedDept, setSelectedDept }) {
  return (
    <div className="deptbar">
      <div className="deptbar__pills">
        {DEPARTMENTS.map((d) => (
          <button
            key={d.id}
            className={`deptbar__pill ${selectedDept === d.id ? 'is-active' : ''}`}
            onClick={() => setSelectedDept(d.id)}
          >
            {d.name}
            {d.id === ASSESSED_DEPT && <span className="deptbar__live">live</span>}
          </button>
        ))}
      </div>
      <span className="deptbar__note">
        {selectedDept === ASSESSED_DEPT
          ? 'Assessed by the live check'
          : 'Illustrative mockup data'}
      </span>
    </div>
  );
}
