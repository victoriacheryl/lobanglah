import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordStartSchema } from "@shared/schema";
import type { ForgotPasswordStartInput } from "@shared/schema";
import { useAuth, type StartPasswordResetResult } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/logo";
import { MessageCircle, ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  const { requestPasswordReset, resendPasswordResetOtp, resetPassword } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<"email" | "reset">("email");
  const [pending, setPending] = useState<StartPasswordResetResult | null>(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const form = useForm<ForgotPasswordStartInput>({
    resolver: zodResolver(forgotPasswordStartSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function onSubmitEmail(data: ForgotPasswordStartInput) {
    setSubmitting(true);
    try {
      const result = await requestPasswordReset(data.email);
      setPending(result);
      setCode("");
      setNewPassword("");
      setConfirmNewPassword("");
      setCooldown(30);
      setStep("reset");
      toast({
        title: "Code sent",
        description: `We've sent a 6-digit code to ${result.phone} over WhatsApp.`,
      });
    } catch (err: any) {
      toast({ title: "Could not send code", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    if (newPassword !== confirmNewPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(pending.pendingToken, code, newPassword, confirmNewPassword);
      toast({ title: "Password reset", description: "You can now log in with your new password." });
      navigate("/login");
    } catch (err: any) {
      toast({ title: "Could not reset password", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!pending || cooldown > 0) return;
    setResending(true);
    try {
      const result = await resendPasswordResetOtp(pending.pendingToken);
      setPending(result);
      setCooldown(30);
      toast({ title: "Code resent", description: `Sent another code to ${result.phone} over WhatsApp.` });
    } catch (err: any) {
      toast({ title: "Could not resend code", description: err.message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 text-primary"><Logo className="h-9 w-9" /></div>
          {step === "email" ? (
            <>
              <CardTitle className="font-display text-lg">Forgot your password?</CardTitle>
              <CardDescription>Enter your account email and we'll send a code to your phone.</CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="font-display text-lg flex items-center justify-center gap-1.5">
                <MessageCircle className="h-4 w-4 text-[#25D366]" /> Reset your password
              </CardTitle>
              <CardDescription>
                Enter the 6-digit code we sent to <span className="font-medium text-foreground">{pending?.phone}</span> over WhatsApp, then set a new password.
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitEmail)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input data-testid="input-forgot-email" type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={submitting} data-testid="button-submit-forgot-password">
                    {submitting ? "Sending code..." : "Send code"}
                  </Button>
                </form>
              </Form>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Remembered your password?{" "}
                <Link href="/login" className="text-primary font-medium" data-testid="link-to-login">Log in</Link>
              </p>
            </>
          ) : (
            <form onSubmit={onSubmitReset} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="reset-otp" className="text-sm font-medium">6-digit code</label>
                <Input
                  id="reset-otp"
                  data-testid="input-reset-otp-code"
                  inputMode="numeric"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  className="text-center text-lg tracking-[0.5em] font-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </div>
              {pending?.devCode && (
                <div className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground" data-testid="text-dev-otp-hint">
                  Demo mode: no WhatsApp Business API is connected yet, so no real message was sent. Your code is{" "}
                  <span className="font-mono font-semibold text-foreground">{pending.devCode}</span>.
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="reset-new-password" className="text-sm font-medium">New password</label>
                <Input
                  id="reset-new-password"
                  data-testid="input-reset-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="reset-confirm-password" className="text-sm font-medium">Confirm new password</label>
                <Input
                  id="reset-confirm-password"
                  data-testid="input-reset-confirm-password"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || code.length !== 6 || newPassword.length < 6}
                data-testid="button-submit-reset-password"
              >
                {submitting ? "Resetting..." : "Reset password"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  data-testid="button-back-to-email"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  type="button"
                  onClick={onResend}
                  disabled={cooldown > 0 || resending}
                  className="text-primary font-medium disabled:text-muted-foreground disabled:cursor-not-allowed"
                  data-testid="button-resend-reset-otp"
                >
                  {resending ? "Resending..." : cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
