import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiRequest, setAuthToken, setAccountRestrictedHandler, queryClient } from "./queryClient";
import { useToast } from "@/hooks/use-toast";

const AUTH_USER_STORAGE_KEY = "lobanglah-auth-user";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  isAdmin: boolean;
}

export interface StartRegistrationResult {
  pendingToken: string;
  phone: string;
  expiresInSeconds: number;
  devCode?: string;
}

/** Returned once the phone OTP is verified — a confirmation link has just
 *  been emailed, and the account doesn't exist yet until that link is
 *  clicked. */
export interface VerifyPhoneResult {
  pendingToken: string;
  email: string;
  expiresInSeconds: number;
  /** Only set in dev/simulated mode (no Resend configured) — the full link URL. */
  devVerifyUrl?: string;
}

export interface StartPasswordResetResult {
  pendingToken: string;
  phone: string;
  expiresInSeconds: number;
  devCode?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  startRegistration: (
    name: string,
    email: string,
    phone: string,
    password: string,
    confirmPassword: string
  ) => Promise<StartRegistrationResult>;
  resendRegistrationOtp: (pendingToken: string) => Promise<StartRegistrationResult>;
  verifyRegistration: (pendingToken: string, code: string) => Promise<VerifyPhoneResult>;
  resendRegistrationEmailLink: (pendingToken: string) => Promise<VerifyPhoneResult>;
  verifyRegistrationEmailLink: (token: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string, confirmNewPassword: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<StartPasswordResetResult>;
  resendPasswordResetOtp: (pendingToken: string) => Promise<StartPasswordResetResult>;
  resetPassword: (
    pendingToken: string,
    code: string,
    newPassword: string,
    confirmNewPassword: string
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// NOTE: token is kept in memory only (no localStorage/cookies — blocked in the
// sandboxed preview iframe). In production this would be a secure httpOnly
// session cookie or refresh-token flow. See spec doc "Auth" section.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const { toast } = useToast();

  function persistSession(nextUser: AuthUser | null, nextToken: string | null) {
    setUser(nextUser);
    setToken(nextToken);
    setAuthToken(nextToken);

    if (typeof window === "undefined") return;

    try {
      if (nextUser && nextToken) {
        window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(nextUser));
      } else {
        window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const storedUser = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
      const storedToken = window.localStorage.getItem("lobanglah-auth-token");

      if (storedUser && storedToken) {
        const parsedUser = JSON.parse(storedUser) as AuthUser;
        setUser(parsedUser);
        setToken(storedToken);
        setAuthToken(storedToken);
      }
    } catch {
      // Ignore malformed session state and fall back to signed-out.
    }
  }, []);

  // If an admin suspends or bans this account while the browser tab is
  // already open, the server starts rejecting every authenticated request
  // with 403 accountRestricted — otherwise the user would just see a
  // scattering of unrelated-looking "forbidden" toasts across the page as
  // each in-flight query fails. Catch that signal once here and force a
  // clean logout with a clear explanation instead.
  useEffect(() => {
    setAccountRestrictedHandler((message) => {
      persistSession(null, null);
      queryClient.clear();
      toast({ title: "Signed out", description: message, variant: "destructive" });
    });
    return () => setAccountRestrictedHandler(null);
  }, [toast]);

  async function login(email: string, password: string) {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    persistSession(data.user, data.token);
    // Every cached query (notifications, listings/mine, fees/mine, etc.) was
    // fetched under whatever identity — or lack of one — was active before
    // this call. Without clearing it, components that don't happen to
    // remount keep showing the previous user's data (or another user's
    // private data, if switching accounts in the same tab) until their next
    // poll/refetch fires, which can be many seconds away.
    queryClient.clear();
  }

  // Step 1 of sign-up: validates details, creates a pending registration
  // server-side, and sends a 6-digit code to the phone number over WhatsApp.
  // No account exists yet — that only happens after verifyRegistration().
  async function startRegistration(
    name: string,
    email: string,
    phone: string,
    password: string,
    confirmPassword: string
  ): Promise<StartRegistrationResult> {
    const res = await apiRequest("POST", "/api/auth/register/start", {
      name,
      email,
      phone,
      password,
      confirmPassword,
    });
    return res.json();
  }

  async function resendRegistrationOtp(pendingToken: string): Promise<StartRegistrationResult> {
    const res = await apiRequest("POST", "/api/auth/register/resend", { pendingToken });
    return res.json();
  }

  // Step 2 of sign-up: verifies the WhatsApp code. The account still doesn't
  // exist yet — this emails a confirmation link and the frontend moves on to
  // the "check your email" screen.
  async function verifyRegistration(pendingToken: string, code: string): Promise<VerifyPhoneResult> {
    const res = await apiRequest("POST", "/api/auth/register/verify", { pendingToken, code });
    return res.json();
  }

  async function resendRegistrationEmailLink(pendingToken: string): Promise<VerifyPhoneResult> {
    const res = await apiRequest("POST", "/api/auth/register/resend-email", { pendingToken });
    return res.json();
  }

  // Step 3 of sign-up: called from the standalone /verify-email/:token page
  // when the user clicks the link in their email. Verifies the link token
  // and creates the real account. Takes just the link token — this may run
  // in a different tab/device than the one sign-up was started on, so there's
  // no pendingToken available here.
  async function verifyRegistrationEmailLink(token: string) {
    const res = await apiRequest("POST", "/api/auth/register/verify-email-link", { token });
    const data = await res.json();
    persistSession(data.user, data.token);
    queryClient.clear();
  }

  // Change password for the signed-in user. On success, other sessions for
  // this account are invalidated server-side; this device stays signed in.
  async function changePassword(currentPassword: string, newPassword: string, confirmNewPassword: string) {
    await apiRequest("POST", "/api/auth/change-password", {
      currentPassword,
      newPassword,
      confirmNewPassword,
    });
  }

  // Step 1 of forgot-password: looks up the account by email and sends a
  // 6-digit code to the phone number already on file over WhatsApp.
  async function requestPasswordReset(email: string): Promise<StartPasswordResetResult> {
    const res = await apiRequest("POST", "/api/auth/forgot-password/start", { email });
    return res.json();
  }

  async function resendPasswordResetOtp(pendingToken: string): Promise<StartPasswordResetResult> {
    const res = await apiRequest("POST", "/api/auth/forgot-password/resend", { pendingToken });
    return res.json();
  }

  // Step 2 of forgot-password: verifies the code and sets the new password.
  // Does not sign the user in — they return to the login page to sign in
  // with the new password.
  async function resetPassword(pendingToken: string, code: string, newPassword: string, confirmNewPassword: string) {
    await apiRequest("POST", "/api/auth/forgot-password/reset", {
      pendingToken,
      code,
      newPassword,
      confirmNewPassword,
    });
  }

  function logout() {
    persistSession(null, null);
    // Purge every cached query so a subsequent login (by this user or a
    // different one, in the same tab) never renders stale data left over
    // from this session.
    queryClient.clear();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        startRegistration,
        resendRegistrationOtp,
        verifyRegistration,
        resendRegistrationEmailLink,
        verifyRegistrationEmailLink,
        changePassword,
        requestPasswordReset,
        resendPasswordResetOtp,
        resetPassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
