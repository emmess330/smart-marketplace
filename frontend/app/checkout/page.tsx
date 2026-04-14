"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { ordersApi } from "@/lib/api";
import Cookies from "js-cookie";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

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
        setError("Order placement failed, but payment succeeded. Please contact support.");
        setLoading(false);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto bg-white p-6 rounded-xl shadow">
      <div className="mb-4">
        <p className="text-gray-600">Total: <strong>${amount.toFixed(2)}</strong></p>
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

  useEffect(() => {
    if (!Cookies.get("access_token")) {
      window.location.href = "/login";
      return;
    }
    ordersApi.getCart()
      .then(cart => {
        const total = cart.data.total;
        setAmount(total);
        return fetch("http://localhost:8003/orders/create-payment-intent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Cookies.get("access_token")}`,
          },
          body: JSON.stringify({ amount: Math.round(total * 100) }),
        });
      })
      .then(res => {
        if (!res.ok) throw new Error("Failed to create payment intent");
        return res.json();
      })
      .then(data => {
        setClientSecret(data.clientSecret);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
        alert("Could not initialize payment: " + err.message);
      });
  }, []);

  if (loading) return <div className="text-center py-8">Loading checkout...</div>;
  if (!clientSecret) return <div className="text-center py-8 text-red-500">Failed to load payment</div>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-lg mx-auto">
          <h1 className="text-2xl font-bold mb-6 text-center">Checkout</h1>
          <CheckoutForm clientSecret={clientSecret} amount={amount} />
        </div>
      </div>
    </Elements>
  );
}