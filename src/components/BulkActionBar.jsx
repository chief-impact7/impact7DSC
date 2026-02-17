import { X } from 'lucide-react';

const COURSEWORK_AREAS = [
    { key: 'reading',   label: 'R' },
    { key: 'grammar',   label: 'G' },
    { key: 'practice',  label: 'P' },
    { key: 'listening', label: 'L' },
    { key: 'etc',       label: 'E' },
];

const RETENTION_AREAS = [
    { key: 'vocab',     label: 'V' },
    { key: 'idioms',    label: 'I' },
    { key: 'verbs',     label: '3' },
    { key: 'reading',   label: 'R' },
    { key: 'grammar',   label: 'G' },
    { key: 'practice',  label: 'P' },
    { key: 'listening', label: 'L' },
    { key: 'isc',       label: 'W' },
    { key: 'etc',       label: 'E' },
];

/** 일괄 액션 플로팅 바 */
export default function BulkActionBar({
    count,
    viewMode,
    homeworkSubView,
    selectedHomeworkAreas,
    setSelectedHomeworkAreas,
    bulkMemo,
    setBulkMemo,
    onStatusUpdate,
    onHomeworkUpdate,
    onMemoUpdate,
    onClear,
}) {
    const isCoursework = ['coursework', 'retention'].includes(viewMode);
    const areas = viewMode === 'retention' ? RETENTION_AREAS : COURSEWORK_AREAS;

    return (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-2xl border border-white/40 shadow-[0_25px_60px_rgba(0,0,0,0.2)] rounded-3xl px-8 py-4 flex items-center gap-8 z-50 animate-in slide-in-from-bottom-5 ring-1 ring-black/[0.03] min-w-fit">
            {/* 선택 카운트 */}
            <div className="flex items-center gap-3 pr-6 border-r border-black/[0.08]">
                <span className="text-2xl font-black text-black/90 tracking-tighter">{count}</span>
                <div className="flex flex-col -space-y-1">
                    <span className="text-[9px] font-black text-black/30 uppercase tracking-widest leading-none">Selected</span>
                    <span className="text-[10px] font-bold text-black/60 capitalize leading-none">Students</span>
                </div>
            </div>

            {/* 액션 버튼 */}
            <div className="flex items-center gap-3">
                {isCoursework ? (
                    <>
                        {homeworkSubView !== 'next' && (
                            <select
                                className="h-9 px-3 rounded-xl bg-white border border-black/10 text-[11px] font-bold text-black focus:outline-none focus:ring-2 focus:ring-black/5"
                                onChange={e => setSelectedHomeworkAreas(e.target.value ? new Set([e.target.value]) : new Set())}
                                value={selectedHomeworkAreas.size === 1 ? Array.from(selectedHomeworkAreas)[0] : ''}
                            >
                                <option value="" disabled>영역 선택</option>
                                {areas.map(a => (
                                    <option key={a.key} value={a.key}>{a.label} ({a.key})</option>
                                ))}
                            </select>
                        )}
                        {homeworkSubView !== 'next' ? (
                            <div className="flex gap-1.5 p-1 bg-black/[0.03] rounded-2xl">
                                <BulkBtn label="완료" color="#84994F" onClick={() => onHomeworkUpdate('o')} />
                                <BulkBtn label="부실" color="#FCB53B" onClick={() => onHomeworkUpdate('triangle')} />
                                <BulkBtn label="안함" color="#B45253" onClick={() => onHomeworkUpdate('x')} />
                                <BulkBtn label="취소" color="#FFE797" textDark onClick={() => onHomeworkUpdate('none')} />
                            </div>
                        ) : (
                            <span className="text-[10px] font-bold text-black/40 px-2">일괄 메모만 가능합니다</span>
                        )}
                    </>
                ) : (
                    <>
                        <span className="text-[11px] font-black text-black/40 uppercase tracking-tighter shrink-0">일괄처리</span>
                        <div className="flex gap-1.5 p-1 bg-black/[0.03] rounded-2xl">
                            <BulkBtn label="출석" color="#84994F" onClick={() => onStatusUpdate('attendance')} />
                            <BulkBtn label="지각" color="#FCB53B" onClick={() => onStatusUpdate('late')} />
                            <BulkBtn label="결석" color="#B45253" onClick={() => onStatusUpdate('absent')} />
                            <BulkBtn label="취소" color="#FFE797" textDark onClick={() => onStatusUpdate('waiting')} />
                        </div>
                    </>
                )}
            </div>

            <div className="h-8 w-[1px] bg-black/[0.08]" />

            {/* 메모 */}
            <div className="flex items-center gap-3">
                <div className="relative">
                    <input
                        type="text"
                        value={bulkMemo}
                        onChange={e => setBulkMemo(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && onMemoUpdate()}
                        placeholder="일괄 메모 입력..."
                        className="h-10 w-56 bg-white border border-black/10 rounded-xl px-4 text-[12px] font-medium focus:outline-none focus:ring-2 focus:ring-black/5 placeholder:text-black/20"
                    />
                    <button
                        onClick={onMemoUpdate}
                        disabled={!bulkMemo.trim()}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 px-3 bg-black text-white rounded-lg text-[10px] font-black hover:bg-zinc-800 disabled:opacity-0 transition-all"
                    >
                        적용
                    </button>
                </div>
            </div>

            {/* 닫기 */}
            <div className="pl-4 border-l border-black/[0.08]">
                <button
                    onClick={onClear}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-black/20 hover:text-black hover:bg-black/5 transition-all"
                >
                    <X size={20} />
                </button>
            </div>
        </div>
    );
}

/** 일괄 버튼 */
function BulkBtn({ label, color, textDark, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`h-9 px-4 rounded-xl text-[11px] font-bold transition-all shadow-sm hover:scale-105 active:scale-95 ${textDark ? 'text-black/60 border border-black/5' : 'text-white'}`}
            style={{ backgroundColor: color }}
        >
            {label}
        </button>
    );
}
