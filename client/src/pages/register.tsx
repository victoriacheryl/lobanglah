import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerStartSchema } from "@shared/schema";
import type { RegisterStartInput } from "@shared/schema";
import { useAuth, type StartRegistrationResult } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/logo";
import { MessageCircle, ArrowLeft } from "lucide-react";

export default function Register() {
  const { startRegistration, resendRegistrationOtp, verifyRegistration } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<"details" | "otp">("details");
  const [pending, setPending] = useState<StartRegistrationResult | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const form = useForm<RegisterStartInput>({
    resolver: zodResolver(registerStartSchema),
    defaultValues: { name: "", email: "", phone: "", password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function onSubmitDetails(data: RegisterStartInput) {
    setSubmitting(true);
    try {
      const result = await startRegistration(data.name, data.email, data.phone, data.password, data.confirmPassword);
      setPending(result);
      setCode("");
      setCooldown(30);
      setStep("otp");
      toast({
        title: "Code sent",
        description: `We've sent a 6-digit code to ${result.phone} over WhatsApp.`,
      });
    } catch (err: any) {
      toast({ title: "Could not sign up", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setSubmitting(true);
    try {
      await verifyRegistration(pending.pendingToken, code);
      navigate("/");
    } catch (err: any) {
      toast({ title: "Could not verify code", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!pending || cooldown > 0) return;
    setResending(true);
    try {
      const result = await resendRegistrationOtp(pending.pendingToken);
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
          {step === "details" ? (
            <>
              <CardTitle className="font-display text-lg">Join LobangLah!</CardTitle>
              <CardDescription>Create an account to seek or offer services near you.</CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="font-display text-lg flex items-center justify-center gap-1.5">
                <MessageCircle className="h-4 w-4 text-[#25D366]" /> Verify your number
              </CardTitle>
              <CardDescription>
                Enter the 6-digit code we sent to <span className="font-medium text-foreground">{pending?.phone}</span> over WhatsApp.
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {step === "details" ? (
            <>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitDetails)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full name</FormLabel>
                        <FormControl>
                          <Input data-testid="input-name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input data-testid="input-email" type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mobile number</FormLabel>
                        <FormControl>
                          <Input data-testid="input-phone" placeholder="9123 4567" {...field} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Singapore mobile number. We'll send a WhatsApp code to verify it.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input data-testid="input-password" type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm password</FormLabel>
                        <FormControl>
                          <Input data-testid="input-confirm-password" type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={submitting} data-testid="button-submit-register">
                    {submitting ? "Sending code..." : "Continue"}
                  </Button>
                </form>
              </Form>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary font-medium" data-testid="link-to-login">Log in</Link>
              </p>
            </>
          ) : (
            <>
              <form onSubmit={onVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="otp" className="text-sm font-medium">6-digit code</label>
                  <Input
                    id="otp"
                    data-testid="input-otp-code"
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
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting || code.length !== 6}
                  data-testid="button-verify-otp"
                >
                  {submitting ? "Verifying..." : "Verify & create account"}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => setStep("details")}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    data-testid="button-back-to-details"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={onResend}
                    disabled={cooldown > 0 || resending}
                    className="text-primary font-medium disabled:text-muted-foreground disabled:cursor-not-allowed"
                    data-testid="button-resend-otp"
                  >
                    {resending ? "Resending..." : cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
                  </button>
                </div>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
