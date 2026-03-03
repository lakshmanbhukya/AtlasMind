import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import { motion } from 'framer-motion';
import { TrendingUp, Download, Share2 } from 'lucide-react';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-black/80 backdrop-blur-2xl border border-white/5 p-4 rounded-xl shadow-2xl shadow-black/80">
                <p className="text-gray-400 text-xs uppercase tracking-widest font-semibold mb-2">{label}</p>
                {payload.map((entry, index) => (
                    <p key={index} className="text-sm" style={{ color: entry.color }}>
                        {entry.name}: <span className="font-bold text-white">{entry.value.toLocaleString()}</span>
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

const InsightDashboard = ({ data, type = 'bar', title }) => {
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

    const renderChart = () => {
        switch (type) {
            case 'line':
                return (
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                        <XAxis dataKey={nameKey} stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#ffffff20', strokeWidth: 2 }} />
                        <Line
                            type="monotone"
                            dataKey={valueKey}
                            stroke="#3b82f6"
                            strokeWidth={3}
                            dot={{ r: 4, fill: '#1d4ed8', strokeWidth: 2, stroke: '#fff' }}
                            activeDot={{ r: 6, fill: '#60a5fa' }}
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
                            fill="#8884d8"
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
                                <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                        <XAxis dataKey={nameKey} stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey={valueKey} stroke="#8884d8" fillOpacity={1} fill="url(#colorValue)" />
                    </AreaChart>
                );
            case 'bar':
            default:
                return (
                    <BarChart data={data} barSize={40}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                        <XAxis dataKey={nameKey} stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff05' }} />
                        <Bar dataKey={valueKey} fill="#3b82f6" radius={[4, 4, 0, 0]}>
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
            className="bg-[#151b24] border-2 border-solid border-[#2d3748] rounded-[2px] p-6 w-full h-[400px] flex flex-col mt-6 relative overflow-hidden group transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[#3f4f63] hover:shadow-[2px_2px_0_rgba(0,0,0,0.5)] hover:-translate-x-[1px] hover:-translate-y-[1px]"
        >
            {/* Subtle glow effect behind chart */}
            <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
            
            <div className="flex justify-between items-center mb-6 relative z-10">
                <div>
                    <h3 className="text-[14px] font-semibold text-white flex items-center gap-2" style={{ fontFamily: 'DM Sans' }}>
                        <TrendingUp size={18} className="text-blue-400" />
                        {title || "Data Visualization"}
                    </h3>
                    <p className="text-[10px] mt-1" style={{ fontFamily: 'IBM Plex Mono', color: '#64748b' }}>
                        Showing <strong>{valueKey}</strong> by <strong>{nameKey}</strong>
                    </p>
                </div>
                <div className="flex gap-2">
                    <button className="w-8 h-8 flex items-center justify-center border border-[#2d3748] bg-transparent rounded-[2px] text-[#94a3b8] hover:bg-[#1a2332] hover:border-[#3f4f63] hover:text-[#e2e8f0] transition-all duration-150">
                        <Share2 size={16} />
                    </button>
                    <button className="w-8 h-8 flex items-center justify-center border border-[#2d3748] bg-transparent rounded-[2px] text-[#94a3b8] hover:bg-[#1a2332] hover:border-[#ef4444] hover:text-[#ef4444] transition-all duration-150">
                        <Download size={16} />
                    </button>
                </div>
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
