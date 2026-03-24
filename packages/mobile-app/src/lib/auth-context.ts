import { createContext, useContext } from "react";
import type { User, Tenant } from "@clever/shared";

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  DeviceControl: { deviceId: string };
  AddDevice: undefined;
};

export interface AuthContextValue {
  user: User | null;
  tenant: Tenant | null;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  tenant: null,
  signOut: async () => {},
});

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}
