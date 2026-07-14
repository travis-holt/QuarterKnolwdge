import { useRef, useState } from 'react';
import { statusCounts } from '../lib/questionBankView.js';
import QuestionBank from './QuestionBank.jsx';
import AuditBank from './AuditBank.jsx';

// The supervisor "Questions" view used to render QuestionBank immediately
// followed by AuditBank on one page, forcing a scroll through the entire
// Scenario Question Bank just to reach the Spot-the-Error bank. This adds a
// top-level accessible tablist so only one assessment bank is visible at a
// time. Both QuestionBank and AuditBank stay mounted (toggled via the native
// `hidden` attribute, not unmounted) so each bank's own internal tab/filter/
// expand state survives switching back and forth — `hidden` also removes the
// inactive panel from layout (no height) and from the tab order/a11y tree,
// so it can't be reached by keyboard while hidden. Neither bank's internals
// are touched here; this only decides which one is visible.
const BANKS = [
  {
    id: 'scenario',
    label: 'Scenario Questions',
    description: 'Multiple-choice scenarios for the standard knowledge check.',
  },
  {
    id: 'spot',
    label: 'Spot the Error',
    description: 'Flawed call transcripts for the QA-audit assessment.',
  },
];

function byDept(list, selectedDept) {
  return list.filter((item) => (item.department ?? 'pediatrics') === selectedDept);
}

export default function AssessmentBankSelector({ questions, audits, selectedDept, questionBankProps, auditBankProps }) {
  const [activeBank, setActiveBank] = useState('scenario');
  const tabRefs = useRef({});

  const deptAudits = byDept(audits, selectedDept);
  const counts = {
    scenario: statusCounts(byDept(questions, selectedDept)),
    spot: {
      draft: deptAudits.filter((a) => (a.status ?? 'active') === 'draft').length,
      active: deptAudits.filter((a) => (a.status ?? 'active') === 'active').length,
    },
  };

  // Roving-tabindex keyboard navigation (WAI-ARIA APG tabs pattern, automatic
  // activation) — same shape as the status tabs inside QuestionBank itself.
  const handleTabKeyDown = (e, index) => {
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % BANKS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + BANKS.length) % BANKS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = BANKS.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextBank = BANKS[nextIndex].id;
    setActiveBank(nextBank);
    tabRefs.current[nextBank]?.focus();
  };

  return (
    <section className="assessbank view-enter">
      <div className="assessbank-tabs" role="tablist" aria-label="Assessment bank">
        {BANKS.map((bank, index) => (
          <button
            key={bank.id}
            ref={(el) => { tabRefs.current[bank.id] = el; }}
            type="button"
            role="tab"
            id={`assessbank-tab-${bank.id}`}
            aria-selected={activeBank === bank.id}
            aria-controls={`assessbank-tabpanel-${bank.id}`}
            tabIndex={activeBank === bank.id ? 0 : -1}
            className={`assessbank-tabs__tab${activeBank === bank.id ? ' is-active' : ''}`}
            onClick={() => setActiveBank(bank.id)}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
          >
            <span className="assessbank-tabs__label">{bank.label}</span>
            <span className="assessbank-tabs__desc">{bank.description}</span>
            <span className="assessbank-tabs__counts">
              {counts[bank.id].draft} draft · {counts[bank.id].active} active
            </span>
          </button>
        ))}
      </div>

      <div
        id="assessbank-tabpanel-scenario"
        role="tabpanel"
        aria-labelledby="assessbank-tab-scenario"
        hidden={activeBank !== 'scenario'}
      >
        <QuestionBank {...questionBankProps} />
      </div>
      <div
        id="assessbank-tabpanel-spot"
        role="tabpanel"
        aria-labelledby="assessbank-tab-spot"
        hidden={activeBank !== 'spot'}
      >
        <AuditBank {...auditBankProps} />
      </div>
    </section>
  );
}
