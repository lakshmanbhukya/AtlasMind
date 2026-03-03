import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, ChevronRight, ChevronDown, Table, Key, Type, Search } from 'lucide-react';

const SchemaExplorerPanel = ({ schema, isOpen, onClose }) => {
    const [expandedNodes, setExpandedNodes] = useState({});
    const [searchTerm, setSearchTerm] = useState('');

    const toggleNode = (nodeName) => {
        setExpandedNodes(prev => ({
            ...prev,
            [nodeName]: !prev[nodeName]
        }));
    };

    const filterSchema = (collections) => {
        if (!searchTerm) return collections;
        return collections.filter(coll =>
            coll.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            coll.fields.some(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ x: -300, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -300, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="fixed left-0 top-0 bottom-0 w-80 bg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl z-40 flex flex-col pt-16"
                >
                    <div className="p-4 border-b border-white/5 relative">
                        <button
                            onClick={onClose}
                            className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                            <ChevronRight size={20} className="rotate-180" />
                        </button>
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            <Database size={20} className="text-blue-400" />
                            Data Schema
                        </h2>
                        <div className="mt-4 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <input
                                type="text"
                                placeholder="Search collections..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-gray-800/50 border border-white/10 rounded-lg py-2 pl-9 pr-3 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-gray-700">
                        {filterSchema(schema?.collections || []).map((collection) => (
                            <div key={collection.name} className="mb-2">
                                <button
                                    onClick={() => toggleNode(collection.name)}
                                    className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/5 text-gray-300 transition-colors group"
                                >
                                    <div className="flex items-center gap-2">
                                        {expandedNodes[collection.name] ? (
                                            <ChevronDown size={14} className="text-gray-500" />
                                        ) : (
                                            <ChevronRight size={14} className="text-gray-500" />
                                        )}
                                        <Table size={16} className="text-emerald-500/80" />
                                        <span className="font-medium group-hover:text-emerald-400 transition-colors">
                                            {collection.name}
                                        </span>
                                    </div>
                                    <span className="text-xs text-gray-600 bg-gray-800/50 px-2 py-0.5 rounded-full">
                                        {collection.documentCount || 0}
                                    </span>
                                </button>

                                <AnimatePresence>
                                    {expandedNodes[collection.name] && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="ml-6 pl-2 border-l border-white/5 overflow-hidden"
                                        >
                                            {collection.fields.map((field) => (
                                                <div key={field.name} className="flex items-center justify-between py-1.5 px-2 hover:bg-white/5 rounded text-sm text-gray-400">
                                                    <div className="flex items-center gap-2">
                                                        <Key size={12} className="text-amber-500/70" />
                                                        <span>{field.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 opacity-60">
                                                        <Type size={10} />
                                                        <span className="text-xs italic">{field.type}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        ))}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default SchemaExplorerPanel;
