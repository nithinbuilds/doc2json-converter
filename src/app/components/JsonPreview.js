"use client";

import { useState, useEffect } from 'react';

export default function JsonPreview({ data, onChange }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(false);

  // Sync incoming data to textarea
  useEffect(() => {
    const cleanData = (dt) => {
      if (!dt || !Array.isArray(dt.content)) return dt;
      return {
        ...dt,
        content: dt.content.map(b => {
          if (b.type === 'PlushSearchCarousel' && b.items) {
            return {
              ...b,
              items: b.items.map(it => ({ $oid: it.$oid }))
            };
          }
          return b;
        })
      };
    };
    setText(JSON.stringify(cleanData(data), null, 2));
    setError(false);
  }, [data]);

  const handleChange = (e) => {
    const newVal = e.target.value;
    setText(newVal);
    
    try {
      const parsed = JSON.parse(newVal);
      setError(false);
      if (onChange) onChange(parsed);
    } catch (err) {
      // Invalid JSON typing - we just highlight it red and don't push upward
      setError(true);
    }
  };

  if (!data) return null;

  return (
    <div className="w-full h-full relative">
      <textarea
        value={text}
        onChange={handleChange}
        className="w-full h-full bg-transparent text-sm font-mono text-[#cdd6f4ff] resize-none outline-none border-0 absolute inset-0"
        spellCheck={false}
      />
      {error && (
        <div className="absolute top-0 right-0 bg-red-500/20 text-red-400 px-2 py-1 text-xs rounded border border-red-500/50">
          Invalid JSON
        </div>
      )}
    </div>
  );
}
