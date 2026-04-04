import React, { useState, useRef, useEffect } from 'react';
import { Search, Upload, FileText, CheckCircle, AlertCircle, Loader2, Scale, ChevronRight, Info, Calendar, Plus, Trash2, Bell, TrendingUp, Lock, Gavel, Users, Mail, ArrowRight, ShieldCheck, Database, BarChart3, MessageCircle, X, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from './lib/utils';
import { searchCaseInfo, analyzeCaseDocument, generateReminders, chatWithAssistant } from './services/geminiService';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, addDoc, getDocs, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, setDoc, updateDoc, getDoc } from 'firebase/firestore';

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, errorInfo: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5] p-6">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-sm border border-[#E5E5E5] text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-[#9E9E9E] text-sm mb-6">
              {this.state.errorInfo?.includes('{') ? 'A database error occurred. Please check your permissions.' : 'An unexpected error occurred.'}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-[#1A1A1A] text-white rounded-full text-sm font-medium hover:bg-[#333]"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface CaseResult {
  content: string;
  type: 'search' | 'upload';
}

interface Deadline {
  id: string;
  title: string;
  date: string;
  description: string;
}

interface Lead {
  id: string;
  name: string;
  email: string;
  createdAt: any;
}

type Tab = 'guide' | 'tracker' | 'public-records' | 'crm';

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>('guide');
  const [searchQuery, setSearchQuery] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [dob, setDob] = useState('');
  const [searchMode, setSearchMode] = useState<'universal' | 'individual'>('universal');
  const [selectedCaseType, setSelectedCaseType] = useState<string>('');
  const [jurisdiction, setJurisdiction] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<CaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(true); // Default to true to bypass paywall
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth State
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Tracker State
  const [deadlines, setDeadlines] = useState<Deadline[]>(() => {
    const saved = localStorage.getItem('action_jaxson_deadlines');
    return saved ? JSON.parse(saved) : [];
  });
  const [newDeadline, setNewDeadline] = useState({ title: '', date: '', description: '' });
  const [aiTips, setAiTips] = useState<string | null>(null);
  const [isGeneratingTips, setIsGeneratingTips] = useState(false);

  // Landing & CRM State
  const [isLandingPage, setIsLandingPage] = useState(true);
  const [leadForm, setLeadForm] = useState({ name: '', email: '' });
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLeadsLoading, setIsLeadsLoading] = useState(false);

  // AI Assistant State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model'; content: string }[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [dataGovResults, setDataGovResults] = useState<any[]>([]);
  const [isDataGovLoading, setIsDataGovLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      if (currentUser) {
        setIsAdmin(currentUser.email === 'lordessjohans@gmail.com');
        
        // Ensure user profile exists in Firestore
        const userDocRef = doc(db, 'users', currentUser.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            await setDoc(userDocRef, {
              email: currentUser.email,
              isSubscribed: false,
              role: 'user',
              createdAt: serverTimestamp()
            });
          }
        } catch (err) {
          console.error("Error checking/creating user profile:", err);
        }
      } else {
        setIsAdmin(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAdmin && activeTab === 'crm') {
      setIsLeadsLoading(true);
      const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const leadsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Lead[];
        setLeads(leadsData);
        setIsLeadsLoading(false);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'leads');
      });
      return () => unsubscribe();
    }
  }, [isAdmin, activeTab]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setIsLandingPage(false);
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsLandingPage(true);
      setIsSubscribed(false);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  useEffect(() => {
    localStorage.setItem('action_jaxson_deadlines', JSON.stringify(deadlines));
  }, [deadlines]);

  // Sync Subscription Status
  useEffect(() => {
    if (user) {
      const userDocRef = doc(db, 'users', user.uid);
      const unsubscribe = onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
          setIsSubscribed(true); // Always true for now
        }
      }, (err) => {
        console.error("Error fetching subscription status:", err);
      });
      return () => unsubscribe();
    } else {
      setIsSubscribed(true); // Always true for now
    }
  }, [user]);

  // Handle Payment Success Redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success' && user) {
      const updateSubscription = async () => {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          await updateDoc(userDocRef, {
            isSubscribed: true,
            subscriptionDate: serverTimestamp()
          });
          setIsSubscribed(true);
          // Clear query params
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
          console.error("Error updating subscription after payment:", err);
        }
      };
      updateSubscription();
    }
  }, [user]);

  const handleCheckout = async () => {
    if (!user) {
      handleLogin();
      return;
    }

    setIsCheckingOut(true);
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.uid,
          userEmail: user.email,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      // Open Stripe Checkout in a new tab
      if (data.url) {
        window.open(data.url, '_blank');
      }
    } catch (err: any) {
      console.error("Checkout failed", err);
      alert("Failed to start checkout. Please try again.");
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    setResult(null);

    try {
      const content = await searchCaseInfo(searchQuery, selectedCaseType, jurisdiction);
      setResult({ content, type: 'search' });
    } catch (err) {
      setError('Failed to find case information. Please try again or check the details.');
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleIndividualSearch = async () => {
    if (!firstName.trim() || !lastName.trim()) return;

    setIsSearching(true);
    setError(null);
    setResult(null);

    try {
      const details = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim() || undefined,
        dob: dob || undefined
      };
      const content = await searchCaseInfo('', selectedCaseType, jurisdiction, details);
      setResult({ content, type: 'search' });
    } catch (err) {
      setError('Failed to find individual records. Please try again or check the details.');
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDataGovSearch = async (query: string) => {
    if (!query.trim()) return;
    setIsDataGovLoading(true);
    try {
      const { dataGovService } = await import('./services/dataGovService');
      const results = await dataGovService.searchDatasets(query);
      setDataGovResults(results);
      setActiveTab('public-records');
    } catch (err) {
      console.error("Data.gov search failed", err);
    } finally {
      setIsDataGovLoading(false);
    }
  };

  const handleUniversalSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    const queryLower = searchQuery.toLowerCase();
    const isPublicRecords = queryLower.includes('public records') || 
                            queryLower.includes('dataset') || 
                            queryLower.includes('data.gov') ||
                            (queryLower.includes('records') && queryLower.includes('search'));

    if (isPublicRecords) {
      handleDataGovSearch(searchQuery);
      setSearchQuery('');
      return;
    }

    const isQuestion = (queryLower.includes('?') || 
                       /^(how|what|why|where|when|who|can|is|are|do|does|help|tell|explain)/i.test(searchQuery.trim())) &&
                       !/\d/.test(searchQuery); // If it contains numbers, it might be a case number

    if (isQuestion) {
      handleChat(undefined, searchQuery);
      setSearchQuery('');
    } else {
      handleSearch(undefined);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const supportedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!supportedTypes.includes(file.type)) {
      setError('Unsupported file type. Please upload a PDF or an image (JPEG, PNG, WEBP).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Validate file size (e.g., 10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setError('File is too large. Please upload a document smaller than 10MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    setError(null);
    setResult(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const content = await analyzeCaseDocument(base64, file.type);
          setResult({ content, type: 'upload' });
        } catch (err) {
          setError('Failed to analyze the document. Ensure it is a clear PDF or image.');
          console.error(err);
        } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        setError('Error reading file.');
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('An unexpected error occurred during upload.');
      setIsUploading(false);
      console.error(err);
    }
  };

  const addDeadline = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeadline.title || !newDeadline.date) return;
    
    const deadline: Deadline = {
      id: crypto.randomUUID(),
      ...newDeadline
    };
    setDeadlines([...deadlines, deadline]);
    setNewDeadline({ title: '', date: '', description: '' });
  };

  const removeDeadline = (id: string) => {
    setDeadlines(deadlines.filter(d => d.id !== id));
  };

  const getAiReminders = async () => {
    if (deadlines.length === 0) return;
    setIsGeneratingTips(true);
    try {
      const tips = await generateReminders(deadlines);
      setAiTips(tips);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingTips(false);
    }
  };

  // Helper to extract probability if AI formats it clearly
  const extractProbability = (text: string) => {
    const match = text.match(/(\d+)%/);
    return match ? match[1] : null;
  };

  const probability = result ? extractProbability(result.content) : null;

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadForm.name || !leadForm.email) return;
    setIsSubmittingLead(true);
    try {
      await addDoc(collection(db, 'leads'), {
        name: leadForm.name,
        email: leadForm.email,
        createdAt: serverTimestamp()
      });
      setLeadForm({ name: '', email: '' });
      alert("Thank you! We'll be in touch shortly.");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'leads');
    } finally {
      setIsSubmittingLead(false);
    }
  };

  const deleteLead = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'leads', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `leads/${id}`);
    }
  };

  const handleChat = async (e?: React.FormEvent, overrideMessage?: string) => {
    if (e) e.preventDefault();
    const message = overrideMessage || chatInput;
    if (!message.trim() || isChatLoading) return;

    const userMessage = message.trim();
    if (!overrideMessage) setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsChatLoading(true);
    setIsChatOpen(true);

    try {
      const history = chatMessages.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }]
      }));
      const response = await chatWithAssistant(userMessage, history);
      setChatMessages(prev => [...prev, { role: 'model', content: response }]);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'model', content: "I'm sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  if (isLandingPage) {
    return (
      <div className="min-h-screen bg-white text-[#1A1A1A] font-sans selection:bg-[#E5E5E5]">
        {/* Navigation */}
        <nav className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#1A1A1A] rounded-lg flex items-center justify-center">
              <Scale className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Action Jaxson</h1>
          </div>
          <div className="flex items-center gap-8">
            {user ? (
              <button onClick={() => setIsLandingPage(false)} className="text-sm font-medium hover:text-[#9E9E9E] transition-colors">Go to App</button>
            ) : (
              <button onClick={handleLogin} className="text-sm font-medium hover:text-[#9E9E9E] transition-colors">Sign In</button>
            )}
            <button onClick={handleLogin} className="px-6 py-2.5 bg-[#1A1A1A] text-white rounded-full text-sm font-semibold hover:bg-[#333] transition-all">Get Started</button>
          </div>
        </nav>

        {/* Hero Section - SaaS Split Layout */}
        <main className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 py-20 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#F5F5F5] rounded-full text-[10px] font-bold uppercase tracking-widest mb-6">
              <TrendingUp className="w-3 h-3" />
              The Only AI with Win Probability
            </div>
            <h2 className="text-6xl lg:text-7xl font-light tracking-tighter leading-[0.9] mb-8">
              Navigate your case with <span className="italic font-serif">statistical</span> precision.
            </h2>
            <p className="text-[#9E9E9E] text-xl leading-relaxed mb-10 max-w-lg">
              The first AI-powered legal assistant that scans global court databases and calculates your statistical outcome probability based on historical data.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 items-center">
              <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                <div className="flex-1">
                  <input 
                    type="text" 
                    placeholder="Search Case or Name..." 
                    required
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl focus:ring-2 focus:ring-[#1A1A1A] outline-none text-sm"
                  />
                </div>
                <button 
                  type="submit"
                  onClick={() => setIsLandingPage(false)}
                  className="px-8 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold hover:bg-[#333] transition-all flex items-center justify-center gap-2 h-fit"
                >
                  Search
                  <Search className="w-4 h-4" />
                </button>
              </form>
            </div>
            <p className="text-[10px] text-[#9E9E9E] mt-4 uppercase tracking-widest font-bold">Join 2,400+ users navigating their cases today</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            {/* Visual Representation of the App's Unique Feature */}
            <div className="bg-[#F5F5F5] rounded-[3rem] p-12 aspect-square flex flex-col justify-center relative overflow-hidden">
              <div className="absolute top-0 right-0 p-12 opacity-5">
                <Scale className="w-64 h-64" />
              </div>
              
              <div className="relative z-10 space-y-8">
                <div className="bg-white p-8 rounded-3xl shadow-xl border border-[#E5E5E5] transform -rotate-3 max-w-xs">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-[#1A1A1A] text-white rounded-full flex items-center justify-center">
                      <BarChart3 className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-widest">Outcome Probability</span>
                  </div>
                  <div className="text-5xl font-light mb-2">78%</div>
                  <div className="w-full h-2 bg-[#F5F5F5] rounded-full overflow-hidden">
                    <div className="w-[78%] h-full bg-[#1A1A1A]" />
                  </div>
                  <p className="text-[10px] text-[#9E9E9E] mt-4 leading-relaxed">Based on 12,400+ similar civil cases in the California Superior Court.</p>
                </div>

                <div className="bg-white p-8 rounded-3xl shadow-xl border border-[#E5E5E5] transform rotate-3 translate-x-12 max-w-xs">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-[#1A1A1A] text-white rounded-full flex items-center justify-center">
                      <Database className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-widest">Global Search</span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 w-full bg-[#F5F5F5] rounded-full" />
                    <div className="h-2 w-3/4 bg-[#F5F5F5] rounded-full" />
                    <div className="h-2 w-1/2 bg-[#F5F5F5] rounded-full" />
                  </div>
                  <p className="text-[10px] text-[#9E9E9E] mt-4 leading-relaxed">Scanning 50 states and federal databases in real-time.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </main>

        {/* Features Section */}
        <section className="bg-[#F5F5F5] py-24">
          <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-3 gap-12">
            <div className="space-y-4">
              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                <Search className="w-6 h-6" />
              </div>
              <h4 className="text-xl font-semibold">Global Court Search</h4>
              <p className="text-[#9E9E9E] text-sm leading-relaxed">Access records from local, state, and federal databases instantly. No more manual digging.</p>
            </div>
            <div className="space-y-4">
              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h4 className="text-xl font-semibold">Win Probability</h4>
              <p className="text-[#9E9E9E] text-sm leading-relaxed">Our proprietary AI analyzes historical outcomes to give you a statistical edge in your case.</p>
            </div>
            <div className="space-y-4">
              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h4 className="text-xl font-semibold">Procedural Guidance</h4>
              <p className="text-[#9E9E9E] text-sm leading-relaxed">Get a step-by-step action plan and checklist tailored to your specific case type and jurisdiction.</p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-[#E5E5E5] flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4" />
            <span className="text-sm font-semibold">Action Jaxson</span>
          </div>
          <p className="text-xs text-[#9E9E9E]">© 2026 Action Jaxson. All rights reserved. Not a law firm.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-[#E5E5E5]">
      {/* Header */}
      <header className="bg-white border-b border-[#E5E5E5] sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#1A1A1A] rounded-lg flex items-center justify-center">
              <Scale className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Action Jaxson</h1>
              <p className="text-[10px] uppercase tracking-widest text-[#9E9E9E] font-medium">Legal Guide AI</p>
            </div>
          </div>
          
            <nav className="flex items-center gap-1 bg-[#F5F5F5] p-1 rounded-full">
            <button 
              onClick={() => setActiveTab('guide')}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-medium transition-all",
                activeTab === 'guide' ? "bg-white shadow-sm text-[#1A1A1A]" : "text-[#9E9E9E] hover:text-[#1A1A1A]"
              )}
            >
              Case Guide
            </button>
            <button 
              onClick={() => setActiveTab('tracker')}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-medium transition-all",
                activeTab === 'tracker' ? "bg-white shadow-sm text-[#1A1A1A]" : "text-[#9E9E9E] hover:text-[#1A1A1A]"
              )}
            >
              Status Tracker
            </button>
            <button 
              onClick={() => setActiveTab('public-records')}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-medium transition-all",
                activeTab === 'public-records' ? "bg-white shadow-sm text-[#1A1A1A]" : "text-[#9E9E9E] hover:text-[#1A1A1A]"
              )}
            >
              Public Records
            </button>
            {isAdmin && (
              <button 
                onClick={() => setActiveTab('crm')}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-medium transition-all",
                  activeTab === 'crm' ? "bg-white shadow-sm text-[#1A1A1A]" : "text-[#9E9E9E] hover:text-[#1A1A1A]"
                )}
              >
                CRM
              </button>
            )}
          </nav>

          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-[#9E9E9E]">
            <button 
              onClick={() => setIsLandingPage(true)}
              className="hover:text-[#1A1A1A] transition-colors"
            >
              Landing Page
            </button>
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-xs text-[#1A1A1A] font-bold">{user.email}</span>
                <button 
                  onClick={handleLogout}
                  className="px-4 py-2 bg-[#F5F5F5] text-[#1A1A1A] rounded-full text-xs hover:bg-[#E5E5E5] transition-colors"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="px-4 py-2 bg-[#1A1A1A] text-white rounded-full text-xs hover:bg-[#333] transition-colors"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {activeTab === 'crm' && isAdmin ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-light tracking-tight mb-2">Lead Management</h2>
                <p className="text-[#9E9E9E] text-sm">Manage access requests from the landing page.</p>
              </div>
              <div className="px-4 py-2 bg-white rounded-xl text-xs font-bold uppercase tracking-widest border border-[#E5E5E5]">
                {leads.length} Total Leads
              </div>
            </div>

            <div className="bg-white rounded-[2rem] border border-[#E5E5E5] overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E5E5E5] bg-[#F5F5F5]/50">
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E]">Name</th>
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E]">Email</th>
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E]">Date</th>
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E5E5]">
                    {isLeadsLoading ? (
                      <tr>
                        <td colSpan={4} className="px-8 py-12 text-center">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#9E9E9E]" />
                        </td>
                      </tr>
                    ) : leads.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-8 py-12 text-center text-[#9E9E9E] text-sm">
                          No leads found.
                        </td>
                      </tr>
                    ) : (
                      leads.map((lead) => (
                        <tr key={lead.id} className="hover:bg-[#F5F5F5]/30 transition-colors">
                          <td className="px-8 py-4 font-medium">{lead.name}</td>
                          <td className="px-8 py-4 text-[#9E9E9E]">{lead.email}</td>
                          <td className="px-8 py-4 text-[#9E9E9E] text-xs">
                            {lead.createdAt?.toDate ? lead.createdAt.toDate().toLocaleDateString() : 'Pending...'}
                          </td>
                          <td className="px-8 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <a 
                                href={`mailto:${lead.email}`}
                                className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors text-[#1A1A1A]"
                              >
                                <Mail className="w-4 h-4" />
                              </a>
                              <button 
                                onClick={() => deleteLead(lead.id)}
                                className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors text-red-500"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : activeTab === 'public-records' ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-light tracking-tight mb-2">Public Records Search</h2>
                <p className="text-[#9E9E9E] text-sm">Access legal datasets and public records from Data.gov.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="px-4 py-2 bg-white rounded-xl text-xs font-bold uppercase tracking-widest border border-[#E5E5E5] flex items-center gap-2">
                  <Database className="w-3 h-3" />
                  {dataGovResults.length} Datasets Found
                </div>
              </div>
            </div>

            <div className="bg-white p-2 rounded-[2rem] shadow-sm border border-[#E5E5E5] flex items-center gap-2 max-w-2xl">
              <div className="flex-1 flex items-center gap-3 px-4">
                <Search className="w-5 h-5 text-[#9E9E9E]" />
                <input 
                  type="text"
                  placeholder="Search legal datasets (e.g., 'court cases', 'legal aid')..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDataGovSearch(searchQuery)}
                  className="w-full py-3 text-sm bg-transparent border-none outline-none placeholder:text-[#CBCBCB]"
                />
              </div>
              <button 
                onClick={() => handleDataGovSearch(searchQuery)}
                disabled={isDataGovLoading || !searchQuery.trim()}
                className="px-6 py-3 bg-[#1A1A1A] text-white rounded-[1.2rem] text-xs font-bold hover:bg-[#333] transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isDataGovLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
              </button>
            </div>

            <div className="grid gap-6">
              {isDataGovLoading ? (
                <div className="py-20 text-center">
                  <Loader2 className="w-10 h-10 animate-spin mx-auto text-[#1A1A1A] mb-4" />
                  <p className="text-[#9E9E9E]">Searching Data.gov archives...</p>
                </div>
              ) : dataGovResults.length === 0 ? (
                <div className="bg-white p-12 rounded-3xl border border-dashed border-[#E5E5E5] text-center">
                  <Database className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
                  <p className="text-[#9E9E9E] text-sm">No datasets found. Try searching for "court", "legal", or "justice".</p>
                </div>
              ) : (
                dataGovResults.map((dataset) => (
                  <motion.div
                    key={dataset.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-white p-8 rounded-[2rem] border border-[#E5E5E5] hover:shadow-md transition-all group"
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                      <div className="space-y-4 flex-1">
                        <div className="flex items-center gap-3">
                          <div className="px-2 py-1 bg-[#F5F5F5] rounded text-[8px] font-bold uppercase tracking-widest text-[#9E9E9E]">
                            {dataset.organization?.title || 'Public Dataset'}
                          </div>
                          <div className="px-2 py-1 bg-green-50 text-green-600 rounded text-[8px] font-bold uppercase tracking-widest">
                            {dataset.license_title || 'Open Data'}
                          </div>
                        </div>
                        <h3 className="text-xl font-medium group-hover:text-[#1A1A1A] transition-colors">{dataset.title}</h3>
                        <p className="text-sm text-[#9E9E9E] leading-relaxed line-clamp-3">
                          {dataset.notes || 'No description available for this dataset.'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {dataset.resources?.slice(0, 5).map((res: any) => (
                            <a
                              key={res.id}
                              href={res.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1 bg-[#F5F5F5] hover:bg-[#E5E5E5] rounded-full text-[10px] font-medium transition-colors flex items-center gap-1"
                            >
                              <FileText className="w-3 h-3" />
                              {res.format || 'Link'}
                            </a>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <a
                          href={`https://catalog.data.gov/dataset/${dataset.name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-6 py-2.5 bg-[#1A1A1A] text-white rounded-full text-xs font-bold hover:bg-[#333] transition-all text-center"
                        >
                          View on Data.gov
                        </a>
                        <button className="px-6 py-2.5 border border-[#E5E5E5] text-[#9E9E9E] rounded-full text-xs font-bold hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-all">
                          Save to Case
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        ) : activeTab === 'tracker' ? (
          <div className="space-y-8">
            {/* Tracker Content */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-light tracking-tight mb-2">Status Tracker</h2>
                <p className="text-[#9E9E9E] text-sm">Manage your case deadlines and get AI-powered tips.</p>
              </div>
              <button 
                onClick={getAiReminders}
                disabled={isGeneratingTips || deadlines.length === 0}
                className="px-6 py-2.5 bg-[#1A1A1A] text-white rounded-full text-sm font-semibold hover:bg-[#333] transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isGeneratingTips ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                Get AI Tips
              </button>
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
              {/* Add Deadline Form */}
              <div className="lg:col-span-1">
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#E5E5E5]">
                  <h3 className="font-medium mb-6 flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Add Deadline
                  </h3>
                  <form onSubmit={addDeadline} className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E] mb-2 block">Title</label>
                      <input 
                        type="text" 
                        placeholder="e.g., File Complaint"
                        value={newDeadline.title}
                        onChange={(e) => setNewDeadline({ ...newDeadline, title: e.target.value })}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl focus:ring-2 focus:ring-[#1A1A1A] outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E] mb-2 block">Date</label>
                      <input 
                        type="date" 
                        value={newDeadline.date}
                        onChange={(e) => setNewDeadline({ ...newDeadline, date: e.target.value })}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl focus:ring-2 focus:ring-[#1A1A1A] outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E] mb-2 block">Notes</label>
                      <textarea 
                        placeholder="Additional details..."
                        value={newDeadline.description}
                        onChange={(e) => setNewDeadline({ ...newDeadline, description: e.target.value })}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl focus:ring-2 focus:ring-[#1A1A1A] outline-none text-sm min-h-[100px] resize-none"
                      />
                    </div>
                    <button className="w-full py-3 bg-[#1A1A1A] text-white rounded-xl font-medium hover:bg-[#333] transition-all">
                      Save Deadline
                    </button>
                  </form>
                </div>
              </div>

              {/* Deadlines List */}
              <div className="lg:col-span-2 space-y-4">
                <AnimatePresence mode="popLayout">
                  {deadlines.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="bg-white p-12 rounded-3xl border border-dashed border-[#E5E5E5] text-center"
                    >
                      <Calendar className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
                      <p className="text-[#9E9E9E] text-sm">No deadlines added yet. Start by adding your first one.</p>
                    </motion.div>
                  ) : (
                    deadlines.map((d) => (
                      <motion.div
                        key={d.id}
                        layout
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white p-6 rounded-3xl border border-[#E5E5E5] flex items-start justify-between group"
                      >
                        <div className="flex gap-4">
                          <div className="w-10 h-10 bg-[#F5F5F5] rounded-full flex items-center justify-center shrink-0">
                            <Calendar className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="font-medium mb-1">{d.title}</h4>
                            <div className="flex items-center gap-2 text-xs text-[#9E9E9E] mb-2">
                              <Info className="w-3 h-3" />
                              {new Date(d.date).toLocaleDateString()}
                            </div>
                            {d.description && <p className="text-sm text-[#9E9E9E] leading-relaxed">{d.description}</p>}
                          </div>
                        </div>
                        <button 
                          onClick={() => removeDeadline(d.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>

                {aiTips && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-[#1A1A1A] text-white p-8 rounded-3xl"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <TrendingUp className="w-5 h-5 text-[#9E9E9E]" />
                      <h3 className="font-medium">AI Procedural Strategy</h3>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none prose-p:text-[#9E9E9E] prose-p:leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiTips}</ReactMarkdown>
                    </div>
                    <div className="mt-8 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="text-center sm:text-left">
                        <h4 className="text-sm font-semibold mb-1">Need Professional Strategy?</h4>
                        <p className="text-xs text-[#9E9E9E]">A legal professional can help you execute these tips effectively.</p>
                      </div>
                      <button className="px-6 py-2 bg-white text-[#1A1A1A] rounded-full text-xs font-bold hover:bg-opacity-90 transition-all flex items-center gap-2 shrink-0">
                        Consult Legal Pro
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Universal Search & AI Section */}
            <section className="mb-16 max-w-3xl mx-auto">
              <div className="text-center mb-10">
                <motion.h2 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-4xl md:text-5xl font-light tracking-tight mb-4"
                >
                  How can <span className="italic font-serif">Jaxson</span> help today?
                </motion.h2>
                <p className="text-[#9E9E9E] text-sm">Search cases, analyze documents, or ask a legal procedure question.</p>
              </div>

              <div className="flex justify-center mb-6">
                <div className="bg-[#F5F5F5] p-1 rounded-2xl flex gap-1">
                  <button 
                    onClick={() => setSearchMode('universal')}
                    className={cn(
                      "px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                      searchMode === 'universal' ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#9E9E9E] hover:text-[#1A1A1A]"
                    )}
                  >
                    Universal Search
                  </button>
                  <button 
                    onClick={() => setSearchMode('individual')}
                    className={cn(
                      "px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                      searchMode === 'individual' ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#9E9E9E] hover:text-[#1A1A1A]"
                    )}
                  >
                    Individual Search
                  </button>
                </div>
              </div>

              {searchMode === 'universal' ? (
                <div className="bg-white p-2 rounded-[2rem] shadow-xl border border-[#E5E5E5] flex flex-col md:flex-row items-center gap-2">
                  <div className="flex-1 flex items-center gap-3 px-4 w-full">
                    <Search className="w-5 h-5 text-[#9E9E9E]" />
                    <input 
                      type="text"
                      placeholder="Search cases, ask a question, or find records..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUniversalSearch()}
                      className="w-full py-4 text-lg bg-transparent border-none outline-none placeholder:text-[#CBCBCB]"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full md:w-auto px-2 md:px-0">
                    <input 
                      type="text"
                      placeholder="Jurisdiction (e.g., CA, NY, Federal)"
                      value={jurisdiction}
                      onChange={(e) => setJurisdiction(e.target.value)}
                      className="px-4 py-4 bg-[#F5F5F5] border-none rounded-[1.5rem] text-sm outline-none focus:ring-2 focus:ring-[#1A1A1A] w-full md:w-48"
                    />
                    <select 
                      value={selectedCaseType}
                      onChange={(e) => setSelectedCaseType(e.target.value)}
                      className="px-4 py-4 bg-[#F5F5F5] border-none rounded-[1.5rem] text-sm outline-none focus:ring-2 focus:ring-[#1A1A1A] w-full md:w-40"
                    >
                      <option value="">All Case Types</option>
                      <option value="civil">Civil</option>
                      <option value="criminal">Criminal</option>
                      <option value="family">Family</option>
                      <option value="probate">Probate</option>
                      <option value="traffic">Traffic</option>
                      <option value="small-claims">Small Claims</option>
                    </select>
                    <button 
                      onClick={() => handleUniversalSearch()}
                      disabled={isSearching || !searchQuery.trim()}
                      className="px-8 py-4 bg-[#1A1A1A] text-white rounded-[1.5rem] font-bold hover:bg-[#333] transition-all flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap flex-1 md:flex-none"
                    >
                      {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Ask Jaxson'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-[#E5E5E5] space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-[#9E9E9E] px-2">First Name</label>
                      <input 
                        type="text"
                        placeholder="e.g., John"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleIndividualSearch()}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1A1A1A]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-[#9E9E9E] px-2">Middle Name</label>
                      <input 
                        type="text"
                        placeholder="Optional"
                        value={middleName}
                        onChange={(e) => setMiddleName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleIndividualSearch()}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1A1A1A]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-[#9E9E9E] px-2">Last Name</label>
                      <input 
                        type="text"
                        placeholder="e.g., Doe"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleIndividualSearch()}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1A1A1A]"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-[#9E9E9E] px-2">Date of Birth</label>
                      <input 
                        type="date"
                        value={dob}
                        onChange={(e) => setDob(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleIndividualSearch()}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1A1A1A]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-[#9E9E9E] px-2">Jurisdiction</label>
                      <input 
                        type="text"
                        placeholder="e.g., CA, NY, Federal"
                        value={jurisdiction}
                        onChange={(e) => setJurisdiction(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleIndividualSearch()}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1A1A1A]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-[#9E9E9E] px-2">Case Type</label>
                      <select 
                        value={selectedCaseType}
                        onChange={(e) => setSelectedCaseType(e.target.value)}
                        className="w-full px-4 py-3 bg-[#F5F5F5] border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1A1A1A]"
                      >
                        <option value="">All Case Types</option>
                        <option value="civil">Civil</option>
                        <option value="criminal">Criminal</option>
                        <option value="family">Family</option>
                        <option value="probate">Probate</option>
                        <option value="traffic">Traffic</option>
                        <option value="small-claims">Small Claims</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row justify-center gap-4 pt-4">
                    <button 
                      onClick={() => handleIndividualSearch()}
                      disabled={isSearching || !firstName.trim() || !lastName.trim()}
                      className="px-12 py-4 bg-[#1A1A1A] text-white rounded-2xl font-bold hover:bg-[#333] transition-all flex items-center justify-center gap-3 disabled:opacity-50 w-full md:w-auto"
                    >
                      {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                        <>
                          <Search className="w-5 h-5" />
                          Search Individual Records
                        </>
                      )}
                    </button>
                    <button 
                      onClick={() => handleDataGovSearch(`${firstName} ${lastName} court records`)}
                      disabled={isSearching || !firstName.trim() || !lastName.trim()}
                      className="px-8 py-4 bg-white border-2 border-[#1A1A1A] text-[#1A1A1A] rounded-2xl font-bold hover:bg-[#F5F5F5] transition-all flex items-center justify-center gap-3 disabled:opacity-50 w-full md:w-auto"
                    >
                      <Database className="w-5 h-5" />
                      Search Open Data (Data.gov)
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-center gap-2 mt-4 mb-2">
                <p className="text-[10px] text-[#9E9E9E] uppercase tracking-widest font-bold">Tip: Add a jurisdiction (e.g., "Los Angeles") for better person/case searches</p>
              </div>

              <div className="flex flex-wrap justify-center gap-2 mt-2">
                {['How do I file a civil complaint?', 'Find cases related to tenant rights', 'What is a summons?', 'Calculate my win probability'].map((q) => (
                  <button 
                    key={q}
                    onClick={() => {
                      setSearchQuery(q);
                      handleChat(undefined, q);
                    }}
                    className="px-4 py-2 bg-white border border-[#E5E5E5] rounded-full text-xs text-[#9E9E9E] hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </section>

            {/* Action Controls */}
            <div className="grid md:grid-cols-2 gap-8 mb-12">
              {/* Upload Card */}
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#E5E5E5] hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 bg-[#F5F5F5] rounded-full flex items-center justify-center">
                    <Upload className="w-4 h-4 text-[#1A1A1A]" />
                  </div>
                  <h3 className="font-medium">Analyze Paperwork</h3>
                </div>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[#E5E5E5] rounded-2xl p-8 text-center cursor-pointer hover:border-[#1A1A1A] transition-colors group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".pdf,image/*"
                  />
                  {isUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-[#1A1A1A]" />
                      <p className="text-sm text-[#9E9E9E]">Analyzing document...</p>
                    </div>
                  ) : (
                    <>
                      <FileText className="w-8 h-8 text-[#9E9E9E] mx-auto mb-3 group-hover:text-[#1A1A1A] transition-colors" />
                      <p className="text-sm font-medium">Click to upload PDF or Image</p>
                      <p className="text-xs text-[#9E9E9E] mt-1">Court notices, summons, or filings</p>
                    </>
                  )}
                </div>
              </div>

              {/* AI Assistant Card */}
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#E5E5E5] hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 bg-[#F5F5F5] rounded-full flex items-center justify-center">
                    <MessageCircle className="w-4 h-4 text-[#1A1A1A]" />
                  </div>
                  <h3 className="font-medium">Ask Assistant</h3>
                </div>
                <p className="text-xs text-[#9E9E9E] mb-6 leading-relaxed">
                  Have a specific question about legal procedures, case law, or finding records? Ask Action Jaxson anything.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => setIsChatOpen(true)}
                    className="w-full py-3 bg-[#F5F5F5] text-[#1A1A1A] rounded-xl font-medium hover:bg-[#E5E5E5] transition-all flex items-center justify-center gap-2"
                  >
                    Open AI Chat
                  </button>
                  <button
                    onClick={() => handleChat(undefined, "How do I find my case number?")}
                    className="w-full py-3 border border-[#E5E5E5] text-[#9E9E9E] rounded-xl text-xs font-medium hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-all"
                  >
                    "How do I find my case number?"
                  </button>
                </div>
              </div>
            </div>

            {/* Results Area */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-600 mb-8"
                >
                  <AlertCircle className="w-5 h-5" />
                  <p className="text-sm font-medium">{error}</p>
                </motion.div>
              )}

              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8 relative"
                >
                  {/* Probability Header */}
                  {probability && (
                    <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#E5E5E5] flex flex-col md:flex-row items-center gap-8">
                      <div className="relative w-32 h-32 flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle
                            cx="64"
                            cy="64"
                            r="58"
                            stroke="currentColor"
                            strokeWidth="8"
                            fill="transparent"
                            className="text-[#F5F5F5]"
                          />
                          <circle
                            cx="64"
                            cy="64"
                            r="58"
                            stroke="currentColor"
                            strokeWidth="8"
                            fill="transparent"
                            strokeDasharray={364.4}
                            strokeDashoffset={364.4 - (364.4 * parseInt(probability)) / 100}
                            className="text-[#1A1A1A] transition-all duration-1000 ease-out"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-3xl font-light tracking-tight">{probability}%</span>
                          <span className="text-[8px] uppercase tracking-widest font-bold text-[#9E9E9E]">Win Chance</span>
                        </div>
                      </div>
                      <div className="flex-1 text-center md:text-left">
                        <h4 className="text-lg font-medium mb-2 flex items-center justify-center md:justify-start gap-2">
                          <TrendingUp className="w-5 h-5" />
                          Statistical Outcome Probability
                        </h4>
                        <p className="text-sm text-[#9E9E9E] leading-relaxed">
                          Based on historical data from similar cases in open research datasets, your estimated success probability is <span className="text-[#1A1A1A] font-semibold">{probability}%</span>. This score considers jurisdiction, case type, and procedural history.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="bg-white rounded-3xl shadow-sm border border-[#E5E5E5] overflow-hidden">
                    <div className="p-8 border-b border-[#F5F5F5] flex items-center justify-between bg-[#FAFAFA]">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center">
                          {result.type === 'search' ? <Search className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                        </div>
                        <div>
                          <h4 className="font-semibold">Case Analysis Report</h4>
                          <p className="text-xs text-[#9E9E9E]">Generated by Action Jaxson AI</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => handleDataGovSearch(searchQuery)}
                          className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white border border-[#E5E5E5] rounded-xl text-xs font-bold hover:border-[#1A1A1A] transition-all"
                        >
                          <Database className="w-3 h-3" />
                          Search Public Records
                        </button>
                        <div className="flex items-center gap-2 text-xs font-medium text-[#4CAF50] bg-green-50 px-3 py-1 rounded-full">
                          <CheckCircle className="w-3 h-3" />
                          Complete
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-8 prose prose-sm max-w-none prose-headings:font-semibold prose-p:text-[#4A4A4A] prose-p:leading-relaxed">
                      <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({node, ...props}) => <h1 className="text-2xl mb-4" {...props} />,
                        h2: ({node, ...props}) => <h2 className="text-xl mt-8 mb-4 border-b pb-2" {...props} />,
                        h3: ({node, ...props}) => <h3 className="text-lg mt-6 mb-2" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-none space-y-3 pl-0" {...props} />,
                        li: ({node, ...props}) => (
                          <li className="flex items-start gap-3 p-3 bg-[#F9F9F9] rounded-xl border border-[#EEE]" {...props}>
                            <ChevronRight className="w-4 h-4 mt-1 text-[#1A1A1A] flex-shrink-0" />
                            <span className="text-sm">{props.children}</span>
                          </li>
                        ),
                        p: ({node, ...props}) => <p className="mb-4" {...props} />,
                        a: ({node, ...props}) => <a className="text-[#1A1A1A] underline font-medium hover:opacity-70 transition-opacity" target="_blank" rel="noopener noreferrer" {...props} />,
                      }}
                    >
                      {result.content}
                    </ReactMarkdown>

                    <div className="mt-12 p-8 bg-[#F9F9F9] rounded-3xl border border-[#E5E5E5] text-center">
                      <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-4">
                        <Gavel className="w-6 h-6 text-[#1A1A1A]" />
                      </div>
                      <h4 className="text-lg font-semibold mb-2">Need Personalized Legal Advice?</h4>
                      <p className="text-sm text-[#9E9E9E] mb-6 max-w-sm mx-auto">
                        While Action Jaxson provides procedural guidance, a licensed attorney can provide specific legal strategy for your unique situation.
                      </p>
                      <button className="px-8 py-3 bg-[#1A1A1A] text-white rounded-full text-sm font-medium hover:bg-[#333] transition-all flex items-center gap-2 mx-auto">
                        Consult a Legal Professional
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    </div>

                    <div className="bg-[#F5F5F5] p-6 border-t border-[#E5E5E5] flex items-start gap-4">
                      <Info className="w-5 h-5 text-[#9E9E9E] mt-0.5" />
                      <p className="text-xs text-[#9E9E9E] leading-relaxed">
                        <strong>Disclaimer:</strong> Action Jaxson is an AI-powered guide and does not provide legal advice. The information provided is based on available databases and document analysis. Please consult with a qualified legal professional for your specific situation.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Empty State / Guide */}
            {!result && !isSearching && !isUploading && (
              <section className="grid md:grid-cols-3 gap-6 mt-12">
                <div className="p-6 bg-white rounded-2xl border border-[#E5E5E5]">
                  <h4 className="font-medium text-sm mb-2">1. Search</h4>
                  <p className="text-xs text-[#9E9E9E]">Enter a name or case number to scan state and federal databases.</p>
                </div>
                <div className="p-6 bg-white rounded-2xl border border-[#E5E5E5]">
                  <h4 className="font-medium text-sm mb-2">2. Analyze</h4>
                  <p className="text-xs text-[#9E9E9E]">Upload any court documents for instant AI extraction and summary.</p>
                </div>
                <div className="p-6 bg-white rounded-2xl border border-[#E5E5E5]">
                  <h4 className="font-medium text-sm mb-2">3. Act</h4>
                  <p className="text-xs text-[#9E9E9E]">Follow the generated checklist and action plan to stay on track.</p>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-[#E5E5E5] mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4" />
            <span className="text-sm font-semibold">Action Jaxson</span>
          </div>
          <p className="text-xs text-[#9E9E9E]">© 2026 Action Jaxson. All rights reserved.</p>
          <div className="flex gap-4 text-xs font-medium text-[#9E9E9E]">
            <a href="#" className="hover:text-[#1A1A1A]">Privacy</a>
            <a href="#" className="hover:text-[#1A1A1A]">Terms</a>
            <a href="#" className="hover:text-[#1A1A1A]">Contact</a>
          </div>
        </div>
      </footer>

      {/* AI Assistant Floating UI */}
      <div className="fixed bottom-8 right-8 z-50">
        <AnimatePresence>
          {isChatOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="absolute bottom-20 right-0 w-[400px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-10rem)] bg-white rounded-[2.5rem] shadow-2xl border border-[#E5E5E5] flex flex-col overflow-hidden"
            >
              {/* Chat Header */}
              <div className="p-6 bg-[#1A1A1A] text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                    <Scale className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">Action Jaxson</h4>
                    <p className="text-[10px] text-[#9E9E9E] uppercase tracking-widest">AI Assistant</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsChatOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {chatMessages.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-[#F5F5F5] rounded-full flex items-center justify-center mx-auto mb-4">
                      <MessageCircle className="w-8 h-8 text-[#9E9E9E]" />
                    </div>
                    <h5 className="font-medium mb-2">How can I help you?</h5>
                    <p className="text-xs text-[#9E9E9E] max-w-[200px] mx-auto">Ask me about case procedures, finding records, or understanding your documents.</p>
                  </div>
                )}
                {chatMessages.map((msg, idx) => (
                  <div 
                    key={idx}
                    className={cn(
                      "flex",
                      msg.role === 'user' ? "justify-end" : "justify-start"
                    )}
                  >
                    <div 
                      className={cn(
                        "max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed",
                        msg.role === 'user' 
                          ? "bg-[#1A1A1A] text-white rounded-tr-none" 
                          : "bg-[#F5F5F5] text-[#1A1A1A] rounded-tl-none"
                      )}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-[#F5F5F5] p-4 rounded-2xl rounded-tl-none">
                      <Loader2 className="w-4 h-4 animate-spin text-[#9E9E9E]" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <form onSubmit={handleChat} className="p-6 border-t border-[#E5E5E5] bg-white">
                <div className="flex items-center gap-2">
                  <input 
                    type="text"
                    placeholder="Ask a question..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 px-4 py-3 bg-[#F5F5F5] border-none rounded-xl focus:ring-2 focus:ring-[#1A1A1A] outline-none text-sm"
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim() || isChatLoading}
                    className="w-11 h-11 bg-[#1A1A1A] text-white rounded-xl flex items-center justify-center hover:bg-[#333] transition-all disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[8px] text-[#9E9E9E] mt-3 text-center uppercase tracking-widest font-bold">AI Guide • Not Legal Advice</p>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <button 
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="w-16 h-16 bg-[#1A1A1A] text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all group"
        >
          {isChatOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6 group-hover:scale-110 transition-transform" />}
        </button>
      </div>
    </div>
  );
}
