import { useState, useMemo } from 'react';
import {
    Users, CheckSquare, MessageSquare, Save, Search, Filter,
    MoreHorizontal, ChevronRight, Check, X, AlertTriangle,
    ChevronDown, Copy, Send, LogOut, Clock, Calendar
} from 'lucide-react';

// Mock Data based on gemini.md
const INITIAL_SESSIONS = [
    {
        id: "101",
        studentId: "st_001",
        name: "김철수 (Student A)",
        class: "Middle-A",
        time: "15:00",
        type: "Regular Class",
        status: "attendance",
        backlogCount: 2,
        lastEditedBy: "Teacher Kim",
        checks: {
            basic: { voca: "o", idiom: "none", step3: "none", isc: "none" },
            homework: { reading: "o", grammar: "none", practice: "none", listening: "none", etc: "none" },
            review: { reading: "none", grammar: "none", practice: "none", listening: "none" },
            nextHomework: { reading: "Ch.1-5", grammar: "p.20-30", practice: "", listening: "", extra: "" },
            memos: { toDesk: "", fromDesk: "Please check reading", toParent: "Doing great today!" },
            homeworkResult: "none",
            summaryConfirmed: false
        }
    },
    {
        id: "102",
        studentId: "st_002",
        name: "이영희 (Student B)",
        class: "High-B",
        time: "15:00",
        type: "Test",
        status: "late",
        backlogCount: 6,
        lastEditedBy: "Teacher Park",
        checks: {
            basic: { voca: "none", idiom: "none", step3: "none", isc: "none" },
            homework: { reading: "triangle", grammar: "none", practice: "none", listening: "none", etc: "none" },
            review: { reading: "none", grammar: "none", practice: "none", listening: "none" },
            nextHomework: { reading: "", grammar: "", practice: "", listening: "", extra: "" },
            memos: { toDesk: "", fromDesk: "", toParent: "" },
            homeworkResult: "none",
            summaryConfirmed: false
        }
    },
    {
        id: "103",
        studentId: "st_003",
        name: "박민수 (Student C)",
        class: "Elementary-C",
        time: "16:30",
        type: "Clinic",
        status: "absent",
        backlogCount: 0,
        lastEditedBy: "Teacher Lee",
        checks: {
            basic: { voca: "none", idiom: "none", step3: "none", isc: "none" },
            homework: { reading: "none", grammar: "none", practice: "none", listening: "none", etc: "none" },
            review: { reading: "none", grammar: "none", practice: "none", listening: "none" },
            nextHomework: { reading: "", grammar: "", practice: "", listening: "", extra: "" },
            memos: { toDesk: "", fromDesk: "", toParent: "" },
            homeworkResult: "none",
            summaryConfirmed: false
        }
    }
];

const getStatusColor = (status) => {
    switch (status) {
        case 'attendance': return 'bg-green-500/10 text-green-500 border-green-500/20';
        case 'late': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        case 'absent': return 'bg-red-500/10 text-red-500 border-red-500/20';
        case 'waiting': return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
        default: return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
    }
};

const CheckStatusIcon = ({ status, size = 16 }) => {
    if (status === 'o') return <div className="w-5 h-5 rounded-full bg-green-500 text-[#09090b] flex items-center justify-center"><Check size={size} strokeWidth={3} /></div>;
    if (status === 'triangle') return <div className="w-5 h-5 rounded-full bg-yellow-500 text-[#09090b] flex items-center justify-center font-bold text-[10px]">▲</div>;
    if (status === 'x') return <div className="w-5 h-5 rounded-full bg-red-500 text-[#09090b] flex items-center justify-center"><X size={size} strokeWidth={3} /></div>;
    return <div className="w-5 h-5 rounded-full bg-zinc-900 border border-zinc-800"></div>;
};

export default function Dashboard() {
    const [sessions, setSessions] = useState(INITIAL_SESSIONS);
    const [selectedSessionIds, setSelectedSessionIds] = useState(new Set());
    const [showDetailPanel, setShowDetailPanel] = useState(false);
    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [isSyncing, setIsSyncing] = useState(false);

    const GAS_URL = "https://script.google.com/macros/s/AKfycbzup4-XNufGlQ2m-u9RTfUBsTrwz9FBhZCjNwpjNV--dt4jGdjfEbZ-hiFcKoLq69MhDA/exec";

    const currentSession = useMemo(() => sessions.find(s => s.id === currentSessionId), [sessions, currentSessionId]);

    const toggleSelection = (id) => {
        const newSet = new Set(selectedSessionIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedSessionIds(newSet);
    };

    const selectAll = () => {
        if (selectedSessionIds.size === sessions.length) setSelectedSessionIds(new Set());
        else setSelectedSessionIds(new Set(sessions.map(s => s.id)));
    };

    const openDetail = (id) => {
        setCurrentSessionId(id);
        setShowDetailPanel(true);
    };

    /**
     * Bulk Action Logic
     */
    const handleBulkUpdate = (category, item, value) => {
        if (selectedSessionIds.size === 0) return;

        setSessions(prev => prev.map(session => {
            if (selectedSessionIds.has(session.id)) {
                const newChecks = { ...session.checks };
                if (item) {
                    newChecks[category] = { ...newChecks[category], [item]: value };
                } else {
                    newChecks[category] = value;
                }
                return { ...session, checks: newChecks };
            }
            return session;
        }));
        setSelectedSessionIds(new Set()); // Auto-deselect as per UX flow
    };

    /**
     * Individual Update Logic
     */
    const updateSessionData = (sessionId, path, value) => {
        setSessions(prev => prev.map(s => {
            if (s.id === sessionId) {
                const newSession = JSON.parse(JSON.stringify(s));
                // Simple manual path traversal for this specific structure
                const keys = path.split('.');
                let current = newSession;
                for (let i = 0; i < keys.length - 1; i++) {
                    current = current[keys[i]];
                }
                current[keys[keys.length - 1]] = value;
                return newSession;
            }
            return s;
        }));
    };

    /**
     * LMS Generation Logic
     */
    const generateLMS = (session) => {
        if (!session) return "";
        const date = new Date().toLocaleDateString('ko-KR');
        let message = `[IMPACT7 English] ${session.name} Report\n\n`;

        message += `■ Status: ${session.status.toUpperCase()}\n\n`;

        const statusMap = { 'o': '●', 'triangle': '▲', 'x': '×' };
        const categories = [
            { key: 'basic', label: 'Basic Checks' },
            { key: 'homework', label: 'Homework Status' },
            { key: 'review', label: 'Review Test' }
        ];

        categories.forEach(cat => {
            const items = Object.entries(session.checks[cat.key])
                .filter(([_, val]) => val !== 'none')
                .map(([key, val]) => `- ${key.toUpperCase()}: ${statusMap[val] || val}`)
                .join('\n');
            if (items) message += `■ ${cat.label}\n${items}\n\n`;
        });

        const nextHw = Object.entries(session.checks.nextHomework)
            .filter(([_, val]) => val.trim() !== "")
            .map(([key, val]) => `- ${key.toUpperCase()}: ${val}`)
            .join("\n");
        if (nextHw) message += `■ Next Homework\n${nextHw}\n\n`;

        if (session.checks.memos.toParent.trim()) {
            message += `■ Memo to Parents\n${session.checks.memos.toParent}\n\n`;
        }

        message += `Writer: ${session.lastEditedBy}`;
        return message;
    };

    /**
     * Checkout Logic (Gatekeeper)
     */
    const canCheckout = (session) => {
        if (!session) return false;
        // Condition A: basic, homework, review must not have 'x' or 'triangle'
        const categories = ['basic', 'homework', 'review'];
        for (const cat of categories) {
            if (Object.values(session.checks[cat]).some(val => val === 'x' || val === 'triangle')) return false;
        }
        // Condition B: summaryConfirmed is true
        return session.checks.summaryConfirmed;
    };

    const sendDataToGAS = async (data, retryCount = 0) => {
        setIsSyncing(true);
        try {
            const response = await fetch(GAS_URL, {
                method: 'POST',
                mode: 'no-cors', // Normal for GAS Web Apps
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: new Date().toISOString().split('T')[0],
                    timestamp: new Date().toISOString(),
                    ...data
                })
            });
            console.log("Data sent to GAS successfully");
            return true;
        } catch (error) {
            console.error(`Sync failed (Attempt ${retryCount + 1}):`, error);
            if (retryCount < 5) {
                const delay = Math.pow(2, retryCount) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                return sendDataToGAS(data, retryCount + 1);
            }
            alert("서버 연결에 실패했습니다. 네트워크 상태를 확인해주세요.");
            return false;
        } finally {
            setIsSyncing(false);
        }
    };

    const handleCheckout = async (session) => {
        if (!canCheckout(session)) {
            alert("진행 중인 학습에 'X' 또는 '△'가 남아있거나, 최종 확인이 완료되지 않았습니다.");
            return;
        }

        const success = await sendDataToGAS(session);
        if (success) {
            alert(`${session.name} 학생의 귀가가 승인되었습니다. 구글 시트 저장이 완료되었습니다.`);
            setShowDetailPanel(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="flex h-screen bg-background text-foreground font-sans antialiased overflow-hidden">
            {/* Sidebar - Density focused */}
            <aside className="w-[240px] border-r border-border bg-[#09090b] flex flex-col">
                <div className="p-6">
                    <div className="flex items-center gap-2 group cursor-pointer">
                        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-[0_0_15px_-3px_rgba(99,102,241,0.6)]">
                            <span className="text-white font-black text-xs">I7</span>
                        </div>
                        <span className="font-bold tracking-tight text-lg">IMPACT7<span className="text-zinc-600">DSC</span></span>
                    </div>
                </div>

                <nav className="flex-1 px-3 space-y-1">
                    <NavItem icon={<Clock size={16} />} label="Timeline" active />
                    <NavItem icon={<AlertTriangle size={16} />} label="Backlog" badge="8" />
                    <NavItem icon={<Users size={16} />} label="Students" />
                    <NavItem icon={<Calendar size={16} />} label="History" />
                </nav>

                <div className="p-4 border-t border-border">
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer transition-colors">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700"></div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">Teacher Kim</p>
                            <p className="text-xs text-zinc-500 truncate">Main Instructor</p>
                        </div>
                        <LogOut size={14} className="text-zinc-600" />
                    </div>
                </div>
            </aside>

            {/* Main List */}
            <main className="flex-1 flex flex-col bg-[#09090b]">
                <header className="h-16 border-b border-border flex items-center px-8 justify-between bg-background/50 backdrop-blur-md sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-semibold tracking-tight">Today's Sessions</h1>
                        <div className="h-4 w-px bg-zinc-800"></div>
                        <p className="text-sm text-zinc-500 font-medium">{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                            <input placeholder="Search students..." className="h-9 w-64 bg-zinc-900/50 border border-zinc-800 rounded-md pl-9 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-700 transition-all placeholder:text-zinc-600" />
                        </div>
                        <button className="h-9 px-3 bg-zinc-900 border border-zinc-800 rounded-md text-sm font-medium text-zinc-400 hover:text-white transition-colors flex items-center gap-2"><Filter size={14} /> Filter</button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-8 relative">
                    {/* Bulk Action Bar */}
                    {selectedSessionIds.size > 0 && (
                        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/50 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-2xl px-6 py-4 flex items-center gap-8 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300">
                            <div className="flex items-center gap-3 pr-6 border-r border-zinc-800">
                                <span className="text-white font-bold">{selectedSessionIds.size}</span>
                                <span className="text-zinc-500 text-sm font-medium">Selected</span>
                            </div>

                            <div className="flex gap-10">
                                <BulkGroup label="Voca" onUpdate={(val) => handleBulkUpdate('basic', 'voca', val)} />
                                <BulkGroup label="Homework" onUpdate={(val) => handleBulkUpdate('homework', 'reading', val)} />
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleBulkUpdate('summaryConfirmed', null, true)} className="h-9 px-4 bg-indigo-600 rounded-lg text-sm font-bold shadow-lg shadow-indigo-500/20">Bulk Confirm</button>
                                </div>
                            </div>

                            <button onClick={() => setSelectedSessionIds(new Set())} className="ml-4 p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-500 hover:text-white"><X size={18} /></button>
                        </div>
                    )}

                    <div className="max-w-6xl mx-auto space-y-2">
                        <div className="grid grid-cols-[48px_1.5fr_1fr_1fr_1fr_48px] gap-4 px-6 py-3 text-[11px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-900">
                            <div className="flex justify-center"><input type="checkbox" className="w-4 h-4 rounded border-zinc-800 bg-zinc-900 accent-indigo-600" checked={selectedSessionIds.size === sessions.length} onChange={selectAll} /></div>
                            <div>Student / Class</div>
                            <div>Status</div>
                            <div>Checks</div>
                            <div>Last Edit</div>
                            <div></div>
                        </div>

                        {sessions.map(s => (
                            <div key={s.id}
                                onClick={() => openDetail(s.id)}
                                className={`grid grid-cols-[48px_1.5fr_1fr_1fr_1fr_48px] gap-4 px-6 py-4 rounded-xl items-center border transition-all cursor-pointer group ${selectedSessionIds.has(s.id) ? 'bg-indigo-500/[0.03] border-indigo-500/20' : 'bg-transparent border-transparent hover:bg-zinc-900/40 hover:border-zinc-800/50'}`}
                            >
                                <div className="flex justify-center" onClick={e => e.stopPropagation()}>
                                    <input type="checkbox" className="w-4 h-4 rounded-md border-zinc-700 bg-zinc-900 accent-indigo-600" checked={selectedSessionIds.has(s.id)} onChange={() => toggleSelection(s.id)} />
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-zinc-300 group-hover:bg-indigo-600/20 group-hover:border-indigo-500/50 transition-all">{s.name.substring(0, 1)}</div>
                                    <div>
                                        <p className="font-bold text-zinc-100">{s.name}</p>
                                        <p className="text-xs text-zinc-500 font-medium">{s.class} • {s.time}</p>
                                    </div>
                                </div>
                                <div>
                                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black border border-current bg-opacity-10 ring-1 ring-inset ${getStatusColor(s.status)}`}>{s.status.toUpperCase()}</span>
                                </div>
                                <div className="flex gap-1.5 grayscale opacity-50 group-hover:grayscale-0 group-hover:opacity-100 transition-all">
                                    <CheckStatusIcon status={s.checks.basic.voca} size={12} />
                                    <CheckStatusIcon status={s.checks.homework.reading} size={12} />
                                    {s.backlogCount > 5 && <div className="ml-2 flex items-center text-red-500 text-[10px] font-black gap-0.5 animate-pulse"><AlertTriangle size={12} /> {s.backlogCount}</div>}
                                </div>
                                <div className="text-sm text-zinc-500 font-medium">{s.lastEditedBy}</div>
                                <div className="text-zinc-700 group-hover:text-zinc-400 transition-colors"><ChevronRight size={20} /></div>
                            </div>
                        ))}
                    </div>
                </div>
            </main>

            {/* Side Over Detail Panel */}
            {showDetailPanel && currentSession && (
                <>
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity" onClick={() => setShowDetailPanel(false)}></div>
                    <div className="fixed inset-y-0 right-0 w-[520px] bg-[#18181b] border-l border-zinc-800 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
                        <header className="h-16 border-b border-zinc-800 px-8 flex items-center justify-between bg-card/80 backdrop-blur-md">
                            <div className="flex items-center gap-4">
                                <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
                                <h2 className="font-bold text-lg tracking-tight">{currentSession.name}</h2>
                            </div>
                            <button onClick={() => setShowDetailPanel(false)} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-500 transition-colors"><X size={20} /></button>
                        </header>

                        <div className="flex-1 overflow-y-auto p-8 space-y-10">
                            {/* Actions */}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => updateSessionData(currentSession.id, 'checks.summaryConfirmed', true)}
                                    className={`flex-1 h-12 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 border ${currentSession.checks.summaryConfirmed ? 'bg-green-500/20 border-green-500 text-green-500' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}
                                >
                                    {currentSession.checks.summaryConfirmed ? <Check size={18} /> : null} Confirm Summary
                                </button>
                                <button
                                    onClick={() => handleCheckout(currentSession)}
                                    disabled={isSyncing}
                                    className={`flex-1 h-12 rounded-xl font-bold text-sm transition-all shadow-[0_10px_20px_-5px_rgba(99,102,241,0.5)] flex items-center justify-center gap-2 ${isSyncing ? 'bg-zinc-700 cursor-not-allowed text-zinc-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                                >
                                    {isSyncing ? (
                                        <div className="w-5 h-5 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>
                                    ) : (
                                        <LogOut size={16} />
                                    )}
                                    {isSyncing ? 'Syncing...' : 'Final Checkout'}
                                </button>
                            </div>

                            {/* Status Section */}
                            <section className="space-y-4">
                                <SectionTitle title="Learning Checks" />
                                <div className="grid grid-cols-1 gap-3">
                                    <CheckRow
                                        label="Vocabulary"
                                        value={currentSession.checks.basic.voca}
                                        onChange={(v) => updateSessionData(currentSession.id, 'checks.basic.voca', v)}
                                    />
                                    <CheckRow
                                        label="Reading Hw"
                                        value={currentSession.checks.homework.reading}
                                        onChange={(v) => updateSessionData(currentSession.id, 'checks.homework.reading', v)}
                                    />
                                    <CheckRow
                                        label="Grammar Hw"
                                        value={currentSession.checks.homework.grammar}
                                        onChange={(v) => updateSessionData(currentSession.id, 'checks.homework.grammar', v)}
                                    />
                                </div>
                            </section>

                            {/* Next Homework */}
                            <section className="space-y-4">
                                <SectionTitle title="Next Homework" />
                                <div className="grid grid-cols-2 gap-4">
                                    <HwInput label="Reading" value={currentSession.checks.nextHomework.reading} onChange={v => updateSessionData(currentSession.id, 'checks.nextHomework.reading', v)} />
                                    <HwInput label="Grammar" value={currentSession.checks.nextHomework.grammar} onChange={v => updateSessionData(currentSession.id, 'checks.nextHomework.grammar', v)} />
                                </div>
                            </section>

                            {/* Communication */}
                            <section className="space-y-4">
                                <SectionTitle title="Memos" />
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-2 block">To Parents</label>
                                        <textarea
                                            value={currentSession.checks.memos.toParent}
                                            onChange={e => updateSessionData(currentSession.id, 'checks.memos.toParent', e.target.value)}
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-700 min-h-[100px] resize-none"
                                        />
                                    </div>
                                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4">
                                        <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1 block">From Desk (Internal)</label>
                                        <p className="text-sm text-zinc-400">{currentSession.checks.memos.fromDesk || "No messages from administration."}</p>
                                    </div>
                                </div>
                            </section>

                            {/* LMS Preview */}
                            <section className="bg-zinc-900/50 rounded-2xl p-6 border border-zinc-800 space-y-4 mt-8">
                                <div className="flex items-center justify-between">
                                    <SectionTitle title="LMS Prediction" noMargin />
                                    <button
                                        onClick={() => copyToClipboard(generateLMS(currentSession))}
                                        className="h-8 px-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-bold text-zinc-300 transition-colors flex items-center gap-2"
                                    >
                                        <Copy size={12} /> Copy
                                    </button>
                                </div>
                                <pre className="text-[11px] font-mono leading-relaxed text-zinc-500 bg-black/40 p-4 rounded-xl overflow-x-auto">
                                    {generateLMS(currentSession)}
                                </pre>
                            </section>
                        </div>

                        <div className="p-8 bg-card border-t border-zinc-800">
                            <button className="w-full h-14 bg-zinc-100 hover:bg-white text-zinc-950 font-black rounded-xl transition-all flex items-center justify-center gap-2 group">
                                <Save size={20} className="group-hover:scale-110 transition-transform" /> SAVE ALL DATA
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// Subcomponents
function NavItem({ icon, label, active, badge }) {
    return (
        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${active ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'}`}>
            {icon}
            <span className="text-sm font-bold flex-1">{label}</span>
            {badge && <span className="bg-red-500/20 text-red-500 text-[10px] font-black px-1.5 py-0.5 rounded-full">{badge}</span>}
        </div>
    );
}

function SectionTitle({ title, noMargin }) {
    return <h3 className={`text-xs font-black text-zinc-400 uppercase tracking-widest ${noMargin ? '' : 'mb-4'}`}>{title}</h3>;
}

function CheckRow({ label, value, onChange }) {
    const options = [
        { id: 'o', icon: <Check size={14} />, color: 'peer-checked:bg-green-500 peer-checked:text-[#09090b]' },
        { id: 'triangle', icon: <span className="text-[10px] font-bold">▲</span>, color: 'peer-checked:bg-yellow-500 peer-checked:text-[#09090b]' },
        { id: 'x', icon: <X size={14} />, color: 'peer-checked:bg-red-500 peer-checked:text-[#09090b]' },
        { id: 'none', icon: <CheckSquare size={14} />, color: 'peer-checked:bg-zinc-700 peer-checked:text-zinc-100' }
    ];

    return (
        <div className="flex items-center justify-between p-4 bg-zinc-900 rounded-xl border border-zinc-800/50">
            <span className="text-sm font-bold text-zinc-300">{label}</span>
            <div className="flex gap-2">
                {options.map(opt => (
                    <label key={opt.id} className="cursor-pointer">
                        <input type="radio" name={label} value={opt.id} checked={value === opt.id} onChange={() => onChange(opt.id)} className="hidden peer" />
                        <div className={`w-10 h-10 rounded-lg bg-zinc-800 text-zinc-600 flex items-center justify-center transition-all ${opt.color} hover:bg-zinc-700`}>
                            {opt.icon}
                        </div>
                    </label>
                ))}
            </div>
        </div>
    );
}

function HwInput({ label, value, onChange }) {
    return (
        <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800">
            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1 block">{label}</label>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full bg-transparent text-sm text-zinc-200 focus:outline-none"
                placeholder="..."
            />
        </div>
    );
}

function BulkGroup({ label, onUpdate }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{label}</span>
            <div className="flex gap-1.5">
                <button onClick={() => onUpdate('o')} className="w-8 h-8 rounded-lg bg-green-500/10 text-green-500 border border-green-500/20 flex items-center justify-center hover:bg-green-500/20 transition-all"><Check size={14} /></button>
                <button onClick={() => onUpdate('triangle')} className="w-8 h-8 rounded-lg bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 flex items-center justify-center hover:bg-yellow-500/20 transition-all font-bold text-[10px]">▲</button>
                <button onClick={() => onUpdate('x')} className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 transition-all"><X size={14} /></button>
            </div>
        </div>
    );
}
