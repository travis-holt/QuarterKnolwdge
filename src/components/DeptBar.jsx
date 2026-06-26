import { DEPARTMENTS, isAssessed } from '../data/departments.js';

// Department selector — scopes the matrix, dashboards and training to one
// department at a time. Assessed departments (live checks) are marked; the
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
            {isAssessed(d.id) && <span className="deptbar__live">live</span>}
          </button>
        ))}
      </div>
      <span className="deptbar__note">
        {isAssessed(selectedDept)
          ? 'Assessed by the live check'
          : 'Illustrative mockup data'}
      </span>
    </div>
  );
}
