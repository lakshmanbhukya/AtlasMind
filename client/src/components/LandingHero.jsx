import React, { useState } from 'react';
import { Database, CheckCircle2, ChevronRight, Lock, Server } from 'lucide-react';
import api from '../services/api';

export default function LandingHero({ onConnected }) {
  const [connectionString, setConnectionString] = useState('');
  const [dbName, setDbName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!connectionString.trim() || !dbName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await api.post('/connections/connect', {
        connectionString,
        dbName,
        label: 'Production'
      });

      if (response.data && response.data.connectionId) {
        // Save the identity hash to localStorage
        localStorage.setItem('atlasmind_connection_id', response.data.connectionId);
        onConnected();
      } else {
        throw new Error('No connectionId returned from server');
      }
    } catch (err) {
      setError(err.message || 'Failed to connect. Please check your connection string and database name.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col pt-20 px-4 md:px-0">
      
      {/* Premium Glass Decorators */}
      <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#00ed64] opacity-5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#001e2b] opacity-20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="max-w-4xl mx-auto w-full z-10 flex flex-col items-center text-center space-y-8 animate-atlas-fade-in">
        
        {/* Logo / Brand */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#00ed64] to-[#00684a] flex items-center justify-center shadow-lg shadow-[#00ed64]/20 border border-[#00ed64]/30">
            <Database className="text-[#001e2b] w-6 h-6" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Atlas<span className="text-[#00ed64]">Mind</span>
          </h1>
        </div>

        <h2 className="text-xl md:text-2xl text-muted-foreground font-light max-w-2xl leading-relaxed">
          The intelligence layer for your MongoDB Atlas cluster.
          Connect instantly to natural-language analytics.
        </h2>

        {/* Connection Card */}
        <div className="w-full max-w-md mt-10">
          <div className="backdrop-blur-xl bg-card/60 border border-border/50 shadow-2xl rounded-2xl p-8 relative overflow-hidden transition-all duration-500 hover:border-[#00ed64]/30 hover:shadow-[#00ed64]/5">
            <h3 className="text-lg font-medium text-foreground mb-6 flex items-center">
              <Server className="w-5 h-5 mr-2 text-[#00ed64]" />
              Connect your cluster
            </h3>
            
            <form onSubmit={handleConnect} className="space-y-4 text-left">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  MongoDB URI
                </label>
                <div className="relative group">
                  <input
                    type="password"
                    placeholder="mongodb+srv://..."
                    value={connectionString}
                    onChange={(e) => setConnectionString(e.target.value)}
                    className="w-full bg-background border border-border/50 text-foreground text-sm rounded-lg px-4 py-3 focus:outline-none focus:ring-1 focus:ring-[#00ed64] transition-all"
                    required
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-[#00ed64]">
                    <Lock className="w-4 h-4" />
                  </div>
                </div>
              </div>

              <div className="space-y-2 pb-4">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Database Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. production_db"
                  value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                  className="w-full bg-background border border-border/50 text-foreground text-sm rounded-lg px-4 py-3 focus:outline-none focus:ring-1 focus:ring-[#00ed64] transition-all"
                  required
                />
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg p-3">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !connectionString || !dbName}
                className="w-full relative group overflow-hidden bg-foreground text-background font-medium h-12 rounded-lg flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#00ed64]"
              >
                {loading ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                    <span>Connecting...</span>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <span>Jump to Playground</span>
                    <ChevronRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                )}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-border/50 text-xs text-muted-foreground text-center space-y-2">
              <p className="flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 mr-1 text-[#00ed64]" /> 
                End-to-end AES-256 encrypted
              </p>
              <p>AtlasMind does not log your credentials.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
