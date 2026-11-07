import { useMemo } from 'react';
import {
    BarChart, Bar,
    LineChart, Line,
    PieChart, Pie, Cell,
    AreaChart, Area,
    ScatterChart, Scatter,
    ComposedChart,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { flattenValue } from '../lib/turnFormat';
/* ------------------------------------------------------------------ */
/* Design tokens — Verdigris palette (hex mirrors of the vg-* CSS vars)  */
/* ------------------------------------------------------------------ */
// accent, clay, amber, text-2, accent-deep, red
const COLORS = ['#4FC79B', '#C98F5C', '#D4A961', '#A9B5AC', '#2A8467', '#DF6A57'];

const BG_TOOLTIP = '#121A16';
const GRID_COLOR = '#1A231E';
const TICK_COLOR = '#808C84';
const TEXT_COLOR = '#E9EFE9';
const LINE_COLOR = '#2B3730';
const BG_BASE = '#0B100D';
const TICK_FONT  = '"DM Sans", system-ui, sans-serif';

/* ------------------------------------------------------------------ */
/* Custom tooltip                                                       */
/* ------------------------------------------------------------------ */
function AtlasTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: BG_TOOLTIP,
            border: `1px solid ${LINE_COLOR}`,
            borderRadius: '12px',
            padding: '10px 14px',
            fontSize: '12px',
            fontFamily: TICK_FONT,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
            {label !== undefined && (
                <p style={{ color: TEXT_COLOR, fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
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
export default function ChartRenderer({ data, chartType = 'bar' }) {

    // Clean/flatten data for Recharts to handle nested MongoDB _id / other objects smoothly
    const processedData = useMemo(() => {
        if (!data?.length) return [];
        return data.map((item) => {
            const cleaned = { ...item };
            for (const key of Object.keys(cleaned)) {
                const val = cleaned[key];
                if (val !== null && typeof val === 'object') {
                    cleaned[key] = flattenValue(val);
                }
            }
            return cleaned;
        });
    }, [data]);

    const { labelKey, valueKeys } = useChartKeys(processedData);

    if (!data?.length || !labelKey) return null;

    /* --- Chart bodies --- */
    const commonProps = { data: processedData, margin: { top: 12, right: 20, left: 0, bottom: processedData.length > 8 ? 48 : 4 } };
    const tickAngle   = data.length > 8 ? -35 : 0;
    const axisProps   = {
        tick: { fill: TICK_COLOR, fontSize: 11, fontFamily: TICK_FONT },
        axisLine: false,
        tickLine: false,
    };
    const xAxisProps  = {
        ...axisProps,
        angle: tickAngle,
        textAnchor: tickAngle !== 0 ? 'end' : 'middle',
        interval: data.length > 20 ? Math.floor(data.length / 10) : 0,
    };
    const gridProps   = { stroke: GRID_COLOR, strokeDasharray: '0' };

    const renderBody = () => {
        switch (chartType) {
            case 'bar':
                return (
                    <BarChart {...commonProps}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey={labelKey} {...xAxisProps} />
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
                        <XAxis dataKey={labelKey} {...xAxisProps} />
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
                                    const { cx, cy, index } = props;
                                    return (
                                        <circle 
                                            key={`dot-${index}`}
                                            cx={cx} cy={cy} r={3.5} 
                                            fill={BG_BASE}
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
                        <XAxis dataKey={labelKey} {...xAxisProps} />
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
                    <PieChart margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
                        <Tooltip content={<AtlasTooltip />} />
                        <Pie
                            data={processedData}
                            dataKey={pieKey}
                            nameKey={labelKey}
                            cx="50%" cy="50%"
                            outerRadius={100} innerRadius={44}
                            strokeWidth={2} stroke={BG_BASE}
                            label={false}
                            labelLine={false}
                        >
                            {processedData.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                        </Pie>
                        <Legend
                            wrapperStyle={{ fontFamily: TICK_FONT, fontSize: 11, color: TICK_COLOR }}
                            formatter={(value) => String(value).slice(0, 18)}
                        />
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
                        <Scatter name={`${xKey} vs ${yKey}`} data={processedData} strokeWidth={1} stroke={BG_BASE}>
                            {processedData.map((entry, index) => (
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
                        <XAxis dataKey={labelKey} {...xAxisProps} />
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

            default:
                return null;
        }
    };

    /* ------------------------------------------------------------------ */
    /* Render                                                               */
    /* ------------------------------------------------------------------ */
    return (
        <div style={{ padding: '16px 8px 8px' }}>
            <ResponsiveContainer width="100%" height={280}>
                {renderBody()}
            </ResponsiveContainer>
        </div>
    );
}
