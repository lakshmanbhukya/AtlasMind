import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import InsightDashboard from '../components/InsightDashboard';
import { fetchSharedDashboardPin } from '../services/api';
import { Database, Loader2 } from 'lucide-react';

export default function SharedDashboardPage() {
    const { id } = useParams();
    const [pin, setPin] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function loadPin() {
            try {
                const response = await fetchSharedDashboardPin(id);
                setPin(response.data);
            } catch (err) {
                console.error("Failed to fetch shared pin:", err);
                setError(err.response?.data?.error?.message || "Failed to load shared dashboard.");
            } finally {
                setLoading(false);
            }
        }
        if (id) {
            loadPin();
        }
    }, [id]);

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-[#0a0e14]">
                <div className="flex flex-col items-center gap-4 text-blue-500">
                    <Loader2 size={32} className="animate-spin" />
                    <p className="text-sm text-gray-400">Loading shared dashboard...</p>
                </div>
            </div>
        );
    }

    if (error || !pin) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-[#0a0e14]">
                <div className="bg-[#151b24] border border-[#2d3748] rounded-lg p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Database size={24} />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">Dashboard Not Found</h2>
                    <p className="text-gray-400 text-sm mb-6">
                        {error || "This dashboard widget might have been deleted or is no longer shared."}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0e14] text-white flex flex-col p-4 md:p-8 grid-bg-dashboard">
            <header className="mb-6 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
                    <Database size={16} className="text-white" />
                </div>
                <div>
                    <h1 className="text-lg font-bold">AtlasMind Shared View</h1>
                    <p className="text-xs text-gray-400">Public Dashboard Widget</p>
                </div>
            </header>
            
            <main className="flex-1 max-w-5xl w-full mx-auto flex flex-col">
                <InsightDashboard
                    data={pin.results}
                    type={pin.chartType || 'bar'}
                    title={pin.name || pin.query || 'Shared Visualization'}
                    pinId={pin._id || id}
                    hideActions={true} // We don't want to allow re-sharing or downloading if we want to restrict, but maybe download is fine.
                />
            </main>
        </div>
    );
}
