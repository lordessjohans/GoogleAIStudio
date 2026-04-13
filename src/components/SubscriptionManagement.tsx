import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Check, Loader2, CreditCard, Zap, Shield, ArrowRight, ExternalLink } from 'lucide-react';
import { auth, db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { cn } from '../lib/utils';

interface Plan {
  id: string;
  name: string;
  price: string;
  priceId: string;
  description: string;
  features: string[];
  color: string;
}

const PLANS: Plan[] = [
  {
    id: 'basic',
    name: 'Basic',
    price: '$9.99',
    priceId: (import.meta as any).env.VITE_STRIPE_PRICE_BASIC || '',
    description: 'Essential tools for individual case tracking.',
    features: [
      'Unlimited Case Searches',
      'Standard AI Analysis',
      '5 Document Uploads / mo',
      'Email Support',
    ],
    color: 'bg-blue-500',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$29.99',
    priceId: (import.meta as any).env.VITE_STRIPE_PRICE_PRO || '',
    description: 'Advanced precision for complex legal navigation.',
    features: [
      'Full Win Probability Scores',
      'Unlimited Document Uploads',
      'Advanced Legal Dockets',
      'Priority AI Reasoning',
      'Direct E-filing Links',
    ],
    color: 'bg-[#1A1A1A]',
  },
];

export const SubscriptionManagement: React.FC = () => {
  const [loading, setLoading] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setSubscription(doc.data().subscription);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleSubscribe = async (priceId: string) => {
    const user = auth.currentUser;
    if (!user) return;

    setLoading(priceId);
    try {
      const response = await fetch('/api/create-subscription-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          userEmail: user.email,
          priceId,
        }),
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Subscription Error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setIsPortalLoading(true);
    try {
      const response = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid }),
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create portal session');
      }
    } catch (error) {
      console.error('Portal Error:', error);
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setIsPortalLoading(false);
    }
  };

  const isCurrentPlan = (priceId: string) => subscription?.planId === priceId && subscription?.status === 'active';

  return (
    <div className="max-w-5xl mx-auto py-12 px-6">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-light tracking-tight mb-4">Subscription Management</h2>
        <p className="text-[#9E9E9E] max-w-lg mx-auto">
          Choose the plan that fits your legal needs. Upgrade or downgrade at any time.
        </p>
      </div>

      {subscription && subscription.status === 'active' && (
        <div className="mb-12 bg-white p-8 rounded-[2.5rem] border border-[#E5E5E5] shadow-sm flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-[#F5F5F5] rounded-2xl flex items-center justify-center">
              <Shield className="w-8 h-8 text-[#1A1A1A]" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E]">Current Plan</span>
                <span className="px-2 py-0.5 bg-green-100 text-green-600 rounded text-[8px] font-bold uppercase tracking-widest">Active</span>
              </div>
              <h3 className="text-2xl font-medium">
                {PLANS.find(p => p.priceId === subscription.planId)?.name || 'Premium'} Plan
              </h3>
              <p className="text-sm text-[#9E9E9E]">
                Next billing date: {subscription.currentPeriodEnd?.toDate().toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            onClick={handleManageSubscription}
            disabled={isPortalLoading}
            className="px-8 py-4 bg-white border-2 border-[#1A1A1A] text-[#1A1A1A] rounded-2xl font-bold hover:bg-[#F5F5F5] transition-all flex items-center gap-3 disabled:opacity-50"
          >
            {isPortalLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <>
                <CreditCard className="w-5 h-5" />
                Manage Billing & Payments
                <ExternalLink className="w-4 h-4 opacity-50" />
              </>
            )}
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        {PLANS.map((plan) => (
          <motion.div
            key={plan.id}
            whileHover={{ y: -5 }}
            className={cn(
              "bg-white p-10 rounded-[3rem] border-2 transition-all relative overflow-hidden flex flex-col",
              isCurrentPlan(plan.priceId) ? "border-[#1A1A1A] shadow-xl" : "border-[#E5E5E5] hover:border-[#1A1A1A]/30"
            )}
          >
            {isCurrentPlan(plan.priceId) && (
              <div className="absolute top-6 right-6 px-3 py-1 bg-[#1A1A1A] text-white rounded-full text-[10px] font-bold uppercase tracking-widest">
                Current Plan
              </div>
            )}

            <div className="mb-8">
              <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-6", plan.color)}>
                {plan.id === 'pro' ? <Zap className="text-white w-6 h-6" /> : <Shield className="text-white w-6 h-6" />}
              </div>
              <h3 className="text-3xl font-medium mb-2">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="text-[#9E9E9E] text-sm">/month</span>
              </div>
              <p className="text-[#9E9E9E] text-sm leading-relaxed">{plan.description}</p>
            </div>

            <div className="space-y-4 mb-10 flex-1">
              {plan.features.map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-5 h-5 bg-green-50 rounded-full flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 text-green-600" />
                  </div>
                  <span className="text-sm text-[#1A1A1A]">{feature}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => handleSubscribe(plan.priceId)}
              disabled={!!loading || isCurrentPlan(plan.priceId)}
              className={cn(
                "w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2",
                isCurrentPlan(plan.priceId)
                  ? "bg-[#F5F5F5] text-[#9E9E9E] cursor-default"
                  : "bg-[#1A1A1A] text-white hover:bg-[#333] shadow-lg shadow-[#1A1A1A]/10"
              )}
            >
              {loading === plan.priceId ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isCurrentPlan(plan.priceId) ? (
                'Active Plan'
              ) : (
                <>
                  Get Started
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </motion.div>
        ))}
      </div>

      <div className="mt-16 bg-[#F5F5F5]/50 p-8 rounded-[2.5rem] border border-[#E5E5E5] text-center">
        <h4 className="font-medium mb-2">Need a custom enterprise solution?</h4>
        <p className="text-sm text-[#9E9E9E] mb-6">For law firms and large organizations requiring multiple seats and custom integrations.</p>
        <button className="text-sm font-bold text-[#1A1A1A] underline underline-offset-4 hover:text-[#333] transition-colors">
          Contact Sales Team
        </button>
      </div>
    </div>
  );
};
