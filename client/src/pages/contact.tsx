import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { contactMessageSchema } from "@shared/schema";
import type { ContactMessageInput } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle2 } from "lucide-react";
import { useState } from "react";

export default function Contact() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sent, setSent] = useState(false);

  const form = useForm<ContactMessageInput>({
    resolver: zodResolver(contactMessageSchema),
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      phone: user?.phone ?? "",
      message: "",
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (data: ContactMessageInput) => {
      await apiRequest("POST", "/api/contact", data);
    },
    onSuccess: () => {
      setSent(true);
      form.setValue("message", "");
    },
    onError: (err: any) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-3">You need to log in to contact us.</p>
        <Link href="/login" className="text-primary font-medium" data-testid="link-to-login">Log in</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold mb-1" data-testid="text-page-title">Contact Us</h1>
        <p className="text-sm text-muted-foreground">
          Have a question, feedback, or something not working right? Send us a note.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" /> Send an enquiry
          </CardTitle>
          <CardDescription>Your details are prefilled from your account — feel free to edit them.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="text-center py-6 space-y-2" data-testid="text-contact-sent">
              <CheckCircle2 className="h-8 w-8 text-accent mx-auto" />
              <p className="text-sm font-medium">Thanks — your message has been sent.</p>
              <p className="text-xs text-muted-foreground">We aim to revert within 3 working days.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setSent(false)} data-testid="button-send-another">
                Send another message
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => sendMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input data-testid="input-contact-name" {...field} />
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
                        <Input data-testid="input-contact-email" type="email" {...field} />
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
                      <FormLabel>Contact number</FormLabel>
                      <FormControl>
                        <Input data-testid="input-contact-phone" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Enquiry / feedback</FormLabel>
                      <FormControl>
                        <Textarea
                          data-testid="input-contact-message"
                          rows={5}
                          placeholder="Tell us what's on your mind..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={sendMutation.isPending}
                  data-testid="button-submit-contact"
                >
                  {sendMutation.isPending ? "Sending..." : "Send message"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">We aim to revert within 3 working days.</p>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
