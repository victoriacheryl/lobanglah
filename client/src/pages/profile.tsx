import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordSchema } from "@shared/schema";
import type { ChangePasswordInput } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, User as UserIcon, Mail } from "lucide-react";
import { formatUserNumber } from "@/lib/format";

export default function Profile() {
  const { user, changePassword } = useAuth();
  const { toast } = useToast();

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmNewPassword: "" },
  });

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-3">You need to log in to view your profile.</p>
        <Link href="/login" className="text-primary font-medium" data-testid="link-to-login">Log in</Link>
      </div>
    );
  }

  async function onSubmit(data: ChangePasswordInput) {
    try {
      await changePassword(data.currentPassword, data.newPassword, data.confirmNewPassword);
      form.reset();
      toast({ title: "Password changed", description: "Your password has been updated. Other devices have been signed out." });
    } catch (err: any) {
      toast({ title: "Could not change password", description: err.message, variant: "destructive" });
    }
  }

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="mx-auto max-w-md px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold mb-1" data-testid="text-page-title">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account details and password.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserIcon className="h-4 w-4 text-muted-foreground" /> Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
              {initials}
            </div>
            <div>
              <p className="font-medium flex items-center gap-1.5" data-testid="text-profile-name">
                {user.name}
                <span className="text-[10px] font-mono font-normal text-muted-foreground" data-testid="text-profile-userid">
                  userID#{formatUserNumber(user.id)}
                </span>
              </p>
              <p className="text-muted-foreground text-xs" data-testid="text-profile-email">{user.email}</p>
            </div>
          </div>
          <div className="pt-2 border-t border-border mt-3">
            <p className="text-muted-foreground text-xs mb-0.5">Mobile number</p>
            <p data-testid="text-profile-phone">{user.phone}</p>
          </div>
          <div className="text-xs text-muted-foreground flex items-start gap-1.5 pt-2 border-t border-border mt-3">
            <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>
              Your email and mobile number are verified and can't be changed here. Email{" "}
              <a href="mailto:hello@lobanglah.sg" className="text-primary font-medium">hello@lobanglah.sg</a> for
              assistance.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" /> Change password
          </CardTitle>
          <CardDescription>Changing your password signs you out on all other devices.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current password</FormLabel>
                    <FormControl>
                      <Input data-testid="input-current-password" type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input data-testid="input-new-password" type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmNewPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm new password</FormLabel>
                    <FormControl>
                      <Input data-testid="input-confirm-new-password" type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
                data-testid="button-submit-change-password"
              >
                {form.formState.isSubmitting ? "Saving..." : "Change password"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
