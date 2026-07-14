import { useState, useRef, useEffect } from 'react';
import { DOMAINS } from '../data/questions.js';
import { interviewScoreColor } from '../data/config.js';
import { selectCallQaScenario } from '../data/callQaScenarios.js';
import { saveInterview, updateInterviewGrade } from '../lib/db.js';
import { qaAiResultLabel } from '../lib/qaFinalReview.js';
import { apiFetch } from '../lib/apiFetch.js';
import { selectPracticeDomain } from '../lib/practiceDomain.js';
import { getFirebaseIdToken } from '../lib/firebase.js';

// ─────────────────────────────────────────────────────────────────────────────
// VoiceCall — real-time voice call (Gemini Live API via /api/live).
//
// TWO MODES:
//   practice ('practice') — advisory holistic review. The browser owns the
//     generated scenario and transcript, saves the interview, and grades it via
//     /api/grade-interview. Unchanged by PR 2.
//   test ('test')         — SCORED Call QA test. The SERVER is authoritative:
//     the relay captures the transcript, creates + finalizes a server attempt,
//     and /api/grade-call-qa grades that stored transcript by attempt id. The
//     browser shows captions (a non-authoritative mirror) and NEVER submits a
//     transcript or writes the grade. See api/live-relay.js + grade-call-qa.js.
//
// Test flow: setup → connecting → active → (End) → finalizing → grading →
//            reviewed  (or captureError / gradeError on failure)
//
// Audio: mic → ScriptProcessor → downsample to 16kHz PCM16 → relay → Gemini.
//        Gemini → 24kHz PCM16 → scheduled AudioBufferSources for gapless playback.
// ─────────────────────────────────────────────────────────────────────────────

const GRADE_TIMEOUT_MS = 30_000;
const QA_GRADE_TIMEOUT_MS = 60_000; // rubric grading is a bigger prompt + server-side retry
const FINALIZE_TIMEOUT_MS = 15_000; // client-side guard on the server drain handshake
const TARGET_IN_RATE = 16000;
const OUT_RATE = 24000;

// Grade a SCORED Call QA attempt by its server attempt id. The browser sends ONLY
// the attempt id — never a transcript, scenario, department, or grader metadata.
export async function gradeCallQaByAttemptId(attemptId, apiFetchFn = apiFetch, timeout = QA_GRADE_TIMEOUT_MS) {
  return apiFetchFn('/api/grade-call-qa', { attemptId }, timeout);
}

export function callQaScenarioMetadata(selectedScenario) {
  if (!selectedScenario) return {};
  return {
    scenarioSource: 'curated',
    qaScenarioId: selectedScenario.id,
    qaScenarioTitle: selectedScenario.title,
    scenarioVersion: selectedScenario.version,
    workflowType: selectedScenario.workflowType,
    difficulty: selectedScenario.difficulty,
    domainIds: selectedScenario.domainIds,
    competencyIds: selectedScenario.competencyIds,
    expectedActions: selectedScenario.expectedActions,
    criticalMisses: selectedScenario.criticalMisses,
    scoringNotes: selectedScenario.scoringNotes ?? [],
  };
}

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

// mode: 'practice' (advisory holistic review) | 'test' (server-authoritative,
// hard rubric-based QA test graded against the call quality guide).
export default function VoiceCall({ navigatorId, name, department = 'pediatrics', preferredDomain = null, onExit, onDone, onQaResult, mode = 'practice', priorQaAttempts = [] }) {
  const isTest = mode === 'test';
  // phases: setup | connecting | active | finalizing | grading | reviewed |
  //         discarded | saveError | gradeError | gradeSaveError | captureError
  const [phase, setPhase]         = useState('setup');
  const [callerName, setCallerName] = useState('');
  const [scenario, setScenario]   = useState('');
  const [domainId, setDomainId]   = useState('');
  const [speaking, setSpeaking]   = useState(false); // caller currently talking
  const [error, setError]         = useState('');
  const [grade, setGrade]         = useState(null);
  const [qa, setQa]               = useState(null);  // full QA scorecard (test mode)
  const [gradeBusy, setGradeBusy] = useState(false);  // retrying a failed grade
  const [captions, setCaptions]   = useState([]);     // [{role, text}] mirror only
  const [captureComplete, setCaptureComplete] = useState(true);
  // Practice-mode persistence state
  const [pendingTranscript, setPendingTranscript] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [gradeSaveError, setGradeSaveError] = useState('');
  const [gradeError, setGradeError] = useState('');
  const [captureError, setCaptureError] = useState('');

  const wsRef        = useRef(null);
  const streamRef    = useRef(null);
  const inCtxRef     = useRef(null);
  const outCtxRef    = useRef(null);
  const processorRef = useRef(null);
  const playheadRef  = useRef(0);
  const sourcesRef   = useRef([]);          // scheduled playback sources (barge-in flush)
  const segmentsRef  = useRef([]);          // caption mirror; ALSO practice-mode transcript
  const finalRef     = useRef(null);        // practice-mode { transcript, docId } for grade retries
  const attemptIdRef = useRef(null);        // test-mode server attempt id (authoritative)
  const finalizeTimerRef = useRef(null);
  const qaScenarioMetadataRef = useRef({});
  const caseFileRef = useRef(null);
  const domain = DOMAINS.find((d) => d.id === domainId);

  function clearPersistenceState() {
    setPendingTranscript(null);
    setSaveError('');
    setGradeSaveError('');
    setGradeError('');
    setCaptureError('');
    attemptIdRef.current = null;
  }

  function exitTestFlow() {
    clearPersistenceState();
    setQa(null);
    setGrade(null);
    if (onExit) onExit();
    else setPhase('setup');
  }

  useEffect(() => () => teardown(), []);    // stop everything on unmount

  // ── Teardown ────────────────────────────────────────────────────────────────
  function stopAudio() {
    // Stop the mic + audio graph but LEAVE the WebSocket open — used during the
    // test-mode End Call drain handshake so the socket can still receive the
    // final transcription + 'captured' acknowledgement.
    if (processorRef.current) processorRef.current.onaudioprocess = null;
    try { processorRef.current?.disconnect(); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    sourcesRef.current.forEach((source) => { try { source.stop(); } catch {} });
    try { inCtxRef.current?.close(); } catch {}
    try { outCtxRef.current?.close(); } catch {}
    streamRef.current = inCtxRef.current = outCtxRef.current = processorRef.current = null;
    sourcesRef.current = [];
  }

  function teardown() {
    const ws = wsRef.current;
    wsRef.current = null;
    if (finalizeTimerRef.current) { clearTimeout(finalizeTimerRef.current); finalizeTimerRef.current = null; }
    try { ws?.close(); } catch {}
    stopAudio();
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

  // ── Captions (coalesce consecutive same-role fragments) ──────────────────
  // In test mode this is a DISPLAY MIRROR ONLY — the server captures the
  // authoritative transcript. In practice mode this doubles as the transcript.
  function addTranscript(role, text) {
    const segs = segmentsRef.current;
    const last = segs[segs.length - 1];
    if (last && last.role === role) last.text = appendTranscriptFragment(last.text, text);
    else segs.push({ role, text: appendTranscriptFragment('', text) });
    setCaptions(segs.map((s) => ({ role: s.role, text: s.text })));
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
    setCaptureComplete(true);
    clearPersistenceState();
    qaScenarioMetadataRef.current = {};
    caseFileRef.current = null;

    const pick = selectPracticeDomain(preferredDomain);
    setDomainId(pick);
    let scen, caller, opener = '', qaScenarioId = null;
    if (isTest) {
      const selectedScenario = selectCallQaScenario({ department, priorAttempts: priorQaAttempts });
      if (!selectedScenario) {
        setError('No Call QA test scenario is available for this department yet.');
        return setPhase('setup');
      }
      const primaryDomainId = selectedScenario.primaryDomainId ?? selectedScenario.domainIds[0];
      setDomainId(primaryDomainId);
      qaScenarioMetadataRef.current = callQaScenarioMetadata(selectedScenario);
      qaScenarioId = selectedScenario.id;
      // Local copies are for DISPLAY only; the server loads the trusted scenario.
      scen = selectedScenario.scenario;
      caller = selectedScenario.callerName;
      setScenario(scen);
      setCallerName(caller);
    } else {
      setDomainId(pick);
      try {
        const data = await apiFetch('/api/interview-turn', { domain: pick, department }, 20_000);
        scen = data.scenario; caller = data.callerName;
        opener = data.reply || '';
        caseFileRef.current = data.caseFile ?? null;
        setScenario(scen); setCallerName(caller);
      } catch {
        setError('Could not set up the call scenario. Try again.');
        return setPhase('setup');
      }
    }

    const idToken = await getFirebaseIdToken().catch(() => null);
    if (!idToken) {
      setError('Your secure session has expired. Sign in again before starting a voice call.');
      return setPhase('setup');
    }

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

    try {
      const inCtx = new AudioContext();
      const outCtx = new AudioContext({ sampleRate: OUT_RATE });
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
      const processor = inCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      const mute = inCtx.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(inCtx.destination);

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/api/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Test mode sends the MINIMUM: the server derives identity + scenario.
        const startMsg = isTest
          ? { type: 'start', idToken, mode: 'test', department, qaScenarioId }
          : {
              type: 'start', idToken, mode: 'practice', navigatorId,
              callerName: caller, scenario: scen, department, openingLine: opener,
              caseFile: caseFileRef.current,
            };
        ws.send(JSON.stringify(startMsg));
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'ready') {
          if (isTest && m.attemptId) attemptIdRef.current = m.attemptId;
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
        } else if (m.type === 'captured') {
          onCaptured(m);
        } else if (m.type === 'error') {
          setError(m.message || 'The call dropped.');
          teardown();
          setPhase('setup');
        }
      };
      ws.onerror = () => {
        if (isTest && phaseIsFinalizing()) return; // handled by the finalize guard
        setError('Connection to the voice service failed.');
        teardown();
        setPhase('setup');
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        if (isTest && phaseIsFinalizing()) {
          // Socket closed before a 'captured' ack — treat as a capture failure.
          onCaptureFailed('The call server closed before confirming the recording.');
          return;
        }
        setError('The voice service closed the connection. Your microphone has been stopped.');
        teardown();
        setPhase('setup');
      };
    } catch (err) {
      console.error('Voice call audio setup failed:', err);
      setError('Could not start the browser audio connection. Your microphone has been stopped.');
      teardown();
      setPhase('setup');
    }
  };

  // A ref-readable flag so the ws event handlers (closing over stale state) can
  // tell whether we're mid-finalize.
  const finalizingRef = useRef(false);
  function phaseIsFinalizing() { return finalizingRef.current; }

  // ── Test-mode: End Call handshake ─────────────────────────────────────────
  const onCaptured = async (msg) => {
    if (!isTest) return;
    finalizingRef.current = false;
    if (finalizeTimerRef.current) { clearTimeout(finalizeTimerRef.current); finalizeTimerRef.current = null; }
    if (msg.attemptId) attemptIdRef.current = msg.attemptId;
    setCaptureComplete(msg.captureComplete !== false);
    // The server has the durable transcript; the socket is no longer needed.
    teardown();
    await gradeAttempt();
  };

  const onCaptureFailed = (message) => {
    finalizingRef.current = false;
    if (finalizeTimerRef.current) { clearTimeout(finalizeTimerRef.current); finalizeTimerRef.current = null; }
    teardown();
    if (attemptIdRef.current) {
      // The attempt exists server-side (as abandoned/incomplete) — allow a grade
      // retry, which will surface the capture-integrity flag or "no transcript".
      setCaptureError(message || 'Transcript capture could not be finalized.');
      setPhase('captureError');
    } else {
      setError(message || 'Transcript capture could not be finalized.');
      setPhase('setup');
    }
  };

  const gradeAttempt = async () => {
    const attemptId = attemptIdRef.current;
    if (!attemptId) return onCaptureFailed('No recorded attempt to grade.');
    setPhase('grading');
    try {
      const data = await gradeCallQaByAttemptId(attemptId);
      if (!data?.qa || !data?.grade) {
        setGradeError('The call was captured, but grading failed. You can retry grading this saved attempt.');
        return setPhase('gradeError');
      }
      setQa(data.qa);
      setGrade(data.grade);
      await onQaResult?.(data.qa, qaScenarioMetadataRef.current);
      setPhase('reviewed');
    } catch (err) {
      if (err?.status === 422) {
        setCaptureError('The call server did not capture any of your speech. Nothing was scored. Please take the test again.');
        return setPhase('captureError');
      }
      setGradeError('The call was captured, but grading failed. You can retry grading this saved attempt.');
      setPhase('gradeError');
    }
  };

  // ── End + grade ───────────────────────────────────────────────────────────
  const endCall = async () => {
    if (isTest) {
      // Server-authoritative: request finalization and WAIT for the 'captured'
      // acknowledgement. Do NOT close the socket yet.
      const ws = wsRef.current;
      stopAudio();               // stop mic; keep the socket open for the drain
      finalizingRef.current = true;
      setPhase('finalizing');
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'end' })); } catch {}
      } else {
        return onCaptureFailed('The connection to the call server was lost before finalizing.');
      }
      // Client-side guard: if the server never acknowledges, fail gracefully.
      finalizeTimerRef.current = setTimeout(() => {
        if (finalizingRef.current) onCaptureFailed('Finalizing the transcript timed out.');
      }, FINALIZE_TIMEOUT_MS);
      return;
    }

    // Practice mode (unchanged): browser-owned transcript + advisory grading.
    const transcript = segmentsRef.current
      .map((s) => ({ role: s.role, text: s.text.trim() }))
      .filter((s) => s.text);
    teardown();
    if (transcript.length === 0) return setPhase('discarded');

    setPhase('grading');
    setPendingTranscript(transcript);
    let docId = null;
    try {
      docId = await saveInterview(navigatorId, name, domainId, scenario, callerName, transcript, department);
    } catch (err) {
      console.error('Failed to save voice call:', err);
      setSaveError('We could not save this practice call. Nothing has been recorded yet.');
      setPhase('saveError');
      return;
    }
    finalRef.current = { transcript, docId };
    const gradeDurable = await runGrading();
    setPhase(gradeDurable ? 'reviewed' : 'gradeSaveError');
  };

  // Practice-mode advisory grading (holistic /api/grade-interview).
  const runGrading = async () => {
    const { transcript, docId } = finalRef.current ?? {};
    if (!transcript) return true;
    try {
      const data = await apiFetch(
        '/api/grade-interview',
        { domain: domainId, department, scenario, transcript, name },
        GRADE_TIMEOUT_MS,
      );
      if (data.grade) {
        setGrade(data.grade);
        if (docId) {
          try {
            await updateInterviewGrade(docId, data.grade);
          } catch (e) {
            console.error('grade save failed:', e);
            setGradeSaveError('Your feedback was generated, but it could not be saved for your supervisor.');
            return false;
          }
        }
      }
    } catch (err) {
      console.error('Failed to grade voice call:', err);
    }
    return true;
  };

  const retryGrading = async () => {
    setGradeBusy(true);
    if (isTest) {
      await gradeAttempt();
    } else {
      const gradeDurable = await runGrading();
      setPhase(gradeDurable ? 'reviewed' : 'gradeSaveError');
    }
    setGradeBusy(false);
  };

  const retrySaving = async () => {
    if (isTest || !pendingTranscript) return;
    setGradeBusy(true);
    try {
      const docId = await saveInterview(
        navigatorId, name, domainId, scenario, callerName, pendingTranscript, department,
      );
      finalRef.current = { transcript: pendingTranscript, docId };
      setSaveError('');
      setPhase('grading');
      const gradeDurable = await runGrading();
      setPhase(gradeDurable ? 'reviewed' : 'gradeSaveError');
    } catch {
      setSaveError('We still could not save this practice call. Check the connection and try again.');
      setPhase('saveError');
    } finally {
      setGradeBusy(false);
    }
  };

  const retrySavingGrade = async () => {
    if (isTest || !finalRef.current?.docId || !grade) return;
    setGradeBusy(true);
    try {
      await updateInterviewGrade(finalRef.current.docId, grade);
      setGradeSaveError('');
      setPhase('reviewed');
    } catch {
      setGradeSaveError('Your feedback was generated, but it could not be saved for your supervisor.');
      setPhase('gradeSaveError');
    }
    setGradeBusy(false);
  };

  const discard = () => { teardown(); clearPersistenceState(); setPhase('discarded'); };

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

  if (phase === 'finalizing') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done">
          <div className="interview__grading-spinner" aria-hidden="true" />
          <h2 className="overview__panel-title">Finalizing transcript…</h2>
          <p className="readoff__sub">The call server is saving the last of your call before grading.</p>
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
              ? 'Auditing the server-captured call against every criterion on the quality scorecard.'
              : 'Scoring your performance against the SOP. A few seconds.'}
          </p>
        </div>
      </section>
    );
  }

  if (phase === 'captureError') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done">
          <h2 className="overview__panel-title">Recording not finalized</h2>
          <p className="readoff__sub">{captureError}</p>
          <div className="interview__end-actions" style={{ justifyContent: 'center' }}>
            {attemptIdRef.current && (
              <button className="btn btn--primary btn--sm" disabled={gradeBusy} onClick={retryGrading} type="button">
                {gradeBusy ? 'Grading…' : 'Retry grading the saved transcript'}
              </button>
            )}
            <button className="btn btn--ghost btn--sm" onClick={exitTestFlow} type="button">Exit</button>
          </div>
        </div>
      </section>
    );
  }

  if (phase === 'saveError') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done">
          <h2 className="overview__panel-title">Practice call not saved</h2>
          <p className="readoff__sub">{saveError}</p>
          <div className="interview__end-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn--primary btn--sm" disabled={gradeBusy} onClick={retrySaving} type="button">
              {gradeBusy ? 'Retrying…' : 'Retry saving'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={discard} type="button">Discard attempt</button>
          </div>
        </div>
      </section>
    );
  }

  if (phase === 'gradeError') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done">
          <h2 className="overview__panel-title">Captured, grading failed</h2>
          <p className="readoff__sub">{gradeError}</p>
          <div className="interview__end-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn--primary btn--sm" disabled={gradeBusy} onClick={retryGrading} type="button">
              {gradeBusy ? 'Grading…' : 'Retry grading the saved server transcript'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={exitTestFlow} type="button">Exit</button>
          </div>
        </div>
      </section>
    );
  }

  if (phase === 'gradeSaveError') {
    return (
      <section className="interview view-enter">
        <div className="card interview__done">
          <h2 className="overview__panel-title">Grade not saved</h2>
          <p className="readoff__sub">{gradeSaveError}</p>
          <div className="interview__end-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn--primary btn--sm" disabled={gradeBusy} onClick={retrySavingGrade} type="button">
              {gradeBusy ? 'Saving…' : 'Retry saving grade'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={exitTestFlow} type="button">Exit</button>
          </div>
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
                <p className="qa-result__verdict">{qaAiResultLabel(qa)}</p>
                <p className="interview__score-value" style={{ color: verdictColor }}>
                  {qa.score}<span className="interview__score-denom">/100</span>
                </p>
                <p className="readoff__sub">Pass mark: {qa.passThreshold}. No partial credit — every criterion is met or missed. This is an AI recommendation pending supervisor review — not a final verdict.</p>
                <p className="readoff__sub qa-result__provenance">Transcript captured by the call server{captureComplete ? '' : ' (capture flagged incomplete — sent for supervisor review)'}.</p>
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
                  Your call was captured, but the grading couldn&rsquo;t run — the grader may be busy right now.
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

          {qa?.repairs?.length > 0 && (
            <p className="readoff__sub">Some rubric wording was normalized for fair scoring.</p>
          )}

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
              ? 'A graded test call. You are scored on the full quality scorecard — greeting, verification, call control, communication, SOP knowledge, scheduling, and closing. Auto-fail rules apply. The call server records the transcript that is graded.'
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
              ? 'One take, graded hard: every criterion is met or missed against the server-captured transcript — no partial credit, no benefit of the doubt. Your mic turns on when the call starts.'
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
