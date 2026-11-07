import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import { motion } from 'framer-motion';
import { TrendingUp, Download, Share2 } from 'lucide-react';
import { downloadCsv } from '../lib/csv';

// Verdigris: accent, clay, amber, text-2, accent-deep, red
const COLORS = ['#4FC79B', '#C98F5C', '#D4A961', '#A9B5AC', '#2A8467', '#DF6A57'];

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-[var(--vg-menu)] border border-vg-line p-3 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.65)] font-ui">
                <p className="text-vg-text-2 text-[12px] font-medium mb-1.5">{label}</p>
                {payload.map((entry, index) => (
                    <p key={index} className="text-sm" style={{ color: entry.color }}>
                        {entry.name}: <span className="font-code text-vg-text">{entry.value.toLocaleString()}</span>
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

const InsightDashboard = ({ data, type = 'bar', title, pinId, hideActions = false }) => {
    const [toastMsg, setToastMsg] = React.useState(null);

    if (!data || data.length === 0) return null;

    // Smart Key Detection
    const getChartKeys = (data) => {
        if (!data || data.length === 0) return { nameKey: 'name', valueKey: 'value' };
        const keys = Object.keys(data[0]);
        const nameKey = keys.find(k => ['name', 'date', 'category', 'timestamp', 'year', 'month', '_id'].includes(k.toLowerCase())) || keys.find(k => typeof data[0][k] === 'string') || keys[0];
        const valueKey = keys.find(k => ['value', 'count', 'revenue', 'total', 'amount', 'sales', 'profit'].includes(k.toLowerCase())) || keys.find(k => typeof data[0][k] === 'number') || keys[1];
        return { nameKey, valueKey };
    };

    const { nameKey, valueKey } = getChartKeys(data);

    const handleShare = () => {
        if (!pinId) {
            setToastMsg('Cannot share: pin ID is missing');
            setTimeout(() => setToastMsg(null), 3000);
            return;
        }
        const url = `${window.location.origin}/shared/${pinId}`;
        navigator.clipboard.writeText(url).then(() => {
            setToastMsg('Public link copied!');
            setTimeout(() => setToastMsg(null), 3000);
        }).catch(err => {
            if (import.meta.env.DEV) console.error('Failed to copy link', err);
            setToastMsg('Failed to copy link');
            setTimeout(() => setToastMsg(null), 3000);
        });
    };

    const handleDownload = () => {
        if (!data || data.length === 0) return;
        
        downloadCsv(data, `${(title || '').replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'export'}.csv`);

        setToastMsg('Data downloaded!');
        setTimeout(() => setToastMsg(null), 3000);
    };

    const renderChart = () => {
        switch (type) {
            case 'line':
                return (
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1A231E" vertical={false} />
                        <XAxis dataKey={nameKey} stroke="#808C84" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#808C84" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2B3730', strokeWidth: 2 }} />
                        <Line
                            type="monotone"
                            dataKey={valueKey}
                            stroke="#4FC79B"
                            strokeWidth={3}
                            dot={{ r: 4, fill: '#0B100D', strokeWidth: 2, stroke: '#4FC79B' }}
                            activeDot={{ r: 6, fill: '#4FC79B' }}
                        />
                    </LineChart>
                );
            case 'pie':
                return (
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            fill="#4FC79B"
                            paddingAngle={5}
                            dataKey={valueKey}
                            nameKey={nameKey}
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0.1)" />
                            ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                );
            case 'area':
                return (
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4FC79B" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#4FC79B" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1A231E" vertical={false} />
                        <XAxis dataKey={nameKey} stroke="#808C84" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#808C84" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey={valueKey} stroke="#4FC79B" fillOpacity={1} fill="url(#colorValue)" />
                    </AreaChart>
                );
            case 'bar':
            default:
                return (
                    <BarChart data={data} barSize={40}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1A231E" vertical={false} />
                        <XAxis dataKey={nameKey} stroke="#808C84" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#808C84" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(79,199,155,0.06)' }} />
                        <Bar dataKey={valueKey} fill="#4FC79B" radius={[4, 4, 0, 0]}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Bar>
                    </BarChart>
                );
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-vg-surface border border-vg-line rounded-xl p-5 w-full h-[400px] flex flex-col relative overflow-hidden group font-ui transition-colors hover:border-vg-muted"
        >
            
            {toastMsg && (
                <div role="status" className="absolute top-4 left-1/2 -translate-x-1/2 bg-vg-surface-3 border border-vg-line text-vg-text text-[12.5px] px-3 py-1 rounded-md shadow-lg z-50">
                    {toastMsg}
                </div>
            )}

            <div className="flex justify-between items-center mb-6 relative z-10">
                <div>
                    <h3 className="text-[15px] font-semibold text-vg-text flex items-center gap-2">
                        <TrendingUp size={17} className="text-vg-text-2" aria-hidden="true" />
                        {title || "Data Visualization"}
                    </h3>
                    <p className="text-[12px] mt-1 text-vg-text-3">
                        <span className="font-code text-vg-text-2">{valueKey}</span> by <span className="font-code text-vg-text-2">{nameKey}</span>
                    </p>
                </div>
                {!hideActions && (
                    <div className="flex gap-2">
                        <button 
                            onClick={handleShare}
                            aria-label="Share as public link" className="w-8 h-8 flex items-center justify-center rounded-md text-vg-text-3 hover:bg-vg-surface-2 hover:text-vg-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vg-accent"
                            title="Share as Public Link"
                        >
                            <Share2 size={16} />
                        </button>
                        <button 
                            onClick={handleDownload}
                            aria-label="Download data as CSV" className="w-8 h-8 flex items-center justify-center rounded-md text-vg-text-3 hover:bg-vg-surface-2 hover:text-vg-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vg-accent"
                            title="Download Data as CSV"
                        >
                            <Download size={16} />
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 w-full min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    {renderChart()}
                </ResponsiveContainer>
            </div>
        </motion.div>
    );
};

export default InsightDashboard;
