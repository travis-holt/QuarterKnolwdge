import { useState, useRef, useEffect } from 'react';
import { DOMAINS } from '../data/questions.js';
import { interviewScoreColor } from '../data/config.js';
import { saveInterview, updateInterviewGrade } from '../lib/db.js';
import { apiFetch } from '../lib/apiFetch.js';

// ─────────────────────────────────────────────────────────────────────────────
// VoiceCall — real-time voice practice call (Gemini Live API via /api/live).
//
// Unlike the chat Interview, this is a live phone-call experience: the caller
// speaks, the navigator speaks back, both in real time. No chat bubbles, no
// send button. A running transcript is captured under the hood purely so the
// call can be saved + graded by the same /api/grade-interview endpoint.
//
// Flow: setup → connecting → active → (end) → grading → reviewed
//                                   ↘ (discard) → discarded
//
// Audio: mic → ScriptProcessor → downsample to 16kHz PCM16 → relay → Gemini.
//        Gemini → 24kHz PCM16 → scheduled AudioBufferSources for gapless playback.
// ─────────────────────────────────────────────────────────────────────────────

const GRADE_TIMEOUT_MS = 30_000;
const QA_GRADE_TIMEOUT_MS = 60_000; // rubric grading is a bigger prompt + server-side retry
const TARGET_IN_RATE = 16000;
const OUT_RATE = 24000;

// ── Audio helpers (module-level, pure) ───────────────────────────────────────

function downsample(f32, inRate) {
  if (inRate === TARGET_IN_RATE) return f32;
  const ratio = inRate / TARGET_IN_RATE;
  const outLen = Math.floor(f32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0, c = 0;
    for (let j = start; j < end && j < f32.length; j++) { sum += f32[j]; c++; }
    out[i] = c ? sum / c : 0;
  }
  return out;
}

function f32ToB64Pcm16(f32) {
  const int16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function appendTranscriptFragment(existing, fragment) {
  const text = String(fragment || '').replace(/\s+/g, ' ');
  if (!text.trim()) return existing;
  if (!existing) return text.trimStart();
  const next = text.trimStart();
  const needsSpace = !/\s$/.test(existing) && !/^[.,!?;:)]/.test(next);
  return `${existing}${needsSpace ? ' ' : ''}${next}`;
}

// mode: 'practice' (advisory holistic review) | 'test' (hard rubric-based QA
// test graded criterion-by-criterion against the call quality guide).
export default function VoiceCall({ navigatorId, name, department = 'pediatrics', onExit, onDone, onQaResult, mode = 'practice' }) {
  const isTest = mode === 'test';
  // phases: setup | connecting | active | grading | reviewed | discarded | error
  const [phase, setPhase]         = useState('setup');
  const [callerName, setCallerName] = useState('');
  const [scenario, setScenario]   = useState('');
  const [domainId, setDomainId]   = useState('');
  const [speaking, setSpeaking]   = useState(false); // caller currently talking
  const [error, setError]         = useState('');
  const [grade, setGrade]         = useState(null);
  const [qa, setQa]               = useState(null);  // full QA scorecard (test mode)
  const [gradeBusy, setGradeBusy] = useState(false);  // retrying a failed grade from the reviewed screen
  const [captions, setCaptions]   = useState([]);     // [{role, text}] shown live during the call

  const wsRef        = useRef(null);
  const streamRef    = useRef(null);
  const inCtxRef     = useRef(null);
  const outCtxRef    = useRef(null);
  const processorRef = useRef(null);
  const playheadRef  = useRef(0);
  const sourcesRef   = useRef([]);          // scheduled playback sources (for barge-in flush)
  const segmentsRef  = useRef([]);          // [{role, text}] transcript, coalesced by role
  const finalRef     = useRef(null);        // { transcript, docId } kept after teardown for grade retries
  const domain = DOMAINS.find((d) => d.id === domainId);

  useEffect(() => () => teardown(), []);    // stop everything on unmount

  // ── Teardown ────────────────────────────────────────────────────────────────
  function teardown() {
    try { wsRef.current?.close(); } catch {}
    try { processorRef.current?.disconnect(); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try { inCtxRef.current?.close(); } catch {}
    try { outCtxRef.current?.close(); } catch {}
    wsRef.current = streamRef.current = inCtxRef.current = outCtxRef.current = processorRef.current = null;
    sourcesRef.current = [];
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  function playChunk(int16) {
    const ctx = outCtxRef.current;
    if (!ctx) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, OUT_RATE);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(playheadRef.current, ctx.currentTime);
    src.start(startAt);
    playheadRef.current = startAt + buf.duration;
    sourcesRef.current.push(src);
    setSpeaking(true);
    src.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
      if (sourcesRef.current.length === 0) setSpeaking(false);
    };
  }

  function flushPlayback() {   // barge-in: caller was interrupted, drop queued audio
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    sourcesRef.current = [];
    if (outCtxRef.current) playheadRef.current = outCtxRef.current.currentTime;
    setSpeaking(false);
  }

  // ── Transcript (coalesce consecutive same-role fragments) ─────────────────
  function addTranscript(role, text) {
    const segs = segmentsRef.current;
    const last = segs[segs.length - 1];
    if (last && last.role === role) last.text = appendTranscriptFragment(last.text, text);
    else segs.push({ role, text: appendTranscriptFragment('', text) });
    setCaptions(segs.map((s) => ({ role: s.role, text: s.text }))); // mirror to UI
  }

  // ── Start ───────────────────────────────────────────────────────────────────
  const startCall = async () => {
    setPhase('connecting');
    setError('');
    segmentsRef.current = [];
    finalRef.current = null;
    setGrade(null);
    setQa(null);
    setGradeBusy(false);
    setCaptions([]);

    // 1) Generate the scenario + caller name (reuses the existing chat init path).
    const pick = DOMAINS[Math.floor(Math.random() * DOMAINS.length)].id;
    setDomainId(pick);
    let scen, caller, opener = '';
    try {
      const data = await apiFetch('/api/interview-turn', { domain: pick, department }, 20_000);
      scen = data.scenario; caller = data.callerName;
      opener = data.reply || '';
      setScenario(scen); setCallerName(caller);
    } catch {
      setError('Could not set up the call scenario. Try again.');
      return setPhase('setup');
    }

    // 2) Mic access.
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setError('Microphone access is needed for a voice call. Allow the mic and try again.');
      return setPhase('setup');
    }
    streamRef.current = stream;

    // 3) Audio graph.
    const inCtx = new AudioContext();
    const outCtx = new AudioContext({ sampleRate: OUT_RATE });
    // By now we've awaited a network round-trip + the mic permission prompt, so
    // Chrome's autoplay policy may have started both contexts 'suspended' (no
    // audio renders at all in that state — silent mic AND silent playback).
    // resume() still succeeds because we're inside the gesture chain from the
    // "Start voice call" click, even with awaits in between.
    inCtxRef.current = inCtx;
    outCtxRef.current = outCtx;
    await Promise.all([inCtx.resume(), outCtx.resume()]).catch(() => {});
    if (inCtx.state !== 'running' || outCtx.state !== 'running') {
      setError('Audio is blocked by the browser — click "Start voice call" again to allow it.');
      teardown();
      return setPhase('setup');
    }
    playheadRef.current = outCtx.currentTime;
    const source = inCtx.createMediaStreamSource(stream);
    // ponytail: ScriptProcessorNode is deprecated but zero-setup; upgrade to an
    // AudioWorklet if capture proves choppy on the demo machine.
    const processor = inCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const mute = inCtx.createGain();         // route processor → muted node so it runs without echoing
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(inCtx.destination);

    // 4) Open the relay socket.
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/live`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        // Voice practice is a navigator flow — the relay is pilot-grade open
        // (rate-limited), so no supervisor secret is sent from the client.
        type: 'start',
        callerName: caller,
        scenario: scen,
        department,
        openingLine: opener,
      }));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'ready') {
        setPhase('active');
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== 1) return;
          const ds = downsample(e.inputBuffer.getChannelData(0), inCtx.sampleRate);
          ws.send(JSON.stringify({ type: 'audio', data: f32ToB64Pcm16(ds) }));
        };
      } else if (m.type === 'audio') {
        playChunk(b64ToInt16(m.data));
      } else if (m.type === 'transcript') {
        addTranscript(m.role, m.text);
      } else if (m.type === 'interrupted') {
        flushPlayback();
      } else if (m.type === 'error') {
        setError(m.message || 'The call dropped.');
        teardown();
        setPhase('setup');
      }
    };
    ws.onerror = () => {
      setError('Connection to the voice service failed.');
      teardown();
      setPhase('setup');
    };
  };

  // ── End + grade ───────────────────────────────────────────────────────────
  const endCall = async () => {
    const transcript = segmentsRef.current
      .map((s) => ({ role: s.role, text: s.text.trim() }))
      .filter((s) => s.text);
    teardown();

    if (transcript.length === 0) {
      // Nothing said — treat like a discard rather than grading an empty call.
      return setPhase('discarded');
    }

    setPhase('grading');
    let docId = null;
    try {
      docId = await saveInterview(navigatorId, name, domainId, scenario, callerName, transcript, department);
    } catch (err) {
      console.error('Failed to save voice call:', err);
    }
    finalRef.current = { transcript, docId };
    await runGrading();
    setPhase('reviewed');
  };

  // Grades the saved transcript; also used to retry from the reviewed screen when
  // the first attempt failed (e.g. the Gemini keys were rate-limited).
  // Test mode grades against the fixed QA rubric (hard pass/fail); practice mode
  // keeps the advisory holistic review.
  const runGrading = async () => {
    const { transcript, docId } = finalRef.current ?? {};
    if (!transcript) return;
    try {
      if (isTest) {
        const data = await apiFetch('/api/grade-call-qa', { scenario, transcript, department }, QA_GRADE_TIMEOUT_MS);
        if (data.qa && data.grade) {
          setQa(data.qa);
          setGrade(data.grade);
          if (docId) {
            try { await updateInterviewGrade(docId, data.grade, data.qa); }
            catch (e) { console.error('grade save failed:', e); }
          }
          await onQaResult?.(data.qa);
        }
      } else {
        const data = await apiFetch(
          '/api/grade-interview',
          { domain: domainId, department, scenario, transcript, name },
          GRADE_TIMEOUT_MS,
        );
        if (data.grade) {
          setGrade(data.grade);
          if (docId) updateInterviewGrade(docId, data.grade).catch((e) => console.error('grade save failed:', e));
        }
      }
    } catch (err) {
      console.error('Failed to grade voice call:', err);
    }
  };

  const retryGrading = async () => {
    setGradeBusy(true);
    await runGrading();
    setGradeBusy(false);
  };

  const discard = () => { teardown(); setPhase('discarded'); };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  if (phase === 'discarded') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done interview__done--discarded">
          <span className="interview__done-glyph" aria-hidden="true">✕</span>
          <h2 className="overview__panel-title">Call ended</h2>
          <p className="readoff__sub">Nothing was saved.</p>
          <button className="btn btn--primary" onClick={() => setPhase('setup')}>Start another call</button>
          {onExit && <button className="linkbtn" onClick={onExit} style={{ marginTop: '0.75rem' }}>← Back</button>}
        </div>
      </section>
    );
  }

  if (phase === 'grading') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done">
          <div className="interview__grading-spinner" aria-hidden="true" />
          <h2 className="overview__panel-title">{isTest ? 'Grading your test…' : 'Reviewing your call…'}</h2>
          <p className="readoff__sub">
            {isTest
              ? 'Auditing the call against every criterion on the quality scorecard.'
              : 'Scoring your performance against the SOP. A few seconds.'}
          </p>
        </div>
      </section>
    );
  }

  if (phase === 'reviewed' && isTest) {
    const missed = qa?.criteria?.filter((c) => c.verdict === 'NOT_MET') ?? [];
    const needsReview = qa?.review?.recommendation === 'needs_review';
    const verdictClass = qa ? (needsReview ? 'qa-result--review' : qa.pass ? 'qa-result--pass' : 'qa-result--fail') : '';
    const verdictColor = needsReview ? 'var(--level-solid)' : qa?.pass ? 'var(--level-canteach)' : 'var(--level-learning)';
    return (
      <section className="interview view-enter">
        <div className="interview__review">
          <div className={`card qa-result ${verdictClass}`}>
            <p className="interview__score-label">Call QA Test</p>
            {qa ? (
              <>
                <p className="qa-result__verdict">{needsReview ? 'NEEDS REVIEW' : qa.pass ? 'PASS' : 'FAIL'}</p>
                <p className="interview__score-value" style={{ color: verdictColor }}>
                  {qa.score}<span className="interview__score-denom">/100</span>
                </p>
                <p className="readoff__sub">Pass mark: {qa.passThreshold}. No partial credit — every criterion is met or missed.</p>
                {needsReview && (
                  <p className="readoff__sub qa-result__review-note">
                    This result is flagged for supervisor review — the score alone doesn&rsquo;t decide it.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="interview__score-value interview__score-value--na">—</p>
                <p className="readoff__sub" style={{ marginTop: '0.75rem' }}>
                  Your call was saved, but the grading couldn&rsquo;t run — the grader may be busy right now.
                </p>
                <button
                  className="btn btn--ghost btn--sm"
                  style={{ marginTop: '0.75rem' }}
                  disabled={gradeBusy}
                  onClick={retryGrading}
                  type="button"
                >
                  {gradeBusy ? 'Grading…' : 'Try grading again'}
                </button>
              </>
            )}
          </div>

          {qa?.review?.reviewFlags?.length > 0 && (
            <div className="card qa-reviewflags">
              <h3 className="interview__feedback-title"><span className="interview__feedback-icon" aria-hidden="true">⚑</span>Supervisor review flags</h3>
              <p className="readoff__sub">
                Grading confidence: <strong>{qa.review.confidence}</strong> · Safety risk: <strong>{qa.review.safetyRisk}</strong>
              </p>
              <ul className="qa-reviewflags__list">
                {qa.review.reviewFlags.map((f) => (
                  <li key={f.id} className="qa-reviewflags__item">
                    <strong>{f.label}:</strong> {f.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {qa?.autoFails?.length > 0 && (
            <div className="card qa-autofail">
              <h3 className="interview__feedback-title"><span className="interview__feedback-icon" aria-hidden="true">⛔</span>Automatic fail</h3>
              {qa.autoFails.map((a) => (
                <div key={a.id} className="qa-autofail__item">
                  <p className="qa-autofail__text">{a.text}</p>
                  {a.evidence && <p className="qa-autofail__quote">&ldquo;{a.evidence}&rdquo;</p>}
                  {a.note && <p className="readoff__sub">{a.note}</p>}
                </div>
              ))}
            </div>
          )}

          {qa && (
            <div className="card qa-breakdown">
              <h3 className="interview__feedback-title">Scorecard</h3>
              <ul className="qa-breakdown__list">
                {qa.categories.map((c) => (
                  <li key={c.id} className="qa-breakdown__row">
                    <span className="qa-breakdown__name">{c.name}</span>
                    <span className="qa-breakdown__bar" aria-hidden="true">
                      <span
                        className="qa-breakdown__fill"
                        style={{ width: c.applicablePoints ? `${(c.earned / c.applicablePoints) * 100}%` : '0%' }}
                      />
                    </span>
                    <span className="qa-breakdown__pts">
                      {c.applicablePoints === 0 ? 'n/a' : `${c.earned}/${c.applicablePoints}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {missed.length > 0 && (
            <div className="card interview__feedback-card interview__feedback-card--improvements">
              <h3 className="interview__feedback-title"><span className="interview__feedback-icon" aria-hidden="true">→</span>Points you lost</h3>
              <ul className="interview__feedback-list">
                {missed.map((c) => (
                  <li key={c.id} className="interview__feedback-item">
                    <strong>{c.categoryName} (−{c.points}):</strong> {c.text}
                    {c.note ? <span className="qa-missed__note"> — {c.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="btn btn--primary" onClick={onDone ?? (() => setPhase('setup'))} style={{ alignSelf: 'flex-start' }}>
            {onDone ? 'Back to dashboard' : 'Take the test again'}
          </button>
        </div>
      </section>
    );
  }

  if (phase === 'reviewed') {
    const scoreColor = grade ? interviewScoreColor(grade.score) : 'var(--ink-soft)';
    return (
      <section className="interview view-enter">
        <div className="interview__review">
          <div className="card interview__score-card">
            <p className="interview__score-label">Practice call score</p>
            {grade ? (
              <p className="interview__score-value" style={{ color: scoreColor }}>
                {grade.score}<span className="interview__score-denom">/100</span>
              </p>
            ) : (
              <p className="interview__score-value interview__score-value--na">—</p>
            )}
            <p className="interview__score-domain tag">{domain?.name}</p>
            {grade?.summary && <p className="interview__score-summary">{grade.summary}</p>}
            {!grade && (
              <>
                <p className="readoff__sub" style={{ marginTop: '0.75rem' }}>
                  Your call was saved, but the review couldn&rsquo;t be generated — the reviewer
                  may be busy right now.
                </p>
                <button
                  className="btn btn--ghost btn--sm"
                  style={{ marginTop: '0.75rem' }}
                  disabled={gradeBusy}
                  onClick={retryGrading}
                  type="button"
                >
                  {gradeBusy ? 'Reviewing…' : 'Try the review again'}
                </button>
              </>
            )}
          </div>
          {grade?.strengths?.length > 0 && (
            <div className="card interview__feedback-card interview__feedback-card--strengths">
              <h3 className="interview__feedback-title"><span className="interview__feedback-icon" aria-hidden="true">✓</span>What you did well</h3>
              <ul className="interview__feedback-list">{grade.strengths.map((s, i) => <li key={i} className="interview__feedback-item">{s}</li>)}</ul>
            </div>
          )}
          {grade?.improvements?.length > 0 && (
            <div className="card interview__feedback-card interview__feedback-card--improvements">
              <h3 className="interview__feedback-title"><span className="interview__feedback-icon" aria-hidden="true">→</span>What to work on</h3>
              <ul className="interview__feedback-list">{grade.improvements.map((s, i) => <li key={i} className="interview__feedback-item">{s}</li>)}</ul>
            </div>
          )}
          <button className="btn btn--primary" onClick={() => setPhase('setup')} style={{ alignSelf: 'flex-start' }}>Practice another call</button>
        </div>
      </section>
    );
  }

  // setup | connecting | active
  return (
    <section className="interview view-enter">
      <header className="overview__head">
        <div>
          <h1 className="overview__title">{isTest ? 'Call QA Test' : 'Voice Practice Call'}</h1>
          <p className="overview__lede">
            {isTest
              ? 'A graded test call. You are scored on the full quality scorecard — greeting, verification, call control, communication, SOP knowledge, scheduling, and closing. Auto-fail rules apply.'
              : 'A simulated patient will call you. Talk to them as you would on a real call. For best results, use headphones so the mic doesn’t pick up the caller.'}
          </p>
        </div>
      </header>

      {phase === 'active' ? (
        <div className="card voicecall">
          <span className="interview__domain-tag tag">{domain?.name}</span>
          <p className="interview__scenario">{scenario}</p>
          <div className={`voicecall__orb ${speaking ? 'is-speaking' : ''}`} aria-hidden="true" />
          <p className="voicecall__status">
            {speaking ? `${callerName} is speaking…` : 'Listening — go ahead and respond'}
          </p>

          {captions.length > 0 && (
            <div className="voicecall__captions">
              {captions.map((c, i) => (
                <p key={i} className={`voicecall__caption voicecall__caption--${c.role}`}>
                  <strong>{c.role === 'patient' ? callerName : 'You'}:</strong> {c.text}
                </p>
              ))}
            </div>
          )}

          <div className="interview__end-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn--ghost btn--sm" onClick={discard} type="button">{isTest ? 'Abandon test' : 'Discard'}</button>
            <button className="btn btn--primary btn--sm" onClick={endCall} type="button">{isTest ? 'End & get graded' : 'End & get feedback'}</button>
          </div>
        </div>
      ) : (
        <div className="card interview__setup">
          <h2 className="overview__panel-title">Ready when you are</h2>
          <p className="readoff__sub">
            {isTest
              ? 'One take, graded hard: every criterion is met or missed against the transcript — no partial credit, no benefit of the doubt. Your mic turns on when the call starts.'
              : 'A scenario is generated for you. Every call is different. Your mic turns on when the call starts.'}
          </p>
          {error && <p className="gate__error">{error}</p>}
          <button className="btn btn--primary" disabled={phase === 'connecting'} onClick={startCall} type="button">
            {phase === 'connecting' ? 'Connecting…' : isTest ? 'Start the test call' : 'Start voice call'}
          </button>
          {onExit && <button className="linkbtn" onClick={onExit} style={{ marginTop: '0.75rem' }}>← Back</button>}
        </div>
      )}
    </section>
  );
}
