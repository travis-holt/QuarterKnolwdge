import { useState } from 'react';
import { DOMAINS } from '../data/questions.js';
import { COMPETENCIES } from '../data/competencies.js';

// Controlled editor for a single question. Used to review/correct a draft (or an
// active question) before it goes live. Keeps a local working copy and only
// calls onSave with the edited question; validation mirrors the scoring shape.
export default function QuestionEditor({ question, onSave, onCancel }) {
  const [scenario, setScenario] = useState(question.scenario ?? '');
  const [domainId, setDomainId] = useState(question.domainId ?? DOMAINS[0].id);
  const [competencies, setCompetencies] = useState(question.competencies ?? []);
  const [options, setOptions] = useState(
    (question.options ?? []).map((o) => ({ ...o, points: o.points ?? 0, rationale: o.rationale ?? '' }))
  );
  const [correctOptionId, setCorrectOptionId] = useState(question.correctOptionId ?? question.options?.[0]?.id);
  const [error, setError] = useState('');

  const toggleComp = (id) =>
    setCompetencies((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const patchOption = (id, patch) =>
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  const save = () => {
    if (!scenario.trim()) return setError('Scenario text is required.');
    if (competencies.length === 0) return setError('Tag at least one competency.');
    if (options.some((o) => !o.text.trim())) return setError('Every option needs text.');
    // The "best" option (correctOptionId) is forced to 100 so scoring stays consistent.
    const normalized = options.map((o) => ({
      id: o.id,
      text: o.text.trim(),
      points: o.id === correctOptionId ? 100 : Number(o.points) || 0,
      rationale: o.rationale.trim(),
    }));
    setError('');
    onSave({ ...question, scenario: scenario.trim(), domainId, competencies, options: normalized, correctOptionId });
  };

  return (
    <div className="qedit">
      <label className="qedit__field">
        <span className="qedit__label">Scenario</span>
        <textarea className="qedit__textarea" rows={3} value={scenario} onChange={(e) => setScenario(e.target.value)} />
      </label>

      <div className="qedit__row">
        <label className="qedit__field">
          <span className="qedit__label">Domain</span>
          <select className="qedit__select" value={domainId} onChange={(e) => setDomainId(e.target.value)}>
            {DOMAINS.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="qedit__field">
          <span className="qedit__label">Best answer</span>
          <select className="qedit__select" value={correctOptionId} onChange={(e) => setCorrectOptionId(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>Option {o.id.toUpperCase()}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="qedit__field">
        <span className="qedit__label">Competencies</span>
        <div className="qedit__comps">
          {COMPETENCIES.map((c) => (
            <label key={c.id} className={`qedit__chip ${competencies.includes(c.id) ? 'is-on' : ''}`}>
              <input type="checkbox" checked={competencies.includes(c.id)} onChange={() => toggleComp(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
      </div>

      <div className="qedit__field">
        <span className="qedit__label">Options (the best answer is fixed at 100 pts)</span>
        {options.map((o) => (
          <div key={o.id} className={`qedit__opt ${o.id === correctOptionId ? 'is-best' : ''}`}>
            <div className="qedit__opt-head">
              <span className="qedit__opt-id">{o.id.toUpperCase()}</span>
              <input
                className="qedit__opt-text"
                value={o.text}
                onChange={(e) => patchOption(o.id, { text: e.target.value })}
                placeholder="Option text"
              />
              <input
                className="qedit__opt-pts"
                type="number"
                min={0}
                max={100}
                value={o.id === correctOptionId ? 100 : o.points}
                disabled={o.id === correctOptionId}
                onChange={(e) => patchOption(o.id, { points: e.target.value })}
                aria-label={`Points for option ${o.id}`}
              />
            </div>
            <input
              className="qedit__opt-rationale"
              value={o.rationale}
              onChange={(e) => patchOption(o.id, { rationale: e.target.value })}
              placeholder="Why this choice is right / wrong (SOP reference)"
            />
          </div>
        ))}
      </div>

      {error && <p className="qedit__error">{error}</p>}

      <div className="qedit__actions">
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn--primary btn--sm" onClick={save}>Save question</button>
      </div>
    </div>
  );
}
