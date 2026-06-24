import { useState } from 'react';
import Start from './components/Start.jsx';
import SupervisorApp from './components/SupervisorApp.jsx';
import NavigatorApp from './components/NavigatorApp.jsx';
import Footer from './components/Footer.jsx';
import { getSession, setSession, clearSession } from './lib/session.js';

// Top-level shell. Owns the SESSION only — who is using the app right now — and
// routes to the role-specific app. All Firestore data loading and view routing
// lives inside SupervisorApp / NavigatorApp so each role is a self-contained unit.
//
// Session is read once on mount (skips the gate for returning visitors) and
// written here on entry / cleared on sign-out, so localStorage access stays in
// one place (lib/session.js) behind these three handlers.
export default function App() {
  const [session, setSessionState] = useState(() => getSession());

  const enterNavigator = (navigatorId, name) => {
    setSession('navigator', name, navigatorId);
    setSessionState({ role: 'navigator', name, navigatorId });
  };

  const enterSupervisor = () => {
    setSession('supervisor', 'Supervisor', null);
    setSessionState({ role: 'supervisor', name: 'Supervisor', navigatorId: null });
  };

  const signOut = () => {
    clearSession();
    setSessionState(null);
  };

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
    return <SupervisorApp onSignOut={signOut} />;
  }

  return (
    <NavigatorApp
      navigatorId={session.navigatorId}
      name={session.name}
      onSignOut={signOut}
    />
  );
}
