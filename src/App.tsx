import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { ChangePin, PinLogin } from './components/Auth.js';
import { EventScreen } from './components/EventScreen.js';
import { EventsList } from './components/EventsList.js';

type View =
  | { name: 'loading' }
  | { name: 'login' }
  | { name: 'change-pin'; forced: boolean }
  | { name: 'events' }
  | { name: 'event'; id: string };

/**
 * Routing is the URL hash rather than a router library. There are three
 * screens, all of them owned by one user, and a dependency that ships its own
 * history abstraction earns its place only when there is something to abstract.
 * The hash means back works and a bookmarked event opens.
 */
function readHash(): string | null {
  const match = window.location.hash.match(/^#\/events\/(.+)$/);
  return match ? match[1] : null;
}

export default function App() {
  const [view, setView] = useState<View>({ name: 'loading' });

  const showEvents = useCallback(() => {
    const id = readHash();
    setView(id ? { name: 'event', id } : { name: 'events' });
  }, []);

  useEffect(() => {
    api
      .session()
      .then((session) => {
        if (!session.signedIn) return setView({ name: 'login' });
        if (session.mustChangePin) return setView({ name: 'change-pin', forced: true });
        showEvents();
      })
      .catch(() => setView({ name: 'login' }));
  }, [showEvents]);

  useEffect(() => {
    const onHashChange = () => {
      setView((current) =>
        current.name === 'event' || current.name === 'events'
          ? (readHash() ? { name: 'event', id: readHash() as string } : { name: 'events' })
          : current,
      );
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const openEvent = (id: string) => {
    window.location.hash = `#/events/${id}`;
    setView({ name: 'event', id });
  };

  const backToList = () => {
    window.location.hash = '';
    setView({ name: 'events' });
  };

  switch (view.name) {
    case 'loading':
      return <div className="empty">Loading…</div>;

    case 'login':
      return (
        <PinLogin
          onSignedIn={(mustChangePin) =>
            mustChangePin ? setView({ name: 'change-pin', forced: true }) : showEvents()
          }
        />
      );

    case 'change-pin':
      return (
        <ChangePin
          forced={view.forced}
          onDone={showEvents}
          onCancel={view.forced ? undefined : showEvents}
        />
      );

    case 'event':
      return <EventScreen id={view.id} onBack={backToList} />;

    case 'events':
    default:
      return (
        <EventsList
          onOpen={openEvent}
          onChangePin={() => setView({ name: 'change-pin', forced: false })}
          onSignOut={async () => {
            await api.logout();
            setView({ name: 'login' });
          }}
        />
      );
  }
}
