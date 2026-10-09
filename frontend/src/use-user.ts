import { useContext } from 'react';
import { UserContext, type UserCtx } from './user-context';

/** Current demo identity. See UserProvider docs — no real authentication. */
export function useUser(): UserCtx {
  return useContext(UserContext);
}
