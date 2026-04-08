"use client";

import { useState } from 'react';
import EditorWorkspace from './components/EditorWorkspace';
import JsonPreview from './components/JsonPreview';

export default function Home() {
  const [docUrl, setDocUrl] = useState('');
  const [blogNo, setBlogNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Custom JSON state that powers the block editor
  const [blockData, setBlockData] = useState(null);

  const handleParse = async () => {
    if (!docUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: docUrl, blogNo })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse');
      }
      setBlockData(data.json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBlocksChange = (newBlockData) => {
    // Allows child components to synchronize edits to the parent state
    setBlockData(newBlockData);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-8 font-sans transition-colors duration-200">
      <header className="mb-8 flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">Doc2Json Converter</h1>
          <p className="text-slate-500 mt-1">Transform Google Docs into your custom structured JSON format seamlessly.</p>
        </div>
      </header>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-6 flex gap-3 items-center">
        <input
          type="number"
          min="1"
          placeholder="Blog No."
          value={blogNo}
          onChange={e => setBlogNo(e.target.value)}
          className="w-28 shrink-0 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all text-center font-semibold"
        />
        <input 
          type="url" 
          placeholder="Paste Google Doc URL here..." 
          value={docUrl} 
          onChange={e => setDocUrl(e.target.value)}
          className="flex-1 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
        <button 
          onClick={handleParse} 
          disabled={loading || !docUrl}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shrink-0"
        >
          {loading ? 'Parsing...' : 'Parse Document'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-6 border border-red-100">
          <strong>Error:</strong> {error}
        </div>
      )}

      {blockData && (
        <div className="grid lg:grid-cols-2 gap-8 h-[calc(100vh-250px)]">
          {/* Left / Top Panel: Interactive Block Editor */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h2 className="font-semibold text-slate-800">Visual Editor</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
              <EditorWorkspace data={blockData} onChange={handleBlocksChange} />
            </div>
          </div>

          {/* Right Panel: JSON Code Preview */}
          <div className="bg-[#1e1e2eff] rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-700/50 bg-[#181825ff]">
              <h2 className="font-semibold text-slate-200 flex justify-between items-center">
                <span>Output JSON</span>
                <button 
                  onClick={() => {
                    const cleanData = (dt) => {
                      if (!dt || !Array.isArray(dt.content)) return dt;
                      return {
                        ...dt,
                        content: dt.content.map(b => {
                          if (b.type === 'PlushSearchCarousel' && b.items) {
                            return { ...b, items: b.items.map(it => ({ $oid: it.$oid })) };
                          }
                          return b;
                        })
                      };
                    };
                    navigator.clipboard.writeText(JSON.stringify(cleanData(blockData), null, 2));
                  }}
                  className="text-xs bg-[#313244ff] hover:bg-[#45475aff] px-3 py-1 rounded transition-colors"
                >
                  Copy JSON
                </button>
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-sm font-mono text-[#cdd6f4ff]">
              <JsonPreview data={blockData} onChange={handleBlocksChange} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
