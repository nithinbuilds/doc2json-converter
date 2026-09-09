"use client";

import React, { useState, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Type,
  Heading2,
  List as ListIcon,
  Image as ImageIcon,
  Table as TableIcon,
  Trash2,
  Sparkles,
  Zap,
  Plus,
  Bold,
  Italic,
  Link,
  X,
} from 'lucide-react';

function InsertPoint({ onInsert }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const addBlock = async (type) => {
    let newBlock = { type };
    
    if (type === 'Paragraph' || type === 'Subtitle') {
      newBlock.segments = [{ content: '' }];
    } else if (type === 'Image') {
      const url = prompt('Enter Image URL:');
      if (!url) return;
      newBlock.url = url;
      newBlock.altText = '';
    } else if (type === 'PlushSearchCarousel') {
      const input = prompt('Enter a Plush search prompt (or chat/edits URL):');
      if (!input) return;
      setLoading(true);
      try {
        const body = input.includes('plush.shop/')
          ? { url: input.trim() }
          : { query: input.trim() };
        const res = await fetch('/api/fetch-carousel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        newBlock.query = data.query;
        newBlock.items = data.oids;
      } catch (err) {
        alert('Failed to fetch carousel: ' + err.message);
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    
    onInsert(newBlock);
    setIsOpen(false);
  };

  return (
    <div className="relative h-2 group/insert my-1 flex items-center justify-center">
      <div className="absolute inset-x-0 h-px bg-slate-200 opacity-0 group-hover/insert:opacity-100 transition-opacity pointer-events-none" />
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative z-10 w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 hover:shadow-sm flex items-center justify-center opacity-0 group-hover/insert:opacity-100 transition-all scale-75 group-hover/insert:scale-100"
        title="Insert block"
      >
        <Plus size={14} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-1 z-[100] bg-white border border-slate-200 shadow-xl rounded-xl p-2 min-w-[160px] animate-in fade-in zoom-in duration-200">
          <div className="flex justify-between items-center px-2 py-1 mb-1 border-b border-slate-50">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Add Content</span>
            <button onClick={() => setIsOpen(false)} className="text-slate-300 hover:text-slate-500"><X size={12} /></button>
          </div>
          <div className="space-y-0.5">
            {[
              { label: 'Paragraph', type: 'Paragraph', icon: Type },
              { label: 'Subtitle', type: 'Subtitle', icon: Heading2 },
              { label: 'Image', type: 'Image', icon: ImageIcon },
              { label: 'Carousel', type: 'PlushSearchCarousel', icon: Sparkles },
            ].map(b => (
              <button
                key={b.type}
                disabled={loading}
                onClick={() => addBlock(b.type)}
                className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-indigo-600 rounded-lg flex items-center gap-2.5 transition-colors disabled:opacity-50"
              >
                <b.icon size={14} className="opacity-70" />
                {loading && b.type === 'PlushSearchCarousel' ? 'Fetching...' : b.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FloatingToolbar({ position, onFormat, activeFormats }) {
  if (!position) return null;

  return (
    <div 
      className="fixed z-[1000] bg-slate-900 text-white rounded-lg shadow-xl flex items-center p-1 border border-slate-700 animate-in fade-in zoom-in duration-150"
      style={{ 
        left: position.left, 
        top: position.top - 45,
        transform: 'translateX(-50%)'
      }}
      onMouseDown={e => e.preventDefault()} // Prevent blur
    >
      <button 
        onClick={() => onFormat('bold')}
        className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${activeFormats.bold ? 'text-indigo-400 bg-slate-800' : ''}`}
        title="Bold"
      >
        <Bold size={14} />
      </button>
      <button 
        onClick={() => onFormat('italic')}
        className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${activeFormats.italic ? 'text-indigo-400 bg-slate-800' : ''}`}
        title="Italic"
      >
        <Italic size={14} />
      </button>
      <button 
        onClick={() => {
          const url = prompt('Enter URL:');
          if (url) onFormat('link', url);
        }}
        className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${activeFormats.link ? 'text-indigo-400 bg-slate-800' : ''}`}
        title="Link"
      >
        <Link size={14} />
      </button>
    </div>
  );
}

function EditableText({ segment, onUpdateText, onUpdateUrl, onInsertLineBreak, autoFocusAtStart, autoFocusAtEnd, onFocusDone, onDeletePrevBreak, onSelect }) {
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [tempUrl, setTempUrl] = useState('');
  const spanRef = useRef(null);

  const checkSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !spanRef.current?.contains(sel.anchorNode)) {
      onSelect?.(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    onSelect?.({
      left: rect.left + rect.width / 2,
      top: rect.top,
      start: range.startOffset,
      end: range.endOffset,
      segment
    });
  };

  // Handle both focus-at-start and focus-at-end requests
  useEffect(() => {
    if (!autoFocusAtStart && !autoFocusAtEnd) return;
    const el = spanRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    try {
      if (autoFocusAtEnd) {
        range.selectNodeContents(el);
        range.collapse(false); // collapse to end
      } else {
        const target = el.firstChild || el;
        range.setStart(target, 0);
        range.collapse(true);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
    onFocusDone?.(); // tell parent to clear focusReq
  }, [autoFocusAtStart, autoFocusAtEnd]);

  let className = "outline-none rounded transition-colors inline min-w-[2px] cursor-text";
  let href = segment.link || segment.url;
  if (href) className += " text-indigo-600 underline decoration-indigo-300 hover:decoration-indigo-600 cursor-pointer";
  
  const handleDoubleClick = (e) => {
    if (href) {
      e.preventDefault();
      e.stopPropagation();
      setTempUrl(href);
      setIsEditingUrl(true);
    }
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    if (tempUrl.trim() !== '') {
      onUpdateUrl(tempUrl.trim());
    }
    setIsEditingUrl(false);
  };

  const el = (
    <span className="relative inline">
      <span
        ref={spanRef}
        className={className}
        style={{ caretColor: '#000' }}
        contentEditable
        suppressContentEditableWarning
        title={href ? "Edit text inline — Double-click to edit URL | Enter = line break | Shift+Enter = paragraph gap" : "Enter = line break | Shift+Enter = paragraph gap"}
        onDoubleClick={handleDoubleClick}
        onMouseUp={checkSelection}
        onKeyUp={checkSelection}
        onBlur={(e) => {
          const text = e.target.innerText;
          onSelect?.(null);
          // Always save if text changed, or if empty (triggers cleanup filter)
          if (text !== segment.content || text === '') {
            onUpdateText(text);
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            let caretOffset = (segment.content || '').length;
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) caretOffset = sel.getRangeAt(0).startOffset;
            e.preventDefault();
            if (onInsertLineBreak) onInsertLineBreak(e.shiftKey ? '\n\n' : '\n', caretOffset);
          }
          if (e.key === 'Backspace' && onDeletePrevBreak) {
            const sel = window.getSelection();
            const atStart = sel && sel.rangeCount > 0
              && sel.getRangeAt(0).startOffset === 0
              && sel.getRangeAt(0).collapsed;
            if (atStart) {
              e.preventDefault();
              onDeletePrevBreak();
            }
          }
        }}
      >
        {segment.content}
      </span>

      {isEditingUrl && href && (
        <span 
          className="absolute left-0 top-full mt-1 bg-white border border-slate-200 shadow-xl rounded-md p-1.5 z-[99] flex items-center gap-1.5"
          style={{ width: 'max-content' }}
          contentEditable={false}
        >
          <input
            autoFocus
            className="text-xs font-mono border border-slate-300 rounded px-2 py-1 w-56 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-700"
            value={tempUrl}
            onChange={(e) => setTempUrl(e.target.value)}
            onBlur={() => setIsEditingUrl(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleUrlSubmit(e);
              if (e.key === 'Escape') setIsEditingUrl(false);
            }}
          />
          <button 
             onMouseDown={(e) => { 
                e.preventDefault(); 
                handleUrlSubmit(e); 
             }}
             className="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] px-2.5 py-1 rounded transition-colors font-medium"
          >
            Save
          </button>
        </span>
      )}
    </span>
  );

  if (segment.bold && segment.italic) return <strong className="font-bold italic">{el}</strong>;
  if (segment.bold) return <strong className="font-bold">{el}</strong>;
  if (segment.italic) return <em className="italic">{el}</em>;
  return el;
}

function renderSegments(segments, onSegmentsChange, focusReq, onRequestFocus, onSelect) {
  if (!segments) return null;
  return segments.map((s, i) => {
    // Skip empty-content segments — exempt if they are the pending focus target
    if (s.content === '' && !s.type && focusReq?.idx !== i) return null;

    if (s.type === 'List') {
      return (
        <ul key={i} className={`${s.ordered ? 'list-decimal' : 'list-disc'} list-inside block my-3 pl-4 space-y-1`}>
          {s.items?.map((li, j) => (
            <li key={j}>
              {renderSegments(li.segments, (newLiSegs) => {
                if (!onSegmentsChange) return;
                const newItems = [...s.items];
                newItems[j] = { ...li, segments: newLiSegs };
                const newSegments = [...segments];
                newSegments[i] = { ...s, items: newItems };
                onSegmentsChange(newSegments);
              }, null, null, onSelect)}
            </li>
          ))}
        </ul>
      );
    }

    // \n\n — paragraph gap: subtle thin rule
    if (s.content === '\n\n') {
      return (
        <span
          key={i}
          contentEditable={false}
          className="block my-2 select-none"
        />
      );
    }

    // \n — plain line break
    if (s.content === '\n') {
      return <br key={i} />;
    }
    
    return (
      <EditableText 
        key={i} 
        segment={s}
        autoFocusAtStart={focusReq?.idx === i && !focusReq?.atEnd}
        autoFocusAtEnd={focusReq?.idx === i && focusReq?.atEnd === true}
        onFocusDone={() => onRequestFocus && onRequestFocus(null)}
        onSelect={onSelect}
        onUpdateText={(newContent) => {
          if (!onSegmentsChange) return;
          const newSegments = [...segments];
          newSegments[i] = { ...s, content: newContent };
          onSegmentsChange(newSegments);
        }} 
        onUpdateUrl={(newUrl) => {
          if (!onSegmentsChange) return;
          const newSegments = [...segments];
          newSegments[i] = { ...s, link: newUrl };
          onSegmentsChange(newSegments);
        }}
        onInsertLineBreak={(type, caretOffset) => {
          if (!onSegmentsChange) return;
          const content = s.content || '';
          const before = content.slice(0, caretOffset);
          const after  = content.slice(caretOffset);
          const parts = [];
          if (before) parts.push({ ...s, content: before });
          parts.push({ content: type });
          // Always push after (even '' so cursor has a segment to land in)
          parts.push({ ...s, content: after });
          const newSegments = [...segments];
          newSegments.splice(i, 1, ...parts);
          onSegmentsChange(newSegments);
          // Always move cursor to the segment after the break
          if (onRequestFocus) {
            const focusIdx = before ? i + 2 : i + 1;
            onRequestFocus({ idx: focusIdx, atEnd: false });
          }
        }}
        onDeletePrevBreak={() => {
          if (!onSegmentsChange) return;
          const prevIdx = i - 1;
          if (prevIdx >= 0) {
            const prev = segments[prevIdx];
            if (prev && (prev.content === '\n' || prev.content === '\n\n')) {
              const newSegments = segments.filter((_, idx) => idx !== prevIdx);
              onSegmentsChange(newSegments);
              // Focus the segment that was before the break, at its end
              const targetIdx = prevIdx - 1;
              if (targetIdx >= 0 && onRequestFocus) {
                onRequestFocus({ idx: targetIdx, atEnd: true });
              }
            }
          }
        }}
      />
    );
  });
}

function BlockItem({ item, id, index, onChange, onDelete, onInsertAfter }) {
  // focusReq: { idx: number, atEnd: boolean } | null
  const [focusReq, setFocusReq] = useState(null);
  const [newOid, setNewOid] = useState('');
  const [isFetchingProduct, setIsFetchingProduct] = useState(false);
  const [toolbarPos, setToolbarPos] = useState(null);
  const [selection, setSelection] = useState(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleAddProduct = async () => {
    if (!newOid.trim()) return;
    setIsFetchingProduct(true);
    let finalId = newOid.trim();
    let productData = { $oid: finalId };

    // If it looks like a URL, fetch metadata
    if (finalId.includes('plush.shop/')) {
      try {
        const res = await fetch('/api/fetch-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: finalId })
        });
        const data = await res.json();
        if (!data.error) {
          productData = data;
        } else {
          // Fallback to extraction if API fails
          if (finalId.includes('/')) finalId = finalId.split('/').pop().split('?')[0];
          productData = { $oid: finalId };
        }
      } catch (e) {
        if (finalId.includes('/')) finalId = finalId.split('/').pop().split('?')[0];
        productData = { $oid: finalId };
      }
    } else {
      // Just an OID
      productData = { $oid: finalId };
    }

    const newItems = [...(item.items || []), productData];
    handleTextEdit('items', newItems);
    setNewOid('');
    setIsFetchingProduct(false);
  };

  const handleFormat = (type, value = true) => {
    if (!selection || !item.segments) return;
    const { start, end, segment } = selection;
    const segments = [...item.segments];
    const segIdx = segments.findIndex(s => s === segment);
    if (segIdx === -1) return;

    const target = segments[segIdx];
    const content = target.content || '';
    
    const before = content.slice(0, start);
    const middle = content.slice(start, end);
    const after = content.slice(end);

    const newPieces = [];
    if (before) newPieces.push({ ...target, content: before });
    
    // Middle piece gets the new format
    const middlePiece = { ...target, content: middle };
    if (type === 'link') middlePiece.link = value;
    else middlePiece[type] = !middlePiece[type];
    newPieces.push(middlePiece);

    if (after) newPieces.push({ ...target, content: after });

    segments.splice(segIdx, 1, ...newPieces);
    
    // Simple normalization: merge adjacent segments with same formatting
    const normalized = [];
    for (const s of segments) {
      const last = normalized[normalized.length - 1];
      const isBreak = s.content === '\n' || s.content === '\n\n';
      const lastIsBreak = last?.content === '\n' || last?.content === '\n\n';

      if (!isBreak && !lastIsBreak && last && JSON.stringify({...last, content: ''}) === JSON.stringify({...s, content: ''})) {
        last.content += s.content;
      } else {
        normalized.push(s);
      }
    }

    onChange({ ...item, segments: normalized });
    setToolbarPos(null);
    setSelection(null);
  };

  const iconMap = {
    Subtitle: Heading2,
    Paragraph: Type,
    List: ListIcon,
    Image: ImageIcon,
    Table: TableIcon,
    PlushSearchCarousel: Sparkles,
  };
  const Icon = iconMap[item.type] || Type;

  const handleTextEdit = (field, value) => {
    onChange({ ...item, [field]: value });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border border-slate-200 rounded-xl p-4 mb-3 shadow-sm flex items-start gap-4 transition-shadow hover:shadow-md group relative"
    >
      <FloatingToolbar 
        position={toolbarPos} 
        activeFormats={{
          bold: selection?.segment?.bold,
          italic: selection?.segment?.italic,
          link: !!selection?.segment?.link
        }}
        onFormat={handleFormat} 
      />

      <div
        {...attributes}
        {...listeners}
        className="cursor-grab p-1 text-slate-400 hover:text-indigo-600 transition-colors mt-1 shrink-0"
      >
        <GripVertical size={20} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 uppercase tracking-wider">
            <Icon size={14} />
            {item.type}
          </div>
          <button
            onClick={onDelete}
            title="Remove block"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* Subtitle */}
        {item.type === 'Subtitle' && (
          <p
            className="text-slate-800 font-semibold text-lg cursor-text outline-none px-1 -mx-1 hover:bg-slate-50 focus:bg-indigo-50 focus:ring-1 focus:ring-indigo-300 rounded transition-colors"
            contentEditable
            suppressContentEditableWarning
            onBlur={e => {
              if (e.target.innerText !== item.content) {
                handleTextEdit('content', e.target.innerText);
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          >
            {item.content || ''}
          </p>
        )}

        {/* Paragraph */}
        {item.type === 'Paragraph' && (
          <div className="text-slate-600 text-sm leading-relaxed">
            {renderSegments(
              item.segments,
              (newSegments) => {
                const cleaned = newSegments.filter(s => s.content !== '' || s.type);
                handleTextEdit('segments', cleaned);
              },
              focusReq,
              (req) => setFocusReq(req),
              (pos) => {
                setToolbarPos(pos);
                setSelection(pos);
              }
            )}
          </div>
        )}

        {/* List (Standalone fallback) */}
        {item.type === 'List' && (
          <ul className={`${item.ordered ? 'list-decimal' : 'list-disc'} list-inside text-slate-600 text-sm pl-2 space-y-1`}>
            {item.items?.map((li, i) => (
              <li key={i}>{renderSegments(li.segments, null, null, null, (pos) => {
                setToolbarPos(pos);
                setSelection(pos);
              })}</li>
            ))}
          </ul>
        )}

        {/* Image */}
        {item.type === 'Image' && (
          <div className="space-y-2.5 mt-1">
            {/* Image Preview */}
            {item.url && !item.url.startsWith('From drive:') ? (
              <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50" style={{maxHeight:'120px'}}>
                <img
                  src={item.url}
                  alt={item.altText || ''}
                  className="w-full object-cover"
                  style={{maxHeight:'120px'}}
                  onError={e => { e.target.parentElement.style.display = 'none'; }}
                />
              </div>
            ) : item.url && item.url.startsWith('From drive:') ? (
              <div
                className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                style={{minHeight:'56px'}}
              >
                <div
                  className="flex items-center justify-center rounded-md shrink-0"
                  style={{width:'36px',height:'36px',background:'linear-gradient(135deg,#4285F4 0%,#34A853 50%,#FBBC05 75%,#EA4335 100%)'}}
                >
                  <svg width="18" height="18" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" aria-label="Google Drive">
                    <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                    <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                    <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                    <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                    <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                    <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Google Drive</p>
                  <p className="text-xs font-mono text-slate-600 truncate">{item.url.replace('From drive: ', '').replace('From drive:', '')}</p>
                </div>
              </div>
            ) : (
              <div
                className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300"
                style={{height:'56px'}}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="No image">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-8">URL</span>
              <input
                className="flex-1 font-mono text-slate-500 text-xs bg-slate-50 border border-slate-200 rounded hover:border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors"
                value={item.url || ''}
                placeholder="Image URL..."
                onChange={e => handleTextEdit('url', e.target.value)}
              />
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-8 mt-2">ALT</span>
              <textarea
                className="flex-1 text-slate-700 text-sm bg-slate-50 border border-slate-200 rounded hover:border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors resize-none overflow-hidden"
                value={item.altText || ''}
                placeholder="Add alt text..."
                ref={el => {
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = el.scrollHeight + 'px';
                  }
                }}
                onChange={e => handleTextEdit('altText', e.target.value)}
                rows={1}
              />
            </div>
          </div>
        )}

        {/* PlushSearchCarousel */}
        {item.type === 'PlushSearchCarousel' && (
          <div className="space-y-3 mt-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12">Query</span>
              <input
                className="flex-1 text-slate-700 text-xs bg-slate-50 border border-slate-200 rounded hover:border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors font-mono"
                value={item.query || ''}
                placeholder="Search query..."
                onChange={e => handleTextEdit('query', e.target.value)}
              />
              <button
                type="button"
                disabled={isFetchingProduct || !item.query}
                title="Fetch products via Plush chat (opens Chrome briefly for verification)"
                onClick={async () => {
                  if (!item.query) return;
                  setIsFetchingProduct(true);
                  try {
                    const res = await fetch('/api/fetch-carousel', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ query: item.query }),
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    if (!data.oids?.length) {
                      throw new Error(data.error || 'No products returned from chat search. Try Fetch again.');
                    }
                    handleTextEdit('items', data.oids);
                  } catch (err) {
                    alert('Failed to fetch products: ' + err.message);
                  } finally {
                    setIsFetchingProduct(false);
                  }
                }}
                className="shrink-0 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[10px] font-semibold px-2 py-1.5 rounded transition-colors disabled:opacity-50"
              >
                {isFetchingProduct ? 'Chat…' : 'Fetch'}
              </button>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2 mt-4 inline-block w-full">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Product Slider ({item.items?.length || 0})</span>
                <div className="flex items-center gap-1.5 float-right">
                  <input
                    type="text"
                    placeholder="Paste URL or OID..."
                    value={newOid}
                    disabled={isFetchingProduct}
                    onChange={(e) => setNewOid(e.target.value)}
                    className="text-[10px] font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded px-1.5 py-1 w-36 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors disabled:opacity-50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddProduct();
                      }
                    }}
                  />
                  <button
                    onClick={handleAddProduct}
                    disabled={isFetchingProduct}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-semibold px-2 py-1 rounded transition-colors disabled:opacity-50 min-w-[60px]"
                  >
                    {isFetchingProduct ? '...' : 'Add ID'}
                  </button>
                </div>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 snap-x hide-scrollbar">
                {item.items?.map((oidObj, oidIdx) => (
                  <div key={oidIdx} className="snap-start shrink-0 relative group/card w-[104px] bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm hover:border-indigo-300 hover:shadow-md transition-all">
                    {/* Product Image */}
                    <div className="bg-slate-100 w-full h-32 flex items-center justify-center text-slate-300 overflow-hidden relative group-hover/card:bg-slate-50 transition-colors">
                      {oidObj.imageUrl ? (
                         <img src={oidObj.imageUrl} alt={oidObj.name || 'Product'} className="w-full h-full object-cover" />
                      ) : (
                         <ImageIcon size={24} className="opacity-60" />
                      )}
                    </div>
                    {/* Details */}
                    <div className="p-1.5 pt-2 flex flex-col justify-between bg-white h-[54px] border-t border-slate-100">
                      <p className="text-[9px] text-slate-700 font-medium leading-[1.1] line-clamp-2" title={oidObj.name || `Product`}>
                        {oidObj.name || `Product`}
                      </p>
                      <p className="text-[8px] text-slate-400 font-mono mt-1 w-full truncate">
                        ID: {oidObj.$oid}
                      </p>
                    </div>

                    {/* Delete button */}
                    <button
                      title="Remove"
                      onClick={() => {
                        const newItems = item.items.filter((_, i) => i !== oidIdx);
                        handleTextEdit('items', newItems);
                      }}
                      className="absolute top-1.5 right-1.5 bg-white/90 backdrop-blur-sm text-slate-400 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 p-1 rounded-full transition-all opacity-0 group-hover/card:opacity-100 shadow-sm"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {(!item.items || item.items.length === 0) && (
                  <div className="text-xs text-slate-400 italic py-4 w-full flex justify-center items-center h-32 border-2 border-dashed border-slate-100 rounded-lg">No products in carousel</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        {item.type === 'Table' && (
          <div className="overflow-x-auto">
            <table className="text-sm text-slate-600 border border-slate-200 rounded w-full">
              <tbody>
                {item.rows?.map((row, ri) => (
                  <tr key={ri} className={ri === 0 ? 'bg-slate-50 font-semibold' : ''}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-slate-200 px-2 py-1">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EditorWorkspace({ data, onChange }) {
  const items = data?.content || [];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((_, index) => `block-${index}` === active.id);
    const newIndex = items.findIndex((_, index) => `block-${index}` === over.id);

    const newContent = arrayMove(items, oldIndex, newIndex);
    onChange({ ...data, content: newContent });
  };

  const handleBlockChange = (index, updatedItem) => {
    const newContent = [...items];
    newContent[index] = updatedItem;
    onChange({ ...data, content: newContent });
  };

  const handleInsertAfter = (index, newBlock) => {
    const newContent = [...items];
    newContent.splice(index + 1, 0, newBlock);
    onChange({ ...data, content: newContent });
  };

  if (!items.length) {
    return (
      <div className="text-slate-500 p-8 text-center border-2 border-dashed border-slate-200 rounded-xl">
        No blocks extracted yet. Fetch a document first.
      </div>
    );
  }

  return (
    <div>
      {/* Global Meta Editor */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-4 mb-6 shadow-sm">
        <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block mb-1.5 ml-1">SEO URL</label>
        <input 
          className="w-full text-indigo-900 text-sm bg-white border border-indigo-200 rounded-md px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-mono shadow-inner"
          value={data?.seo_url || ''}
          onChange={(e) => onChange({ ...data, seo_url: e.target.value })}
          placeholder="e.g. polished-everyday-dresses"
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <InsertPoint onInsert={(newBlock) => {
           const newContent = [newBlock, ...items];
           onChange({ ...data, content: newContent });
        }} />
        <SortableContext
          items={items.map((_, i) => `block-${i}`)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item, index) => (
            <React.Fragment key={`block-frag-${index}`}>
              <BlockItem
                key={`block-${index}`}
                id={`block-${index}`}
                item={item}
                index={index}
                onChange={(updated) => handleBlockChange(index, updated)}
                onInsertAfter={(newBlock) => handleInsertAfter(index, newBlock)}
                onDelete={() => {
                  const newContent = items.filter((_, i) => i !== index);
                  onChange({ ...data, content: newContent });
                }}
              />
              <InsertPoint onInsert={(newBlock) => handleInsertAfter(index, newBlock)} />
            </React.Fragment>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
