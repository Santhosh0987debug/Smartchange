import { createContext } from 'react';
import type { User } from './api';

export interface UserCtx {
  users: User[];
  current: User | null;
  operatorId: string;
  setOperatorId: (id: string) => void;
  loading: boolean;
}

export const UserContext = createContext<UserCtx>({
  users: [],
  current: null,
  operatorId: 'demo-operator',
  setOperatorId: () => undefined,
  loading: false,
});
