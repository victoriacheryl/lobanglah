import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Lazily loaded and cached — loadStripe() fetches Stripe.js from stripe.com the
// first time it's called, so we only pay that cost when a real checkout is
// actually needed (i.e. once we know a publishable key is configured).
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(publishableKey: string): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}
