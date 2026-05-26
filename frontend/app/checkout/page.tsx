"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { ordersApi } from "@/lib/api";
import Cookies from "js-cookie";
import axios from "axios";

const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = pk ? loadStripe(pk) : null;

function CheckoutForm({ clientSecret, amount }: { clientSecret: string; amount: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError("");

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/orders`,
      },
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message || "Payment failed");
      setLoading(false);
      return;
    }

    // Payment succeeded – place order
    if (paymentIntent?.status === "succeeded") {
      try {
        await ordersApi.checkout({
          shipping_address: {
            full_name: "Test User",
            line1: "123 Main St",
            city: "London",
            country: "GB",
            postal_code: "EC1A 1BB",
          },
          stripe_payment_id: paymentIntent.id,
        });
        router.push("/orders");
      } catch (err) {
        let message = "Order placement failed, but payment succeeded. Please contact support.";
        if (axios.isAxiosError(err)) {
          const data = err.response?.data as { error?: string } | undefined;
          if (data?.error) {
            message = `${message} Reason: ${data.error}`;
          }
        }
        setError(message);
        setLoading(false);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto bg-white p-6 rounded-xl shadow">
      <div className="mb-4">
        <p className="text-gray-600">Total: <strong>£{amount.toFixed(2)}</strong></p>
      </div>
      <PaymentElement />
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || loading}
        className="mt-4 w-full bg-blue-600 text-white py-2 rounded-lg disabled:opacity-50"
      >
        {loading ? "Processing..." : "Pay now"}
      </button>
      <p className="text-xs text-gray-400 text-center mt-2">
        Test card: 4242 4242 4242 4242 | Any expiry & CVC
      </p>
    </form>
  );
}

export default function CheckoutPage() {
  const [clientSecret, setClientSecret] = useState("");
  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState("");
  const stripeOptions = useMemo(
    () => ({
      clientSecret,
      appearance: { theme: "stripe" as const },
    }),
    [clientSecret],
  );

  useEffect(() => {
    if (!Cookies.get("access_token")) {
      window.location.href = "/login";
      return;
    }
    if (!pk) {
      setInitError("Stripe is not configured: set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in frontend/.env.local");
      setLoading(false);
      return;
    }
    if (!stripePromise) {
      setLoading(false);
      return;
    }

    ordersApi
      .createPaymentIntent()
      .then((res) => {
        const secret = res.data.clientSecret;
        if (!secret) {
          throw new Error(res.data.error || "No client secret returned");
        }
        setAmount(Number(res.data.total_amount) || 0);
        setClientSecret(secret);
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error(err);
        let msg = "Failed to create payment intent";
        if (axios.isAxiosError(err)) {
          const data = err.response?.data as { error?: string } | undefined;
          msg = data?.error || err.response?.statusText || err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setInitError(msg);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-center py-8">Loading checkout...</div>;
  if (initError) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4 text-center text-red-600">
        <p className="font-medium">Could not initialize payment</p>
        <p className="text-sm mt-2 text-gray-700">{initError}</p>
        <p className="text-xs mt-4 text-gray-500">
          Check orders service (port 8003), STRIPE_SECRET_KEY in backend/.env, and that publishable/secret keys are from the same Stripe account (test mode).
        </p>
      </div>
    );
  }
  if (!clientSecret || !stripePromise) {
    return <div className="text-center py-8 text-red-500">Failed to load payment</div>;
  }

  return (
    <Elements key={clientSecret} stripe={stripePromise} options={stripeOptions}>
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-lg mx-auto">
          <h1 className="text-2xl font-bold mb-6 text-center">Checkout</h1>
          <CheckoutForm clientSecret={clientSecret} amount={amount} />
        </div>
      </div>
    </Elements>
  );
}