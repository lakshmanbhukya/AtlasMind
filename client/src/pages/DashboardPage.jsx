import React from 'react';
import InsightDashboard from '../components/InsightDashboard';
import { LayoutDashboard, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function DashboardPage({ pins, onRemovePin }) {
    return (
        <div className="h-full overflow-y-auto p-6 md:p-8">
            <header className="mb-8 flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <LayoutDashboard size={24} className="text-blue-400" />
                        Dashboard
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">
                        Pinned queries and visualizations
                    </p>
                </div>
                <div className="bg-gray-800/50 px-3 py-1 rounded-full text-xs text-gray-400 border border-white/5">
                    {pins.length} items
                </div>
            </header>

            {pins.length === 0 ? (
                <div className="dashboard-empty">
                    <div className="dashboard-empty-icon">
                        <LayoutDashboard size={64} />
                    </div>
                    <h3>No pins yet</h3>
                    <p>
                        Ask questions in the chat and pin visualization results to see them here.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(480px,1fr))] gap-6">
                    <AnimatePresence>
                        {pins.map((pin) => (
                            <motion.div
                                key={pin.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                transition={{ duration: 0.2 }}
                                className="relative group"
                            >
                                <div className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => onRemovePin(pin.id)}
                                        className="w-8 h-8 flex items-center justify-center border border-[#2d3748] bg-[#0a0e14]/80 backdrop-blur rounded-[2px] text-[#94a3b8] hover:bg-[#1a2332] hover:border-[#ef4444] hover:text-[#ef4444] transition-all duration-150 shadow-lg"
                                        title="Remove pin"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                                <InsightDashboard
                                    data={pin.results}
                                    type={pin.chartType || 'bar'}
                                    title={pin.chartTitle || pin.queryText || 'Untitled'}
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}
