import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Stripe from "stripe";
import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
if (fs.existsSync(firebaseConfigPath)) {
  const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = admin.firestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Stripe Webhook needs raw body
  app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      if (!sig || !webhookSecret) {
        throw new Error("Missing stripe-signature or webhook secret");
      }
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;
          const subscriptionId = session.subscription as string;

          if (userId && subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId) as any;
            const planId = subscription.items.data[0].price.id;

            await db.collection("users").doc(userId).set({
              subscription: {
                id: subscriptionId,
                status: subscription.status,
                planId: planId,
                currentPeriodEnd: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
              },
            }, { merge: true });
          }
          break;
        }
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object as any;
          const customerId = subscription.customer as string;
          
          // Find user by Stripe Customer ID
          const userSnapshot = await db.collection("users").where("stripeCustomerId", "==", customerId).limit(1).get();
          
          if (!userSnapshot.empty) {
            const userDoc = userSnapshot.docs[0];
            const planId = subscription.items.data[0].price.id;

            await userDoc.ref.set({
              subscription: {
                id: subscription.id,
                status: subscription.status,
                planId: planId,
                currentPeriodEnd: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
              },
            }, { merge: true });
          }
          break;
        }
      }
      res.json({ received: true });
    } catch (error: any) {
      console.error("Error processing webhook:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.use(express.json());

  // Stripe Checkout Session Endpoint for Subscriptions
  app.post("/api/create-subscription-checkout", async (req, res) => {
    try {
      const { userId, userEmail, priceId } = req.body;

      // Check if user already has a Stripe Customer ID
      const userDoc = await db.collection("users").doc(userId).get();
      let customerId = userDoc.data()?.stripeCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: userEmail,
          metadata: { userId },
        });
        customerId = customer.id;
        await db.collection("users").doc(userId).set({ stripeCustomerId: customerId }, { merge: true });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: `${process.env.APP_URL || "http://localhost:3000"}/subscription?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL || "http://localhost:3000"}/subscription`,
        metadata: { userId },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Stripe Customer Portal Endpoint
  app.post("/api/create-portal-session", async (req, res) => {
    try {
      const { userId } = req.body;
      const userDoc = await db.collection("users").doc(userId).get();
      const customerId = userDoc.data()?.stripeCustomerId;

      if (!customerId) {
        return res.status(400).json({ error: "No Stripe customer found for this user." });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.APP_URL || "http://localhost:3000"}/subscription`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Portal Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Data.gov Proxy Endpoint
  app.get("/api/datagov/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }

      const response = await fetch(`https://catalog.data.gov/api/3/action/package_search?q=${encodeURIComponent(q as string)}&rows=10`);
      if (!response.ok) {
        throw new Error(`Data.gov API responded with status: ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Data.gov Proxy Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/datagov/show", async (req, res) => {
    try {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Query parameter 'id' is required" });
      }

      const response = await fetch(`https://catalog.data.gov/api/3/action/package_show?id=${encodeURIComponent(id as string)}`);
      if (!response.ok) {
        throw new Error(`Data.gov API responded with status: ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Data.gov Proxy Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
