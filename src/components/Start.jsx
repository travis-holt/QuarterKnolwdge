import { DOMAINS, QUESTIONS } from '../data/questions.js';

export default function Start({ onStart, onOverview }) {
  return (
    <section className="start">
      <p className="start__eyebrow">A short quarterly check</p>
      <h1 className="start__title">
        Real scenarios — <span className="accent">development and fit</span>, not pass/fail.
      </h1>
      <p className="start__lede">
        {QUESTIONS.length} situation-based questions across {DOMAINS.length} knowledge domains.
        You won&rsquo;t get a single grade — you&rsquo;ll get a clear read on where you&rsquo;re
        already strong, where you&rsquo;re solid, and where a little more practice would help.
      </p>

      <div className="start__cta">
        <button className="btn btn--primary btn--lg" onClick={onStart}>
          Take the check
        </button>
        <button className="btn btn--ghost btn--lg" onClick={onOverview}>
          View the team dashboard
        </button>
      </div>

      <div className="start__domains">
        <p className="start__domains-label">What it covers</p>
        <ul className="start__domain-list">
          {DOMAINS.map((d) => (
            <li key={d.id} className="start__domain">
              <span className="tag">{d.name}</span>
              <span className="start__domain-blurb">{d.blurb}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
