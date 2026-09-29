"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// After a redirect-based payment (Klarna, Revolut Pay, Amazon Pay…) Stripe
// sends the buyer here with ?payment_intent=…&redirect_status=…. The order
// is created by Stripe's webhook, which can land a moment after the
// redirect, so re-check the order list briefly until it shows up.
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 10;

export default function PaymentReturnNotice({
  orders,
  reload,
}: {
  orders: { stripe_payment_id?: string | null }[];
  reload: () => void;
}) {
  const searchParams = useSearchParams();
  const paymentIntent = searchParams.get("payment_intent");
  const redirectStatus = searchParams.get("redirect_status");
  const [polls, setPolls] = useState(0);

  const arrived = !!paymentIntent && orders.some((o) => o.stripe_payment_id === paymentIntent);
  const shouldPoll = !!paymentIntent && !arrived && redirectStatus !== "failed" && polls < MAX_POLLS;

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setTimeout(() => {
      reload();
      setPolls((n) => n + 1);
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [shouldPoll, polls, reload]);

  if (!paymentIntent) return null;

  const box = "mb-6 rounded-lg border px-4 py-3 text-sm";
  if (redirectStatus === "failed") {
    return (
      <div className={`${box} border-red-200 bg-red-50 text-red-800`}>
        Your payment didn&apos;t go through, so no order was placed. You can try again from your cart.
      </div>
    );
  }
  if (arrived) {
    return (
      <div className={`${box} border-green-200 bg-green-50 text-green-800`}>
        Payment received. Your order is confirmed below.
      </div>
    );
  }
  if (redirectStatus === "processing") {
    return (
      <div className={`${box} border-blue-200 bg-blue-50 text-blue-800`}>
        Your payment is processing. Your order will appear here once it completes.
      </div>
    );
  }
  if (polls < MAX_POLLS) {
    return (
      <div className={`${box} border-blue-200 bg-blue-50 text-blue-800`}>
        Payment received. Confirming your order…
      </div>
    );
  }
  return (
    <div className={`${box} border-amber-200 bg-amber-50 text-amber-800`}>
      Payment received, but your order is taking longer than usual to appear. Refresh this page
      in a minute. If it still isn&apos;t here, contact support with payment reference{" "}
      <span className="font-mono">{paymentIntent}</span>.
    </div>
  );
}
