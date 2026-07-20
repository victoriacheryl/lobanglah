import { useEffect, useRef, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { Mail, CheckCircle2, XCircle } from "lucide-react";

// Standalone landing page for the link emailed at the end of sign-up (step
// 2 of registration). Deliberately self-contained: this may be opened in a
// different tab or even a different device than the one sign-up was started
// on, so it can't assume any other client-side state exists — it just takes
// the :token from the URL and asks the server to finish creating the account.
export default function VerifyEmail() {
  const { token } = useParams<{ token: string }>();
  const { verifyRegistrationEmailLink } = useAuth();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    // Guards against React 18 StrictMode's double-invoke in dev, which would
    // otherwise burn the (single-use) verification token on the first,
    // throwaway call.
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setStatus("error");
      setError("This verification link is missing its token.");
      return;
    }

    verifyRegistrationEmailLink(token)
      .then(() => {
        setStatus("success");
        setTimeout(() => navigate("/"), 2000);
      })
      .catch((err: any) => {
        setStatus("error");
        setError(err.message || "This verification link is invalid or has expired.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 text-primary"><Logo className="h-9 w-9" /></div>
          {status === "verifying" ? (
            <>
              <CardTitle className="font-display text-lg flex items-center justify-center gap-1.5">
                <Mail className="h-4 w-4 text-primary" /> Verifying your email...
              </CardTitle>
              <CardDescription>Hang on while we confirm your account.</CardDescription>
            </>
          ) : status === "success" ? (
            <>
              <CardTitle className="font-display text-lg flex items-center justify-center gap-1.5 text-primary">
                <CheckCircle2 className="h-4 w-4" /> Email verified
              </CardTitle>
              <CardDescription>Your account is ready. Taking you to LobangLah!...</CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="font-display text-lg flex items-center justify-center gap-1.5 text-destructive">
                <XCircle className="h-4 w-4" /> Could not verify email
              </CardTitle>
              <CardDescription data-testid="text-verify-email-error">{error}</CardDescription>
            </>
          )}
        </CardHeader>
        {status === "error" && (
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/register")} data-testid="button-back-to-register">
              Back to sign up
            </Button>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary font-medium" data-testid="link-to-login">Log in</Link>
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
