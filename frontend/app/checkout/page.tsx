"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { ordersApi, type ShippingAddress } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import Cookies from "js-cookie";
import axios from "axios";

const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = pk ? loadStripe(pk) : null;

const COUNTRIES = [
  ["GB", "United Kingdom"],
  ["IE", "Ireland"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
  ["US", "United States"],
] as const;

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

function errorMessage(err: unknown, fallback: string) {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    return data?.error || err.response?.statusText || err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

function AddressForm({
  initial,
  submitting,
  error,
  onSubmit,
}: {
  initial: ShippingAddress;
  submitting: boolean;
  error: string;
  onSubmit: (address: ShippingAddress) => void;
}) {
  const [address, setAddress] = useState(initial);
  const set = (field: keyof ShippingAddress) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setAddress({ ...address, [field]: e.target.value });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(address);
      }}
      className="max-w-md mx-auto bg-white p-6 rounded-xl shadow space-y-3"
    >
      <h2 className="font-semibold text-gray-900">Shipping address</h2>
      <input className={inputClass} placeholder="Full name" autoComplete="name"
        required minLength={2} maxLength={255} value={address.full_name} onChange={set("full_name")} />
      <input className={inputClass} placeholder="Address line 1" autoComplete="address-line1"
        required maxLength={255} value={address.line1} onChange={set("line1")} />
      <input className={inputClass} placeholder="Address line 2 (optional)" autoComplete="address-line2"
        maxLength={255} value={address.line2 ?? ""} onChange={set("line2")} />
      <div className="grid grid-cols-2 gap-3">
        <input className={inputClass} placeholder="City" autoComplete="address-level2"
          required maxLength={100} value={address.city} onChange={set("city")} />
        <input className={inputClass} placeholder="Postcode" autoComplete="postal-code"
          required minLength={2} maxLength={20} value={address.postal_code} onChange={set("postal_code")} />
      </div>
      <select className={inputClass} autoComplete="country" value={address.country} onChange={set("country")}>
        {COUNTRIES.map(([code, name]) => (
          <option key={code} value={code}>{name}</option>
        ))}
      </select>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 text-white py-2 rounded-lg disabled:opacity-50"
      >
        {submitting ? "Preparing payment..." : "Continue to payment"}
      </button>
    </form>
  );
}

function CheckoutForm({
  amount,
  address,
  onEditAddress,
}: {
  amount: number;
  address: ShippingAddress;
  onEditAddress: () => void;
}) {
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
        await ordersApi.checkout(paymentIntent.id);
        router.push("/orders");
      } catch (err) {
        let message = "Order placement failed, but payment succeeded. Please contact support.";
        if (axios.isAxiosError(err)) {
          const data = err.response?.data as { error?: string; refunded?: boolean } | undefined;
          if (data?.refunded) {
            message = `We couldn't place your order (${data.error}). Your payment has been refunded.`;
          } else if (data?.error) {
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
      <div className="mb-4 flex justify-between items-start text-sm">
        <div className="text-gray-600">
          <p className="font-medium text-gray-900">{address.full_name}</p>
          <p>{address.line1}{address.line2 ? `, ${address.line2}` : ""}</p>
          <p>{address.city} {address.postal_code}, {address.country}</p>
        </div>
        <button type="button" onClick={onEditAddress} disabled={loading}
          className="text-blue-600 hover:underline disabled:opacity-50">
          Edit
        </button>
      </div>
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
  const { user } = useAuthStore();
  const [address, setAddress] = useState<ShippingAddress | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [amount, setAmount] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [addressError, setAddressError] = useState("");
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
    }
  }, []);

  // The address is validated (and attached to the payment) before the card
  // form appears, so a bad address can never be rejected after payment.
  const startPayment = async (shippingAddress: ShippingAddress) => {
    setPreparing(true);
    setAddressError("");
    try {
      const res = await ordersApi.createPaymentIntent(shippingAddress);
      const secret = res.data.clientSecret;
      if (!secret) {
        throw new Error(res.data.error || "No client secret returned");
      }
      setAddress(shippingAddress);
      setAmount(Number(res.data.total_amount) || 0);
      setClientSecret(secret);
    } catch (err: unknown) {
      console.error(err);
      setAddressError(errorMessage(err, "Failed to create payment intent"));
    } finally {
      setPreparing(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-lg mx-auto px-4">
        <h1 className="text-2xl font-bold mb-6 text-center text-gray-900">Checkout</h1>
        {clientSecret && address && stripePromise ? (
          <Elements key={clientSecret} stripe={stripePromise} options={stripeOptions}>
            <CheckoutForm
              amount={amount}
              address={address}
              onEditAddress={() => setClientSecret("")}
            />
          </Elements>
        ) : (
          <AddressForm
            // Re-mount once the user loads so their name pre-fills.
            key={user?.id ?? "anon"}
            initial={address ?? {
              full_name: user?.full_name ?? "",
              line1: "",
              line2: "",
              city: "",
              postal_code: "",
              country: "GB",
            }}
            submitting={preparing}
            error={addressError}
            onSubmit={startPayment}
          />
        )}
      </div>
    </div>
  );
}
