"use client";

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Calendar, Search, Activity, PlayCircle, Loader2, BarChart2 } from 'lucide-react';
import { format, subDays, parseISO, isValid } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';

function WistiaDashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const urlMediaId = searchParams?.get('mediaId') || '';
  
  const [mediaId, setMediaId] = useState(urlMediaId);
  const [inputMediaId, setInputMediaId] = useState(urlMediaId);
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch data
  useEffect(() => {
    if (!mediaId) return;

    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/wistia/stats?mediaId=${encodeURIComponent(mediaId)}&start_date=${startDate}&end_date=${endDate}`);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Failed to fetch data');
        }
        
        const result = await res.json();
        // Wistia may return array directly or wrapped in an object
        const statsArray = Array.isArray(result) ? result : (result.data || result.stats || []);
        
        // Ensure data is sorted by date and formatted properly
        const formattedData = statsArray.map((item: any) => ({
          ...item,
          // Extract commonly used metrics (Wistia might use load_count, play_count, etc)
          load_count: item.load_count || item.loads || 0,
          play_count: item.play_count || item.plays || 0,
          date: item.date || item.day || '',
        })).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

        setData(formattedData);
      } catch (err: any) {
        setError(err.message || 'An error occurred while fetching data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [mediaId, startDate, endDate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setMediaId(inputMediaId);
    if (inputMediaId !== urlMediaId) {
      // Update URL so it can be copied/embedded cleanly
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('mediaId', inputMediaId);
      router.replace(newUrl.pathname + newUrl.search);
    }
  };

  const totals = useMemo(() => {
    return data.reduce(
      (acc, curr) => ({
        loads: acc.loads + (curr.load_count || 0),
        plays: acc.plays + (curr.play_count || 0),
      }),
      { loads: 0, plays: 0 }
    );
  }, [data]);

  const playRate = totals.loads > 0 ? ((totals.plays / totals.loads) * 100).toFixed(1) : '0.0';

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl shadow-2xl">
          <p className="text-neutral-300 mb-2 font-medium">
            {isValid(parseISO(label)) ? format(parseISO(label), 'MMM d, yyyy') : label}
          </p>
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-sm font-medium capitalize text-neutral-400">
                {entry.name.replace('_', ' ')}:
              </span>
              <span className="text-sm font-bold text-white">{entry.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-4 sm:p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header & Controls Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 p-6 rounded-2xl bg-neutral-900/50 border border-neutral-800 shadow-lg backdrop-blur-xl">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400 flex items-center gap-2 mb-2">
              <BarChart2 className="w-8 h-8 text-blue-500" />
              Wistia Media Analytics
            </h1>
            <p className="text-neutral-400 text-sm">Embeddable performance report for a specific media item.</p>
          </div>

          <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Media ID</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  type="text"
                  placeholder="e.g. hashed_id"
                  value={inputMediaId}
                  onChange={(e) => setInputMediaId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-neutral-600"
                />
              </div>
            </div>

            <div className="space-y-1.5 w-[140px]">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all [color-scheme:dark]"
              />
            </div>

            <div className="space-y-1.5 w-[140px]">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all [color-scheme:dark]"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !inputMediaId}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-all shadow-lg shadow-blue-900/20 active:scale-95 flex items-center justify-center min-w-[100px]"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
            </button>
          </form>
        </div>

        {/* Error State */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Stats Content */}
        {!mediaId && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-neutral-800 rounded-2xl bg-neutral-900/30">
            <PlayCircle className="w-12 h-12 text-neutral-600 mb-4" />
            <p className="text-neutral-400 text-sm font-medium">Enter a Media ID to view analytics</p>
          </div>
        )}

        {mediaId && !error && (
          <div className="space-y-6 fade-in animate-in slide-in-from-bottom-4 duration-500">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-1">Total Loads</p>
                    <h3 className="text-3xl font-bold text-white">
                      {loading ? <span className="text-neutral-700 animate-pulse">---</span> : totals.loads.toLocaleString()}
                    </h3>
                  </div>
                  <div className="p-2.5 bg-blue-500/10 rounded-lg text-blue-400">
                    <Activity className="w-5 h-5" />
                  </div>
                </div>
              </div>

              <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-1">Total Plays</p>
                    <h3 className="text-3xl font-bold text-white">
                      {loading ? <span className="text-neutral-700 animate-pulse">---</span> : totals.plays.toLocaleString()}
                    </h3>
                  </div>
                  <div className="p-2.5 bg-indigo-500/10 rounded-lg text-indigo-400">
                    <PlayCircle className="w-5 h-5" />
                  </div>
                </div>
              </div>

              <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-1">Play Rate</p>
                    <h3 className="text-3xl font-bold text-white flex items-baseline gap-1">
                      {loading ? <span className="text-neutral-700 animate-pulse">---</span> : playRate}
                      {!loading && <span className="text-lg text-neutral-500">%</span>}
                    </h3>
                  </div>
                  <div className="p-2.5 bg-purple-500/10 rounded-lg text-purple-400">
                    <BarChart2 className="w-5 h-5" />
                  </div>
                </div>
              </div>
            </div>

            {/* Main Chart */}
            <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl shadow-xl">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-500" />
                  Loads vs Plays over Time
                </h3>
                <div className="flex items-center gap-4 text-xs font-medium">
                  <div className="flex items-center gap-1.5 text-blue-400">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Loads
                  </div>
                  <div className="flex items-center gap-1.5 text-indigo-400">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Plays
                  </div>
                </div>
              </div>

              <div className="h-[400px] w-full relative">
                {loading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm rounded-xl">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  </div>
                )}
                
                {data.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorLoads" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorPlays" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#525252" 
                        tick={{ fill: '#737373', fontSize: 12 }} 
                        tickMargin={10}
                        tickFormatter={(str) => {
                          if (!str) return '';
                          const date = parseISO(str);
                          return isValid(date) ? format(date, 'MMM d') : str;
                        }}
                      />
                      <YAxis 
                        stroke="#525252" 
                        tick={{ fill: '#737373', fontSize: 12 }} 
                        tickMargin={10} 
                        axisLine={false}
                        tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      
                      <Area 
                        type="monotone" 
                        dataKey="load_count" 
                        name="Loads" 
                        stroke="#3b82f6" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorLoads)" 
                        activeDot={{ r: 6, strokeWidth: 0, fill: '#3b82f6' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="play_count" 
                        name="Plays" 
                        stroke="#6366f1" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorPlays)" 
                        activeDot={{ r: 6, strokeWidth: 0, fill: '#6366f1' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : !loading ? (
                  <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm">
                    No data available for the selected period
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WistiaEmbedWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="animate-spin text-blue-500"><Loader2 className="w-8 h-8" /></div>
      </div>
    }>
      <WistiaDashboardContent />
    </Suspense>
  );
}
