import { Clock, MessageSquare, X } from 'lucide-react';

const parseMemos = (rawMemo) => {
    if (!rawMemo) return [];
    try {
        const parsed = JSON.parse(rawMemo);
        return Array.isArray(parsed) ? parsed : [{ id: 'legacy', text: rawMemo, date: '' }];
    } catch {
        return [{ id: 'legacy', text: rawMemo, date: '' }];
    }
};

/** 메모 모달 */
export default function MemoModal({ student, onClose, onDelete }) {
    const memos = parseMemos(student.checks?.memos?.toDesk);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-[32px] shadow-[0_32px_80px_rgba(0,0,0,0.3)] w-full max-w-md overflow-hidden">
                {/* 헤더 */}
                <div className="px-8 py-6 border-b border-black/[0.05] flex items-center justify-between bg-zinc-50/50">
                    <div>
                        <h3 className="text-xl font-black text-black tracking-tighter">{student.name}</h3>
                        <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest leading-none mt-1">
                            Student Memos
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5 text-black/20 hover:text-black transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 메모 목록 */}
                <div className="p-8 max-h-[60vh] overflow-y-auto">
                    {memos.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 text-zinc-300">
                                <MessageSquare size={24} />
                            </div>
                            <p className="text-sm font-bold text-zinc-400">저장된 메모가 없습니다.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {memos.map((memo, idx) => (
                                <div
                                    key={memo.id || idx}
                                    className="group relative bg-zinc-50 hover:bg-zinc-100/80 p-5 rounded-2xl border border-black/5 transition-all"
                                >
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="flex-1">
                                            <p className="text-[13px] font-medium text-black/80 leading-relaxed whitespace-pre-wrap">
                                                {memo.text}
                                            </p>
                                            {memo.date && (
                                                <div className="mt-3 flex items-center gap-1.5 text-black/20">
                                                    <Clock size={10} />
                                                    <span className="text-[9px] font-bold uppercase tracking-wider">
                                                        {new Date(memo.date).toLocaleString('ko-KR', {
                                                            month: 'long',
                                                            day: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                            hour12: false,
                                                        })}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => confirm('이 메모를 삭제하시겠습니까?') && onDelete(memo.id)}
                                            className="w-8 h-8 rounded-xl bg-white shadow-sm border border-black/5 flex items-center justify-center text-red-400 hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 닫기 버튼 */}
                <div className="p-8 pt-0">
                    <button
                        onClick={onClose}
                        className="w-full h-14 bg-black text-white rounded-2xl text-sm font-black hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-[0.98]"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
