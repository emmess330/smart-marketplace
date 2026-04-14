"use client";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, StripeElementsOptions } from "@stripe/stripe-js";
import { ReactNode } from "react";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export default function CheckoutProvider({ children, clientSecret }: { children: ReactNode; clientSecret: string }) {
  const options: StripeElementsOptions = {
    clientSecret,
    appearance: { theme: "stripe" },
  };
  return (
    <Elements stripe={stripePromise} options={options}>
      {children}
    </Elements>
  );
}