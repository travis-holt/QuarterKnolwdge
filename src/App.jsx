import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import Start from './components/Start.jsx';
import Footer from './components/Footer.jsx';
import { getSession, setSession, clearSession } from './lib/session.js';

// Code-split the role apps (pilot feedback: the welcome page was slow to appear).
// Start renders from the small entry chunk; the heavy role apps — and everything
// they pull in (all dashboards, charts, the practice-call stack) — download only
// after a role is chosen, or in parallel for returning sessions.
const SupervisorApp = lazy(() => import('./components/SupervisorApp.jsx'));
const NavigatorApp = lazy(() => import('./components/NavigatorApp.jsx'));

// Top-level shell. Owns the SESSION only — who is using the app right now — and
// routes to the role-specific app. All Firestore data loading and view routing
// lives inside SupervisorApp / NavigatorApp so each role is a self-contained unit.
//
// Session is read once on mount (skips the gate for returning visitors) and
// written here on entry / cleared on sign-out, so localStorage access stays in
// one place (lib/session.js) behind these three handlers.

// Minimal shell shown while a role app's chunk downloads.
function AppLoading() {
  return (
    <div className="app">
      <main className="main">
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <div className="skeleton skeleton--line" style={{ width: '40%', margin: '0 auto 0.75rem' }} />
          <div className="skeleton skeleton--line" style={{ width: '60%', margin: '0 auto' }} />
        </div>
      </main>
    </div>
  );
}
export default function App() {
  const initialSession = useRef(getSession());
  const [session, setSessionState] = useState(null);
  const [restoring, setRestoring] = useState(Boolean(initialSession.current));

  useEffect(() => {
    const stored = initialSession.current;
    if (!stored) return;
    let active = true;
    import('./lib/firebase.js')
      .then(({ getAuthenticatedIdentity }) => getAuthenticatedIdentity())
      .then((identity) => {
        if (!active) return;
        const matches = identity?.role === stored.role && (
          stored.role !== 'navigator' || identity.navigatorId === stored.navigatorId
        );
        if (matches) setSessionState(stored);
        else clearSession();
      })
      .catch(() => { if (active) clearSession(); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);

  const enterNavigator = (navigatorId, name) => {
    setSession('navigator', name, navigatorId);
    setSessionState({ role: 'navigator', name, navigatorId });
  };

  const enterSupervisor = () => {
    setSession('supervisor', 'Supervisor', null);
    setSessionState({ role: 'supervisor', name: 'Supervisor', navigatorId: null });
  };

  const signOut = () => {
    // Clear the server-issued supervisor session cookie (best-effort; failure
    // must not block signing out), then clear the local session as before.
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    import('./lib/firebase.js').then(({ signOutFirebase }) => signOutFirebase()).catch(() => {});
    clearSession();
    setSessionState(null);
  };

  if (restoring) return <AppLoading />;

  if (!session) {
    return (
      <div className="app">
        <main className="main">
          <Start onNavigatorEntry={enterNavigator} onSupervisorEntry={enterSupervisor} />
        </main>
        <Footer />
      </div>
    );
  }

  if (session.role === 'supervisor') {
    return (
      <Suspense fallback={<AppLoading />}>
        <SupervisorApp onSignOut={signOut} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<AppLoading />}>
      <NavigatorApp
        navigatorId={session.navigatorId}
        name={session.name}
        onSignOut={signOut}
      />
    </Suspense>
  );
}
