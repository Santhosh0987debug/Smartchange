import { useState, type ReactNode } from 'react';
import { useUsers } from './queries';
import type { User } from './api';
import { UserContext } from './user-context';

const STORAGE_KEY = 'smartchange.demoUser';

/**
 * Demo identity provider. The prototype has no real authentication: the user
 * picks one of the seeded demo identities and every write is attributed to it
 * via audit_events.actor_id. This is labeled as such in the UI.
 */
export function UserProvider({ children }: { children: ReactNode }) {
  const usersQuery = useUsers();
  const [operatorId, setOperatorIdState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? 'demo-operator',
  );
  const users: User[] = usersQuery.data ?? [];
  const current: User | null =
    users.find((u) => u.id === operatorId) ??
    users.find((u) => u.id === 'demo-operator') ??
    users[0] ??
    null;

  function setOperatorId(id: string) {
    setOperatorIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  return (
    <UserContext.Provider
      value={{ users, current, operatorId: current?.id ?? operatorId, setOperatorId, loading: usersQuery.isLoading }}
    >
      {children}
    </UserContext.Provider>
  );
}
