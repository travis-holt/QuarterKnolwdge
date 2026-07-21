import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCalibrationCli } from '../scripts/call-qa/calibrate.mjs';

const exampleUrl = new URL('./fixtures/call-qa-calibration/example-pass.json', import.meta.url);

async function tempWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'call-qa-calibration-'));
  const fixtures = path.join(root, 'fixtures');
  const output = path.join(root, 'output');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(fixtures));
  return { root, fixtures, output };
}

async function exampleFixture(overrides = {}) {
  const fixture = JSON.parse(await readFile(exampleUrl, 'utf8'));
  return { ...fixture, ...overrides };
}

const silentIo = () => ({ log: vi.fn(), error: vi.fn() });

describe('Call QA calibration CLI', () => {
  it('empty offline directories return INSUFFICIENT_DATA and never call the grader', async () => {
    const workspace = await tempWorkspace();
    const grader = vi.fn(() => { throw new Error('network should not run'); });
    const result = await runCalibrationCli(
      ['--fixtures', workspace.fixtures, '--output', workspace.output],
      { gradeCallQaTranscript: grader, io: silentIo() },
    );
    expect(result.exitCode).toBe(0);
    expect(result.report.readiness.state).toBe('INSUFFICIENT_DATA');
    expect(result.report.evidenceSummary.accuracyConclusionAvailable).toBe(false);
    expect(grader).not.toHaveBeenCalled();
  });

  it('malformed fixtures fail visibly instead of being skipped', async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace.fixtures, 'bad.json'), '{"formatVersion":');
    await expect(runCalibrationCli(
      ['--fixtures', workspace.fixtures, '--output', workspace.output],
      { io: silentIo() },
    )).rejects.toThrow(/invalid JSON/);
  });

  it('writes stable deterministic reports', async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace.fixtures, 'example.json'), JSON.stringify(await exampleFixture()));
    const args = ['--fixtures', workspace.fixtures, '--output', workspace.output];
    await runCalibrationCli(args, { io: silentIo() });
    const firstJson = await readFile(path.join(workspace.output, 'report.json'), 'utf8');
    const firstMarkdown = await readFile(path.join(workspace.output, 'report.md'), 'utf8');
    await runCalibrationCli(args, { io: silentIo() });
    expect(await readFile(path.join(workspace.output, 'report.json'), 'utf8')).toBe(firstJson);
    expect(await readFile(path.join(workspace.output, 'report.md'), 'utf8')).toBe(firstMarkdown);
  });

  it('--require-ready returns nonzero when gates fail', async () => {
    const workspace = await tempWorkspace();
    const result = await runCalibrationCli(
      ['--fixtures', workspace.fixtures, '--output', workspace.output, '--require-ready'],
      { io: silentIo() },
    );
    expect(result.exitCode).toBe(1);
  });

  it('--live requires both environment opt-in and confirmation without invoking Gemini', async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace.fixtures, 'example.json'), JSON.stringify(await exampleFixture()));
    const grader = vi.fn();
    await expect(runCalibrationCli(
      ['--fixtures', workspace.fixtures, '--output', workspace.output, '--live'],
      {
        env: { GEMINI_API_KEY: 'test-key' },
        gradeCallQaTranscript: grader,
        io: silentIo(),
      },
    )).rejects.toThrow(/CALL_QA_CALIBRATION_LIVE=true/);
    await expect(runCalibrationCli(
      ['--fixtures', workspace.fixtures, '--output', workspace.output, '--live'],
      {
        env: { CALL_QA_CALIBRATION_LIVE: 'true', GEMINI_API_KEY: 'test-key' },
        gradeCallQaTranscript: grader,
        io: silentIo(),
      },
    )).rejects.toThrow(/--confirm-live/);
    await expect(runCalibrationCli(
      ['--fixtures', workspace.fixtures, '--output', workspace.output, '--live', '--confirm-live'],
      {
        env: { CALL_QA_CALIBRATION_LIVE: 'true' },
        gradeCallQaTranscript: grader,
        io: silentIo(),
      },
    )).rejects.toThrow(/GEMINI_API_KEYS or GEMINI_API_KEY/);
    expect(grader).not.toHaveBeenCalled();
  });

  it('confirmed live mode runs sequentially, records stability, and never edits fixtures', async () => {
    const workspace = await tempWorkspace();
    const fixture = await exampleFixture();
    // Live grading never reads the private Firestore bank: the operator embeds a
    // sanitized synthetic scenario snapshot on each grading fixture instead.
    fixture.scenarioSnapshot = {
      title: 'Synthetic rehearsal call',
      scenarioVersion: 'synthetic-rehearsal-v1',
      gradingContext: 'Synthetic rehearsal grading context for CLI tests.',
      expectedActions: ['Complete the fictional observable step.'],
      criticalMisses: ['State the fictional unsafe outcome.'],
      scoringNotes: [],
      hiddenChartState: null,
      ruleIds: [],
    };
    const fixtureFile = path.join(workspace.fixtures, 'example.json');
    const original = JSON.stringify(fixture);
    await writeFile(fixtureFile, original);
    const operational = {
      ...fixture,
      caseId: 'operational-grade-failed',
      source: 'operational-pilot',
      capture: { ...fixture.capture, gradingStatus: 'grade_failed' },
      transcript: [],
    };
    delete operational.humanReview;
    delete operational.modelRun;
    operational.capture.navigatorTurnCount = 0;
    operational.capture.callerTurnCount = 0;
    await writeFile(path.join(workspace.fixtures, 'operational.json'), JSON.stringify(operational));
    let active = 0;
    let maximumActive = 0;
    const grader = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        qa: {
          pass: true,
          score: 92,
          criteria: fixture.modelRun.criteria,
          autoFails: [],
          review: {
            recommendation: 'pass',
            reviewFlags: [],
          },
          gradingMetadata: {
            model: 'gemini-2.5-flash',
            rubricVersion: 'qa-rubric-v2',
            promptVersion: 'call-qa-grader-v4',
            scenarioVersion: 'synthetic-rehearsal-v1',
          },
        },
        grade: { score: 92 },
      };
    });
    const result = await runCalibrationCli(
      [
        '--fixtures', workspace.fixtures,
        '--output', workspace.output,
        '--live', '--confirm-live', '--repeat', '2',
      ],
      {
        env: {
          CALL_QA_CALIBRATION_LIVE: 'true',
          GEMINI_API_KEY: 'test-key',
        },
        gradeCallQaTranscript: grader,
        io: silentIo(),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(grader).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
    expect(await readFile(fixtureFile, 'utf8')).toBe(original);
    const liveRuns = JSON.parse(await readFile(path.join(workspace.output, 'live-runs.json'), 'utf8'));
    expect(liveRuns.cases[0].stability).toMatchObject({
      finalVerdictStable: true,
      criterionVerdictStability: 1,
      autoFailStable: true,
    });
  }, 15_000);

  it('generated artifact path is gitignored', async () => {
    const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
    expect(gitignore).toMatch(/^artifacts\/call-qa-calibration\/$/m);
  });
});
