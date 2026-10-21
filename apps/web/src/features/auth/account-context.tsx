import { createContext, useContext, type ReactNode } from "react";
import type { AccountService } from "../../services/index.ts";

const AccountContext = createContext<AccountService | null>(null);

/** The account service for the sign-in screens (password reset, confirmation, invitations). */
export function AccountProvider({ account, children }: { readonly account: AccountService; readonly children: ReactNode }) {
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountService {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount() called outside AccountProvider.");
  return account;
}
