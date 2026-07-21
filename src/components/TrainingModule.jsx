import { useMemo, useRef, useState } from 'react';
import { domainName } from '../data/questions.js';
import {
  moduleForDomain,
  scopeForDept,
  belongsToDept,
  itemText,
  TRAINING_DEPARTMENTS,
} from '../data/training.js';
import { trainingByDomain } from '../lib/scoring.js';

// Only these departments have authored training content. Anything else (the
// Adult Medicine / Behavioural Health mockups, or a missing value) renders an
// explicit "not available yet" state — it must NEVER fall back to Pediatrics,
// which would show one department's rules to another department's navigator.
const hasTrainingContent = (dept) => TRAINING_DEPARTMENTS.includes(dept);

// ── Sub-blocks ───────────────────────────────────────────────────────────────

// "Say this / not that" phrasing pairs inside a lesson.
function ScriptPairs({ script }) {
  return (
    <div className="tscript">
      {script.map((s, i) => (
        <div key={i} className="tscript__pair">
          <div className="tscript__row tscript__row--say">
            <span className="tscript__tag tscript__tag--say">Say</span>
            <p>{s.say}</p>
          </div>
          <div className="tscript__row tscript__row--not">
            <span className="tscript__tag tscript__tag--not">Not</span>
            <p>{s.not}</p>
          </div>
          <p className="tscript__why">{s.why}</p>
        </div>
      ))}
    </div>
  );
}

// Annotated call excerpt — transcript turns with margin notes.
function CallExample({ example }) {
  return (
    <div className="texample">
      <span className="texample__label">From a real call pattern</span>
      {example.intro && <p className="texample__intro">{example.intro}</p>}
      <div className="texample__turns">
        {example.turns.map((t, i) => (
          <div key={i} className={`texample__turn texample__turn--${t.speaker}`}>
            <div className="texample__bubble">
              <span className="texample__speaker">{t.speaker === 'nav' ? 'Navigator' : 'Caller'}</span>
              <p>{t.text}</p>
            </div>
            {t.note && <p className="texample__note">↳ {t.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Model document (e.g. a complete TE), rendered as a "paper" block.
function ModelDoc({ doc }) {
  return (
    <figure className="tdoc">
      <figcaption className="tdoc__label">{doc.label}</figcaption>
      <div className="tdoc__paper">
        {doc.lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      {doc.note && <p className="tdoc__note">{doc.note}</p>}
    </figure>
  );
}

// "Where calls go wrong" — mistake / consequence / instead cards.
function Mistakes({ mistakes }) {
  return (
    <div className="card tmistakes">
      <h2 className="overview__panel-title">Where calls go wrong</h2>
      <div className="tmistakes__grid">
        {mistakes.map((m, i) => (
          <div key={i} className="tmistake">
            <p className="tmistake__mistake">{m.mistake}</p>
            <p className="tmistake__consequence">{m.consequence}</p>
            <p className="tmistake__instead"><strong>Instead:</strong> {m.instead}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Compact reference card meant to be "pinned".
function QuickRef({ quickRef }) {
  return (
    <div className="card tquickref">
      <h2 className="overview__panel-title">{quickRef.title}</h2>
      <dl className="tquickref__rows">
        {quickRef.rows.map((r, i) => (
          <div key={i} className="tquickref__row">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Live call simulation ─────────────────────────────────────────────────────
// A branching, multi-turn call: the caller speaks, the navigator chooses a
// response, the caller reacts to THAT choice, and a debrief grades the path.
// Advisory practice only — nothing is scored or persisted.
const SIM_TONE_LABEL = { good: 'Strong', ok: 'Shaky', bad: 'Misstep' };
const SIM_VERDICT_LABEL = { strong: 'Strong call', mixed: 'Mixed call', weak: 'Weak call' };

// The simulation is chosen upstream by the module's selected department, so this
// component owns no department state of its own.
function CallSimulator({ simulation }) {
  const [nodeId, setNodeId] = useState(simulation.start);
  const [history, setHistory] = useState([]); // committed { caller, choice } turns

  // Reset when the module OR the department changes. `simulation` is the stable
  // catalog object for the selected (domain, department) pair, so its identity
  // is the signal — the supported "adjust state during render" pattern. (A `key`
  // is deliberately avoided: a keyed element among unkeyed siblings under this
  // parent mis-reconciles and leaves two simulators mounted at once.)
  const simRef = useRef(simulation);
  let activeNodeId = nodeId;
  if (simRef.current !== simulation) {
    simRef.current = simulation;
    activeNodeId = simulation.start;
    setNodeId(simulation.start);
    setHistory([]);
  }

  // Fall back to the start node on the discarded render right after a reset.
  const node = simulation.nodes[activeNodeId] ?? simulation.nodes[simulation.start];
  const isEnding = Boolean(node.ending);

  const choose = (choice) => {
    setHistory((h) => [...h, { caller: node.caller, choice }]);
    setNodeId(choice.next);
  };
  const restart = () => {
    setHistory([]);
    setNodeId(simulation.start);
  };

  return (
    <div className="card tsim">
      <div className="tsim__head">
        <span className="tsim__live"><span className="tsim__dot" aria-hidden="true" />Live call simulation</span>
        <h2 className="tsim__title">{simulation.title}</h2>
        <p className="tsim__intro">{simulation.intro}</p>
      </div>

      <div className="tsim__thread">
        {history.map((turn, i) => (
          <div key={i} className="tsim__exchange">
            <div className="tsim__line tsim__line--caller">
              <span className="tsim__who">{simulation.callerName}</span>
              <p>{turn.caller}</p>
            </div>
            <div className={`tsim__line tsim__line--nav tsim__line--${turn.choice.tone}`}>
              <span className="tsim__who">You</span>
              <p>{turn.choice.text}</p>
            </div>
            <p className={`tsim__feedback tsim__feedback--${turn.choice.tone}`}>
              <span className="tsim__feedback-tag">{SIM_TONE_LABEL[turn.choice.tone]}</span>
              {turn.choice.feedback}
            </p>
          </div>
        ))}

        {!isEnding && (
          <div className="tsim__now">
            <div className="tsim__line tsim__line--caller">
              <span className="tsim__who">{simulation.callerName}</span>
              <p>{node.caller}</p>
            </div>
            <div className="tsim__choices" role="group" aria-label="Choose your response">
              {node.choices.map((c, i) => (
                <button key={i} type="button" className="tsim__choice" onClick={() => choose(c)}>
                  <span className="tsim__choice-arrow" aria-hidden="true">▸</span>
                  <span>{c.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {isEnding && (
        <div className={`tsim__debrief tsim__debrief--${node.ending.verdict}`} role="status">
          <span className="tsim__verdict">{SIM_VERDICT_LABEL[node.ending.verdict]}</span>
          <h3 className="tsim__debrief-title">{node.ending.title}</h3>
          <p className="tsim__summary">{node.ending.summary}</p>
          <p className="tsim__lesson"><strong>Takeaway:</strong> {node.ending.lesson}</p>
          <p className="tsim__count">
            {history.length} decision{history.length === 1 ? '' : 's'} on this call.
          </p>
          <button type="button" className="btn btn--sm tsim__restart" onClick={restart}>
            Take the call again
          </button>
        </div>
      )}
    </div>
  );
}

// Interactive quick-decision drill: pick an option, get the reveal.
// Advisory practice only — nothing is scored or persisted.
function Drill({ drill }) {
  const [picks, setPicks] = useState({}); // { [drillIndex]: optionIndex }

  // Reset answers when the module OR department (drill set) changes — see CallSimulator.
  const drillRef = useRef(drill);
  if (drillRef.current !== drill) {
    drillRef.current = drill;
    setPicks({});
  }

  return (
    <div className="card tdrill">
      <h2 className="overview__panel-title">Quick decision checks</h2>
      <p className="readoff__sub">Single-question gut-checks — pick what you&rsquo;d do, then see why. Practice only, nothing is scored.</p>
      {drill.map((d, di) => {
        const picked = picks[di];
        const answered = picked !== undefined;
        return (
          <div key={di} className="tdrill__item">
            <p className="tdrill__prompt">{d.prompt}</p>
            <div className="tdrill__options" role="group" aria-label={`Drill scenario ${di + 1}`}>
              {d.options.map((o, oi) => {
                const isPicked = picked === oi;
                const state = !answered ? '' : o.correct ? ' is-correct' : isPicked ? ' is-wrong' : ' is-dim';
                return (
                  <div key={oi} className={`tdrill__option${state}`}>
                    <button
                      type="button"
                      className="tdrill__choice"
                      disabled={answered}
                      aria-pressed={isPicked}
                      onClick={() => setPicks((p) => ({ ...p, [di]: oi }))}
                    >
                      <span className="tdrill__letter">{String.fromCharCode(65 + oi)}</span>
                      <span>{o.text}</span>
                    </button>
                    {answered && (o.correct || isPicked) && (
                      <p className="tdrill__why">
                        {o.correct ? '✓ ' : '✕ '}
                        {o.why}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {answered && (
              <p className={`tdrill__verdict ${d.options[picked].correct ? 'tdrill__verdict--right' : 'tdrill__verdict--wrong'}`} role="status">
                {d.options[picked].correct
                  ? 'That’s the call a strong navigator makes.'
                  : 'Not this time — the highlighted option is the SOP path.'}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Module screen ────────────────────────────────────────────────────────────
// Full training module: lessons (with scripts / call examples / model docs),
// mistake breakdowns, a pin-this quick reference, an interactive drill, and key
// takeaways. Supervisors also see the auto-assigned cohort; navigators pass
// `showCohort={false}` so other navigators' names never appear.
//
// DEPARTMENT SCOPE — CONTROLLED. The `department` prop is the SOLE source of
// truth and comes from the parent app (NavigatorApp's active department,
// SupervisorApp's globally selected department). This component keeps NO local
// department state and offers no local switcher, so the rendered content, the
// `rows`/cohort it was given, and the department a completion is recorded under
// can never diverge from the parent. Changing department is a parent action.
//
// Everything is filtered to "shared + that department": the call simulation,
// lessons, lesson points, script pairs, examples, model docs, mistakes,
// quick-reference rows, drills and takeaways. Nothing infers a department from
// the content itself; scope is declared in the catalog data.
export default function TrainingModule({
  rows,
  domainId,
  onBack,
  onOpenNavigator,
  showCohort = true,
  backLabel = '← Back to training',
  completionKind = null,
  completed = false,
  onComplete = null,
  department,
}) {
  const [saving, setSaving] = useState(false);
  const [completeError, setCompleteError] = useState('');
  const mod = moduleForDomain(domainId);
  const supported = hasTrainingContent(department);

  // Everything the page renders, scoped to the controlled department.
  const view = useMemo(() => {
    if (!mod || !supported) return null;
    const lessons = scopeForDept(mod.lessons, department)
      .map((lesson) => ({
        ...lesson,
        points: scopeForDept(lesson.points, department),
        script: scopeForDept(lesson.script, department),
        example: lesson.example && belongsToDept(lesson.example, department) ? lesson.example : null,
        doc: lesson.doc && belongsToDept(lesson.doc, department) ? lesson.doc : null,
      }))
      // A lesson whose every point belongs to the other department drops out.
      .filter((lesson) => lesson.points.length > 0);
    return {
      lessons,
      mistakes: scopeForDept(mod.mistakes, department),
      quickRefRows: scopeForDept(mod.quickRef?.rows, department),
      drill: scopeForDept(mod.drill, department),
      simulation: scopeForDept(mod.simulations, department)[0] ?? null,
      keyTakeaways: scopeForDept(mod.keyTakeaways, department),
    };
  }, [mod, department, supported]);

  const cohort = trainingByDomain(rows).find((d) => d.domainId === domainId);
  // How many navigators were actually scored in this domain — an empty cohort
  // means "covered" only if somebody was measured.
  const assessedInDomain = rows.filter((r) => Number.isFinite(r?.scores?.[domainId])).length;

  // Departments without authored training content get an explicit unavailable
  // state — never another department's content, and never a completion control.
  if (!supported) {
    return (
      <section className="module">
        <button className="linkbtn navdetail__back" onClick={onBack}>{backLabel}</button>
        <p className="readoff__empty">Training content is not available for this department yet.</p>
      </section>
    );
  }

  if (!mod) {
    return (
      <section className="module">
        <button className="linkbtn" onClick={onBack}>{backLabel}</button>
        <p className="readoff__empty">No training module for this domain yet.</p>
      </section>
    );
  }

  return (
    <section className="module view-enter">
      <button className="linkbtn navdetail__back" onClick={onBack}>{backLabel}</button>

      <header className="module__head">
        <span className="tag tag--accent">{domainName(domainId)}</span>
        <h1 className="module__title">{mod.title}</h1>
        <p className="module__lede">{mod.blurb}</p>
        <div className="module__meta">
          <span>~{mod.estMinutes} min</span>
          <span>·</span>
          <span>{view.lessons.length} lesson{view.lessons.length === 1 ? '' : 's'}</span>
          <span className="module__preview-flag">Grounded in the department SOPs</span>
        </div>
      </header>

      {/* ── Live call simulation (hero practice) ──────────────────────── */}
      {/* Resets internally when the module or department changes — see
          CallSimulator on why a `key` is not used here. */}
      {view.simulation && <CallSimulator simulation={view.simulation} />}

      {/* ── Lessons ───────────────────────────────────────────────────── */}
      <ol className="lessons">
        {view.lessons.map((lesson, i) => (
          <li key={i} className="card lesson">
            <div className="lesson__head">
              <span className="lesson__num">{i + 1}</span>
              <h2 className="lesson__title">{lesson.title}</h2>
            </div>
            <ul className="lesson__points">
              {lesson.points.map((p, j) => (
                <li key={j}>{itemText(p)}</li>
              ))}
            </ul>
            {lesson.script.length > 0 && <ScriptPairs script={lesson.script} />}
            {lesson.example && <CallExample example={lesson.example} />}
            {lesson.doc && <ModelDoc doc={lesson.doc} />}
          </li>
        ))}
      </ol>

      {/* ── Where calls go wrong ──────────────────────────────────────── */}
      {view.mistakes.length > 0 && <Mistakes mistakes={view.mistakes} />}

      {/* ── Quick reference ───────────────────────────────────────────── */}
      {view.quickRefRows.length > 0 && (
        <QuickRef quickRef={{ title: mod.quickRef.title, rows: view.quickRefRows }} />
      )}

      {/* ── Interactive drill ─────────────────────────────────────────── */}
      {/* The scoped drill array is memoized per (module, department), so Drill's
          own identity check clears the answers whenever either changes. */}
      {view.drill.length > 0 && <Drill drill={view.drill} />}

      {/* ── Key takeaways ─────────────────────────────────────────────── */}
      <div className="card module__takeaways">
        <h2 className="overview__panel-title">Key takeaways</h2>
        <ul className="takeaways">
          {view.keyTakeaways.map((t, i) => (
            <li key={i}>{itemText(t)}</li>
          ))}
        </ul>
      </div>

      {!showCohort && completionKind && onComplete && (
        <div className="card module__assigned">
          <h2 className="overview__panel-title">
            {completionKind === 'coaching' ? 'Finish coaching review' : 'Finish this module'}
          </h2>
          <p className="readoff__sub">
            Mark this step complete only after you have reviewed the lesson and key takeaways.
          </p>
          {completeError && <p className="gate__error" role="alert">{completeError}</p>}
          <button
            className="btn btn--primary btn--sm"
            type="button"
            disabled={saving || completed}
            onClick={async () => {
              setSaving(true);
              setCompleteError('');
              try {
                // Pass the department this module actually RENDERED, so the
                // caller can reject a completion whose department drifted.
                await onComplete(completionKind, department);
              } catch (err) {
                setCompleteError(err?.message || 'Could not save this step. Try again.');
              } finally {
                setSaving(false);
              }
            }}
          >
            {completed ? '✓ Completed' : saving ? 'Saving…' : completionKind === 'coaching' ? 'Mark coaching reviewed' : 'Mark module complete'}
          </button>
        </div>
      )}

      {/* ── Auto-assigned cohort (supervisor only) ────────────────────── */}
      {showCohort && (
      <div className="card module__assigned">
        <h2 className="overview__panel-title">Auto-assigned to</h2>
        <p className="readoff__sub">
          Based on this quarter&rsquo;s check — navigators weak in {domainName(domainId)}.
        </p>
        {!cohort || (cohort.critical.length === 0 && cohort.required.length === 0 && cohort.stretch.length === 0) ? (
          // "Covered" is only true when someone was actually scored here.
          // Unscored domains produce no cohort either, and that is not mastery.
          <p className="readoff__empty">
            {assessedInDomain === 0
              ? `No assessment results are available for ${domainName(domainId)} yet.`
              : 'No one needs this module right now — the floor has it covered.'}
          </p>
        ) : (
          <div className="train-domain__cohorts">
            {cohort.critical.length > 0 && (
              <div className="cohort">
                <span className="cohort__tag cohort__tag--critical">Critical ({cohort.critical.length})</span>
                <span className="cohort__names">
                  {cohort.critical.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ', '}
                      <button className="linkbtn" onClick={() => onOpenNavigator(n)}>{n}</button>
                    </span>
                  ))}
                </span>
              </div>
            )}
            {cohort.required.length > 0 && (
              <div className="cohort">
                <span className="cohort__tag cohort__tag--req">Required ({cohort.required.length})</span>
                <span className="cohort__names">
                  {cohort.required.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ', '}
                      <button className="linkbtn" onClick={() => onOpenNavigator(n)}>{n}</button>
                    </span>
                  ))}
                </span>
              </div>
            )}
            {cohort.stretch.length > 0 && (
              <div className="cohort">
                <span className="cohort__tag cohort__tag--stretch">Stretch ({cohort.stretch.length})</span>
                <span className="cohort__names">
                  {cohort.stretch.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ', '}
                      <button className="linkbtn" onClick={() => onOpenNavigator(n)}>{n}</button>
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </section>
  );
}
