import { useState, useMemo, useCallback } from 'react';
import {
    BarChart, Bar,
    LineChart, Line,
    PieChart, Pie, Cell,
    AreaChart, Area,
    ScatterChart, Scatter,
    ComposedChart,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
    BarChart3, TrendingUp, PieChart as PieIcon, Layers,
    Pin, PinOff, Table2, Crosshair, GitMerge,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Design tokens — synced with Atlas dark theme                        */
/* ------------------------------------------------------------------ */
const COLORS = ['#00ED64', '#016EE9', '#FFC000', '#8b5cf6', '#f59e0b', '#06b6d4'];

const BG_PANEL   = 'transparent';
const BG_TOOLTIP = '#0a0e14';
const GRID_COLOR = 'rgba(255,255,255,0.04)';
const TICK_COLOR = '#64748b';
const TICK_FONT  = '"DM Sans", system-ui, sans-serif';

const CHART_TYPES = [
    { id: 'bar',      label: 'Bar',      Icon: BarChart3   },
    { id: 'line',     label: 'Line',     Icon: TrendingUp  },
    { id: 'area',     label: 'Area',     Icon: Layers      },
    { id: 'pie',      label: 'Pie',      Icon: PieIcon     },
    { id: 'scatter',  label: 'Scatter',  Icon: Crosshair   },
    { id: 'composed', label: 'Composed', Icon: GitMerge    },
    { id: 'table',    label: 'Table',    Icon: Table2      },
];

/* ------------------------------------------------------------------ */
/* Custom tooltip                                                       */
/* ------------------------------------------------------------------ */
function AtlasTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: BG_TOOLTIP,
            border: '1px solid rgba(0,237,100,0.25)',
            borderRadius: '12px',
            padding: '10px 14px',
            fontSize: '12px',
            fontFamily: TICK_FONT,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
            {label !== undefined && (
                <p style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                    {String(label)}
                </p>
            )}
            {payload.map((entry, i) => (
                <p key={i} style={{ color: entry.color || COLORS[i], margin: '3px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ opacity: 0.7 }}>{entry.name}:</span>
                    <strong>{typeof entry.value === 'number' ? entry.value.toLocaleString() : String(entry.value ?? '')}</strong>
                </p>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Smart key detection                                                  */
/* ------------------------------------------------------------------ */
function useChartKeys(data) {
    return useMemo(() => {
        if (!data?.length) return { labelKey: null, valueKeys: [] };

        const first = data[0];
        const keys = Object.keys(first);

        let labelKey = '_id';
        const numericKeys = [];
        const stringKeys = [];

        for (const key of keys) {
            const v = first[key];
            if (typeof v === 'number') numericKeys.push(key);
            else if (typeof v === 'string') stringKeys.push(key);
        }

        // Prefer a string key or _id for labels
        if (typeof first._id === 'string' || typeof first._id === 'number') {
            labelKey = '_id';
        } else if (stringKeys.length > 0) {
            labelKey = stringKeys[0];
        } else {
            labelKey = keys[0];
        }

        // Fallback: try parsing all keys as numbers
        if (numericKeys.length === 0) {
            for (const key of keys) {
                if (key !== labelKey && !isNaN(Number(first[key]))) {
                    numericKeys.push(key);
                }
            }
        }

        return {
            labelKey,
            valueKeys: numericKeys.length > 0
                ? numericKeys
                : keys.filter((k) => k !== labelKey).slice(0, 3),
        };
    }, [data]);
}

/* ------------------------------------------------------------------ */
/* ChartRenderer                                                        */
/* ------------------------------------------------------------------ */
export default function ChartRenderer({ data, chartType: initialChartType = 'bar', query, onPin, isPinned = false }) {
    const [activeType, setActiveType] = useState(initialChartType || 'bar');
    const [pinned, setPinned] = useState(isPinned);
    const { labelKey, valueKeys } = useChartKeys(data);

    const handlePin = useCallback(() => {
        setPinned((p) => !p);
        if (onPin) onPin({ query, chartType: activeType, results: data });
    }, [onPin, query, activeType, data]);

    if (!data?.length || !labelKey) return null;

    /* --- Chart bodies --- */
    const commonProps = { data, margin: { top: 12, right: 20, left: 0, bottom: 4 } };
    const axisProps   = { tick: { fill: TICK_COLOR, fontSize: 11, fontFamily: TICK_FONT }, axisLine: false, tickLine: false };
    const gridProps   = { stroke: GRID_COLOR, strokeDasharray: '0' };

    const renderBody = () => {
        switch (activeType) {
            case 'bar':
                return (
                    <BarChart {...commonProps}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey={labelKey} {...axisProps} />
                        <YAxis {...axisProps} />
                        <Tooltip content={<AtlasTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                        <Legend wrapperStyle={{ fontFamily: TICK_FONT, fontSize: 11, color: TICK_COLOR }} />
                        {valueKeys.map((key, i) => (
                            <Bar
                                key={key}
                                dataKey={key}
                                fill={COLORS[i % COLORS.length]}
                                radius={[4, 4, 0, 0]}
                                maxBarSize={48}
                            >
                                {valueKeys.length === 1 && data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Bar>
                        ))}
                    </BarChart>
                );

            case 'line':
                return (
                    <LineChart {...commonProps}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey={labelKey} {...axisProps} />
                        <YAxis {...axisProps} />
                        <Tooltip content={<AtlasTooltip />} cursor={false} />
                        <Legend wrapperStyle={{ fontFamily: TICK_FONT, fontSize: 11, color: TICK_COLOR }} />
                        {valueKeys.map((key, i) => (
                            <Line
                                key={key}
                                type="monotone"
                                dataKey={key}
                                stroke={COLORS[i % COLORS.length]}
                                strokeWidth={2.5}
                                dot={(props) => {
                                    const { cx, cy, payload, index } = props;
                                    return (
                                        <circle 
                                            key={`dot-${index}`}
                                            cx={cx} cy={cy} r={3.5} 
                                            fill="#0D1117" 
                                            stroke={valueKeys.length === 1 ? COLORS[index % COLORS.length] : COLORS[i % COLORS.length]} 
                                            strokeWidth={2} 
                                        />
                                    );
                                }}
                                activeDot={{ r: 5, fill: COLORS[i % COLORS.length] }}
                            />
                        ))}
                    </LineChart>
                );

            case 'area':
                return (
                    <AreaChart {...commonProps}>
                        <defs>
                            {valueKeys.map((key, i) => (
                                <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%"   stopColor={COLORS[i % COLORS.length]} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                                </linearGradient>
                            ))}
                        </defs>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey={labelKey} {...axisProps} />
                        <YAxis {...axisProps} />
                        <Tooltip content={<AtlasTooltip />} cursor={false} />
                        <Legend wrapperStyle={{ fontFamily: TICK_FONT, fontSize: 11, color: TICK_COLOR }} />
                        {valueKeys.map((key, i) => (
                            <Area
                                key={key}
                                type="monotone"
                                dataKey={key}
                                stroke={COLORS[i % COLORS.length]}
                                strokeWidth={2.5}
                                fill={`url(#grad-${key})`}
                            />
                        ))}
                    </AreaChart>
                );

            case 'pie': {
                const pieKey = valueKeys[0];
                return (
                    <PieChart>
                        <Tooltip content={<AtlasTooltip />} />
                        <Pie
                            data={data}
                            dataKey={pieKey}
                            nameKey={labelKey}
                            cx="50%" cy="50%"
                            outerRadius={110} innerRadius={50}
                            strokeWidth={2} stroke="#0D1117"
                            label={({ name, percent }) => `${String(name).slice(0, 12)} ${(percent * 100).toFixed(0)}%`}
                            labelLine={{ stroke: TICK_COLOR, strokeWidth: 1 }}
                        >
                            {data.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                        </Pie>
                        <Legend wrapperStyle={{ fontFamily: TICK_FONT, fontSize: 11, color: TICK_COLOR }} />
                    </PieChart>
                );
            }

            case 'scatter': {
                const xKey = valueKeys[0] ?? labelKey;
                const yKey = valueKeys[1] ?? valueKeys[0];
                return (
                    <ScatterChart {...commonProps}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey={xKey} name={xKey} {...axisProps} />
                        <YAxis dataKey={yKey} name={yKey} {...axisProps} />
                        <Tooltip content={<AtlasTooltip />} cursor={{ stroke: TICK_COLOR, strokeDasharray: '3 3' }} />
                        <Scatter name={`${xKey} vs ${yKey}`} data={data} strokeWidth={1} stroke="#0D1117">
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Scatter>
                    </ScatterChart>
                );
            }

            case 'composed':
                return (
                    <ComposedChart {...commonProps}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey={labelKey} {...axisProps} />
                        <YAxis {...axisProps} />
                        <Tooltip content={<AtlasTooltip />} cursor={false} />
                        <Legend wrapperStyle={{ fontFamily: TICK_FONT, fontSize: 11, color: TICK_COLOR }} />
                        {valueKeys.map((key, i) =>
                            i === 0 ? (
                                <Bar key={key} dataKey={key} fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                            ) : (
                                <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={false} />
                            )
                        )}
                    </ComposedChart>
                );

            case 'table': {
                const columns = Object.keys(data[0]);
                return (
                    <div style={{ overflowX: 'auto', maxHeight: 320 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: TICK_FONT }}>
                            <thead>
                                <tr>
                                    {columns.map((col) => (
                                        <th key={col} style={{
                                            textAlign: 'left', padding: '8px 14px',
                                            borderBottom: '1px solid rgba(255,255,255,0.07)',
                                            color: TICK_COLOR, fontWeight: 700, fontSize: 10,
                                            textTransform: 'uppercase', letterSpacing: '0.08em',
                                            position: 'sticky', top: 0, background: '#0a0e14', whiteSpace: 'nowrap',
                                        }}>
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.map((row, ri) => (
                                    <tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        {columns.map((col) => {
                                            const val = row[col];
                                            const isNum = typeof val === 'number';
                                            return (
                                                <td key={col} style={{
                                                    padding: '8px 14px',
                                                    color: isNum ? '#00ED64' : '#e2e8f0',
                                                    fontFamily: isNum ? '"JetBrains Mono", monospace' : TICK_FONT,
                                                }}>
                                                    {isNum ? val.toLocaleString() : (val === null || val === undefined ? '—' : String(val))}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            }

            default:
                return null;
        }
    };

    /* ------------------------------------------------------------------ */
    /* Render                                                               */
    /* ------------------------------------------------------------------ */
    return (
        <div style={{ background: BG_PANEL }}>
            {/* Toolbar */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(0,0,0,0.2)',
                gap: 8,
                flexWrap: 'wrap',
            }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {CHART_TYPES.map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveType(id)}
                            title={label}
                            aria-label={`Switch to ${label} chart`}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                padding: '5px 10px',
                                borderRadius: 8,
                                border: activeType === id
                                    ? '1px solid rgba(0,237,100,0.4)'
                                    : '1px solid rgba(255,255,255,0.07)',
                                background: activeType === id
                                    ? 'rgba(0,237,100,0.12)'
                                    : 'transparent',
                                color: activeType === id ? '#00ED64' : TICK_COLOR,
                                fontSize: 11, fontFamily: TICK_FONT, fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Icon size={12} />
                            {label}
                        </button>
                    ))}
                </div>

                {onPin && (
                    <button
                        onClick={handlePin}
                        aria-label={pinned ? 'Unpin from dashboard' : 'Pin to dashboard'}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '5px 10px',
                            borderRadius: 8,
                            border: pinned ? '1px solid rgba(0,237,100,0.4)' : '1px solid rgba(255,255,255,0.07)',
                            background: pinned ? 'rgba(0,237,100,0.12)' : 'transparent',
                            color: pinned ? '#00ED64' : TICK_COLOR,
                            fontSize: 11, fontFamily: TICK_FONT, fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                    >
                        {pinned ? <PinOff size={12} /> : <Pin size={12} />}
                        {pinned ? 'Unpin' : 'Pin to Dashboard'}
                    </button>
                )}
            </div>

            {/* Chart / Table body */}
            <div style={{ padding: activeType === 'table' ? 0 : '16px 8px 8px' }}>
                {activeType !== 'table' ? (
                    <ResponsiveContainer width="100%" height={280}>
                        {renderBody()}
                    </ResponsiveContainer>
                ) : (
                    renderBody()
                )}
            </div>
        </div>
    );
}
