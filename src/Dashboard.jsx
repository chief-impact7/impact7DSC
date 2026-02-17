// Dashboard.jsx 맨 위에 추가
import {
    useSessions,
    useImportHistory,
    useFilters,
    sendToGAS,
    migrateFromLocalStorage,
    normalizeSession
} from './user_log';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
    Users, MessageSquare, Save, Search,
    ChevronRight, ChevronLeft, Pin, X,
    ChevronDown, Clock, Calendar, Plus, UserPlus, Layers, Loader2,
    Bell, FileText, DownloadCloud, Zap, Database,
} from 'lucide-react';
import { toast } from 'sonner';

import CourseCheckGroup from './components/CourseCheckGroup';
import BulkActionBar from './components/BulkActionBar';
import MemoModal from './components/MemoModal';

// ─── 상수 ──────────────────────────────────────────────────────────────────

const GAS_URL = "https://script.google.com/macros/s/AKfycbzj9U17izH6L6pjvIgapyxHfFiLQLB9WqbQ0umTVa972ZWbSYXFWiHiBknLpqrP924o/exec";

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

const COURSEWORK_AREAS = [
    { key: 'reading', label: 'R' },
    { key: 'grammar', label: 'G' },
    { key: 'practice', label: 'P' },
    { key: 'listening', label: 'L' },
    { key: 'etc', label: 'E' },
];

const RETENTION_AREAS = [
    { key: 'vocab', label: 'V' },
    { key: 'idioms', label: 'I' },
    { key: 'verbs', label: '3' },
    { key: 'reading', label: 'R' },
    { key: 'grammar', label: 'G' },
    { key: 'practice', label: 'P' },
    { key: 'listening', label: 'L' },
    { key: 'isc', label: 'W' },
    { key: 'etc', label: 'E' },
];

// ─── 유틸 ──────────────────────────────────────────────────────────────────

const getNormalizedGrade = (s) => {
    if (!s.schoolName || !s.grade) return '기타';
    const school = s.schoolName.toString();
    const gradeVal = s.grade.toString();

    const directMatch = gradeVal.match(/(초|중|고)([1-6])/);
    if (directMatch) {
        const [, type, n] = directMatch;
        if (type === '초' && ['4', '5', '6'].includes(n)) return `초${n}`;
        if (type === '중' && ['1', '2', '3'].includes(n)) return `중${n}`;
        if (type === '고' && ['1', '2', '3'].includes(n)) return `고${n}`;
    }

    const num = (gradeVal.match(/\d/) || [])[0] || '';
    if (school.includes('초') && ['4', '5', '6'].includes(num)) return `초${num}`;
    if (school.includes('중') && ['1', '2', '3'].includes(num)) return `중${num}`;
    if (school.includes('고') && ['1', '2', '3'].includes(num)) return `고${num}`;

    return '기타';
};

const toArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') return val.split(/[,|/\s]+/).filter(Boolean);
    return [];
};

// 요일 매칭 헬퍼 (배열/문자열, 쉼표/공백 구분 등 모두 대응)
const isDayMatch = (daysBase, targetDay) => {
    if (!daysBase) return false;
    const arr = Array.isArray(daysBase) ? daysBase : (typeof daysBase === 'string' ? daysBase.split(/[,|/\s]+/) : []);
    return arr.some(d => d.trim().includes(targetDay));
};

/**
 * rawMemo(string) → 메모 배열 파싱
 * 레거시 순수 문자열도 처리
 */
const parseMemos = (rawMemo) => {
    if (!rawMemo) return [];
    try {
        const parsed = JSON.parse(rawMemo);
        return Array.isArray(parsed) ? parsed : [{ id: 'legacy', text: rawMemo, date: '' }];
    } catch {
        return [{ id: 'legacy', text: rawMemo, date: '' }];
    }
};

/**
 * 빈 세션 객체 생성
 */
const createBlankSession = (data) => {
    const schoolParts = String(data.schoolGrade || '').split(' ');
    return {
        id: data.id || (Date.now().toString() + Math.random().toString(36).substring(2, 9)),
        studentId: 'st_' + Math.random().toString(36).substring(2, 7),
        name: (data.name || 'Unknown').trim(),
        department: data.department || '기타',
        parentPhones: data.parentPhones || [],
        studentPhones: data.studentPhones || [],
        classes: data.classes || ['Unassigned'],
        attendanceDays: data.attendanceDays || [],
        attendanceTime: data.attendanceTime || '',
        specialDays: data.specialDays || [],
        specialTime: data.specialTime || '',
        extraDays: data.extraDays || [],
        schoolName: schoolParts[0] || '',
        grade: schoolParts.slice(1).join(' ') || '',
        status: 'waiting',
        backlogCount: 0,
        lastEditedBy: 'Teacher Kim',
        checks: {
            basic: { voca: 'none', idiom: 'none', step3: 'none', isc: 'none' },
            homework: { reading: 'none', grammar: 'none', practice: 'none', listening: 'none', etc: 'none' },
            review: { reading: 'none', grammar: 'none', practice: 'none', listening: 'none' },
            nextHomework: { reading: '', grammar: '', practice: '', listening: '', extra: '' },
            memos: { toDesk: '', fromDesk: '', toParent: '' },
            homeworkResult: 'none',
            summaryConfirmed: false,
        },
    };
};

// ─── GAS 통신 ───────────────────────────────────────────────────────────────

const sendDataToGAS = async (data) => {
    try {
        await fetch(GAS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: data.date || new Date().toISOString().split('T')[0],
                timestamp: new Date().toISOString(),
                ...data,
            }),
        });
        return true;
    } catch (error) {
        console.error('GAS 전송 실패:', error);
        toast.error('전송 중 오류가 발생했습니다: ' + error.message);
        return false;
    }
};

// ─── Dashboard (메인 컴포넌트) ──────────────────────────────────────────────

export default function Dashboard() {
    const dateInputRef = useRef(null);

    // ── 세션 ──
    // Dashboard 컴포넌트 내부 최상단에 붙여넣기
    const { sessions, setSessions, isLoaded, pendingCount, sync, flush } = useSessions(GAS_URL);
    const { importHistory, setImportHistory } = useImportHistory();
    const { filters, setFilters, isFilterPinned, setIsFilterPinned, clearFilters: clearFiltersFromStore } = useFilters();

    // ── 뷰 ──
    const [viewMode, setViewMode] = useState('today');
    const [homeworkSubView, setHomeworkSubView] = useState(null); // null | '1st' | '2nd' | 'next'
    const [isHomeworkExpanded, setIsHomeworkExpanded] = useState(false);
    const [isRetentionExpanded, setIsRetentionExpanded] = useState(false);
    const [selectedDate, setSelectedDate] = useState(new Date());

    // ── 선택 / 필터 ──
    const [selectedSessionIds, setSelectedSessionIds] = useState(new Set());
    const [selectedHomeworkAreas, setSelectedHomeworkAreas] = useState(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);



    // ── 메모 모달 ──
    const [showMemoModal, setShowMemoModal] = useState(false);
    const [activeMemoStudent, setActiveMemoStudent] = useState(null);

    // ── 학생 프로필 모달 ──
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [activeProfileStudent, setActiveProfileStudent] = useState(null);

    // ── 일괄 액션 ──
    const [bulkMemo, setBulkMemo] = useState('');

    // ── Task Deferral ──
    const [deferDate, setDeferDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    });
    const [deferTime, setDeferTime] = useState('18:00');
    const [deferTasks, setDeferTasks] = useState(['']);

    // ── Import ──
    const [activeImportId, setActiveImportId] = useState(null);
    const [importSelectedIds, setImportSelectedIds] = useState(new Set());
    const [importSearchQuery, setImportSearchQuery] = useState('');
    const [importBatchDays, setImportBatchDays] = useState([]);
    const [importBatchTime, setImportBatchTime] = useState('');
    const [importSpecialBatchDays, setImportSpecialBatchDays] = useState([]);
    const [importSpecialBatchTime, setImportSpecialBatchTime] = useState('');
    const [importArbitraryBatchDays, setImportArbitraryBatchDays] = useState([]);
    const [importBatchStartDate, setImportBatchStartDate] = useState('');
    const [importBatchEndDate, setImportBatchEndDate] = useState('');
    const [bulkPastedText, setBulkPastedText] = useState('');
    const [cloudTabs, setCloudTabs] = useState([]);

    // ── Import Sidebar 패널 토글 ──
    const [showSidebarEdit, setShowSidebarEdit] = useState(false);
    const [showSidebarAdd, setShowSidebarAdd] = useState(false);
    const [showExcelBridge, setShowExcelBridge] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    // ── Individual Add 폼 ──
    const [addFormDays, setAddFormDays] = useState([]);
    const [addFormTime, setAddFormTime] = useState('');

    // ── Import 편집 폼 ──
    const [localEditForm, setLocalEditForm] = useState({
        dept: '', name: '', class: '', schoolGrade: '', days: [], time: '',
        specialDays: [], specialTime: '', startDate: '', endDate: '',
        extraDays: [],
    });

    // ── 초기 로드 ──


    // ── 초기 로드 및 영속화는 useSessions, useImportHistory, useFilters 훅에서 관리됨 ──

    // ── 자동 동기화 (세션 비어있을 때) ──
    useEffect(() => {
        if (isLoaded && sessions.length === 0 && viewMode === 'today') {
            handleCloudSync();
        }
    }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 파생 값 ──
    const todayName = useMemo(
        () => ['일', '월', '화', '수', '목', '금', '토'][selectedDate.getDay()],
        [selectedDate]
    );


    const filteredSessions = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        const orGroups = query
            ? query.split(/[,|]/).map(g => g.trim()).filter(Boolean).map(g => g.split(/\s+/).filter(Boolean))
            : [];

        return sessions.filter(s => {
            if (orGroups.length > 0) {
                const matches = orGroups.some(tokens =>
                    tokens.every(token =>
                        s.name.toLowerCase().includes(token) ||
                        (s.studentId && s.studentId.toLowerCase().includes(token)) ||
                        (s.department && s.department.toLowerCase().includes(token)) ||
                        (s.classes && s.classes.some(c => c.toLowerCase().includes(token))) ||
                        (s.schoolName && s.schoolName.toLowerCase().includes(token)) ||
                        (s.grade && s.grade.toLowerCase().includes(token)) ||
                        (s.attendanceDays && s.attendanceDays.some(d => d.toLowerCase().includes(token))) ||
                        (s.attendanceTime && s.attendanceTime.toLowerCase().includes(token))
                    )
                );
                if (!matches) return false;
            }

            const ng = getNormalizedGrade(s);
            if (filters.departments.length > 0 && !filters.departments.includes(s.department)) return false;
            if (filters.grades.length > 0 && !filters.grades.includes(ng)) return false;
            if (filters.class !== 'All' && !(s.classes && s.classes.includes(filters.class))) return false;
            if (filters.school !== 'All' && s.schoolName !== filters.school) return false;

            // 요일 필터링 (정규 + 특강 + 임의 통합)
            const isRegToday = isDayMatch(s.attendanceDays, todayName);
            const isSpecToday = isDayMatch(s.specialDays, todayName);
            const isExtraToday = isDayMatch(s.extraDays, todayName);

            if (['today', 'coursework', 'retention'].includes(viewMode)) {
                return (isRegToday || isSpecToday || isExtraToday);
            }
            return true;
        }).sort((a, b) => {
            const ca = (a?.classes?.[0]) || '';
            const cb = (b?.classes?.[0]) || '';
            if (ca !== cb) return (ca.toString()).localeCompare(cb.toString());
            return (a?.name || '').localeCompare(b?.name || '');
        });
    }, [sessions, searchQuery, filters, viewMode, todayName]);

    const sidebarFilteredStudents = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return sessions.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.classes && s.classes.some(c => c.toLowerCase().includes(q))) ||
            (s.schoolName && s.schoolName.toLowerCase().includes(q)) ||
            (s.grade && s.grade.toLowerCase().includes(q))
        ).slice(0, 50);
    }, [sessions, searchQuery]);

    const stagedFilteredStudents = useMemo(() => {
        const current = importHistory.find(h => h.id === activeImportId);
        if (!current) return [];
        const students = current.students || [];
        const q = importSearchQuery.toLowerCase().trim();
        if (!q) return students;

        const orGroups = q.split(/[,|]/).map(g => g.trim()).filter(Boolean);
        return students.filter(st =>
            orGroups.some(group => {
                const tokens = group.split(/\s+/).filter(Boolean);
                return tokens.length > 0 && tokens.every(token =>
                    st.name.toLowerCase().includes(token) ||
                    (st.classes?.[0] || '').toLowerCase().includes(token) ||
                    (st.department || '').toLowerCase().includes(token) ||
                    (st.schoolName || '').toLowerCase().includes(token) ||
                    (st.grade || '').toLowerCase().includes(token) ||
                    (Array.isArray(st.attendanceDays) && st.attendanceDays.some(d => d.toLowerCase().includes(token))) ||
                    (st.attendanceTime && st.attendanceTime.toLowerCase().includes(token))
                );
            })
        );
    }, [importHistory, activeImportId, importSearchQuery]);

    const filterOptions = useMemo(() => {
        const classes = new Set();
        const schools = new Set();
        sessions.forEach(s => {
            s.classes?.forEach(c => classes.add(c));
            if (s.schoolName) schools.add(s.schoolName);
        });
        return {
            classes: ['All', ...Array.from(classes).sort()],
            schools: ['All', ...Array.from(schools).sort()],
        };
    }, [sessions]);

    // Import 단일 선택 시 편집 폼 동기화
    useEffect(() => {
        if (viewMode !== 'import') return;
        if (importSelectedIds.size === 1) {
            const studentId = Array.from(importSelectedIds)[0];
            const current = importHistory.find(h => h.id === activeImportId);
            const student = current?.students.find(s => s.id === studentId);
            if (student) {
                setLocalEditForm({
                    dept: student.department || '',
                    name: student.name || '',
                    class: student.classes?.[0] || '',
                    schoolGrade: `${student.schoolName} ${student.grade}`.trim(),
                    days: student.attendanceDays || [],
                    time: student.attendanceTime || '',
                    specialDays: student.specialDays || [],
                    specialTime: student.specialTime || '',
                    startDate: student.startDate || '',
                    endDate: student.endDate || '',
                });
                setShowSidebarEdit(true);
            }
        } else if (importSelectedIds.size !== 1) {
            setLocalEditForm({ dept: '', name: '', class: '', schoolGrade: '', days: [], time: '', specialDays: [], specialTime: '', startDate: '', endDate: '' });
        }
    }, [importSelectedIds, activeImportId, importHistory, viewMode]);

    // ───────────────────────────────────────────────────────────────────────
    // 핸들러
    // ───────────────────────────────────────────────────────────────────────

    const withSync = useCallback(async (fn) => {
        setIsSyncing(true);
        try { await fn(); }
        catch (e) { console.error(e); }
        finally { setIsSyncing(false); }
    }, []);

    const moveDate = (delta) => {
        setSelectedDate(prev => {
            const d = new Date(prev);
            d.setDate(d.getDate() + delta);
            return d;
        });
    };

    const handleInstantStatus = (session, newStatus) =>
        withSync(async () => {
            const targetStatus = session.status === newStatus ? 'waiting' : newStatus;
            const updated = {
                ...session,
                status: targetStatus,
                checks: { ...session.checks, summaryConfirmed: targetStatus === 'attendance' },
            };
            setSessions(prev => prev.map(ps => ps.id === session.id ? updated : ps));
            await sendToGAS(GAS_URL, updated, updated.id);
        });

    const handleBulkStatusUpdate = (status) =>
        withSync(async () => {
            const ids = Array.from(selectedSessionIds);
            const updated = sessions.map(s => {
                if (!selectedSessionIds.has(s.id)) return s;
                return { ...s, status, checks: { ...s.checks, summaryConfirmed: status === 'attendance' } };
            });
            setSessions(updated);
            for (const id of ids) {
                const s = updated.find(x => x.id === id);
                if (s) await sendDataToGAS(s);
            }
            setSelectedSessionIds(new Set());
        });

    const handleHomeworkCellUpdate = (session, step, area, value) =>
        withSync(async () => {
            const updated = {
                ...session,
                checks: {
                    ...session.checks,
                    [step]: { ...(session.checks[step] || {}), [area]: value },
                },
            };
            setSessions(prev => prev.map(s => s.id === session.id ? updated : s));
            await sendToGAS(GAS_URL, updated, updated.id);
        });

    const handleBulkHomeworkUpdate = (value) =>
        withSync(async () => {
            if (selectedHomeworkAreas.size === 0) {
                toast.warning('적용할 영역(Area)을 하나 이상 선택해주세요.');
                return;
            }
            const ids = Array.from(selectedSessionIds);
            const prefix = viewMode === 'retention' ? 'retention' : 'homework';
            const stepMap = { '1st': `${prefix}1`, '2nd': `${prefix}2`, 'next': `${prefix}Next` };
            const targetStep = stepMap[homeworkSubView] || `${prefix}1`;

            const updated = sessions.map(s => {
                if (!selectedSessionIds.has(s.id)) return s;
                const stepData = { ...(s.checks[targetStep] || {}) };
                if (homeworkSubView !== 'next') {
                    selectedHomeworkAreas.forEach(area => { stepData[area] = value; });
                }
                return { ...s, checks: { ...s.checks, [targetStep]: stepData } };
            });
            setSessions(updated);

            for (const id of ids) {
                const s = updated.find(x => x.id === id);
                if (s) await sendDataToGAS(s);
            }
            setSelectedSessionIds(new Set());
            setSelectedHomeworkAreas(new Set());
            toast.success('일괄 수정이 완료되었습니다.');
        });

    const handleBulkMemoUpdate = () =>
        withSync(async () => {
            if (!bulkMemo.trim()) return;
            const ids = Array.from(selectedSessionIds);
            const newMemoObj = {
                id: Date.now() + Math.random().toString(36).slice(2),
                text: bulkMemo,
                date: new Date().toISOString(),
            };
            const updated = sessions.map(s => {
                if (!selectedSessionIds.has(s.id)) return s;
                const existing = parseMemos(s.checks?.memos?.toDesk);
                return {
                    ...s,
                    checks: {
                        ...s.checks,
                        memos: { ...s.checks?.memos, toDesk: JSON.stringify([...existing, newMemoObj]) },
                    },
                };
            });
            setSessions(updated);
            for (const id of ids) {
                const s = updated.find(x => x.id === id);
                if (s) await sendDataToGAS(s);
            }
            setBulkMemo('');
            setSelectedSessionIds(new Set());
            toast.success('선택된 학생들에게 메모가 일괄 적용되었습니다.');
        });

    const handleDeleteMemo = (studentId, memoId) =>
        withSync(async () => {
            const updated = sessions.map(s => {
                if (s.id !== studentId) return s;
                const memos = parseMemos(s.checks?.memos?.toDesk);
                if (!Array.isArray(memos)) return s;
                const filtered = memos.filter(m => m.id !== memoId);
                const result = {
                    ...s,
                    checks: {
                        ...s.checks,
                        memos: { ...s.checks?.memos, toDesk: filtered.length > 0 ? JSON.stringify(filtered) : '' },
                    },
                };
                sendDataToGAS(result);
                if (activeMemoStudent?.id === s.id) setActiveMemoStudent(result);
                return result;
            });
            setSessions(updated);
        });

    const handleSubViewUpdate = (subView, masterView = 'coursework') => {
        setHomeworkSubView(subView);
        setViewMode(masterView);
    };

    const toggleSelection = (id) => {
        setSelectedSessionIds(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    };

    const toggleFilter = (type, value) => {
        setFilters(prev => {
            const cur = prev[type] || [];
            const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
            return { ...prev, [type]: next };
        });
    };

    const clearFilters = () => {
        setFilters({ departments: [], grades: [], class: 'All', school: 'All' });
        setIsFilterPinned(false);
        localStorage.removeItem('impact7_filters');
        localStorage.setItem('impact7_pinned', 'false');
    };

    const handleCloudSync = async () => {
        setIsSyncing(true);
        try {
            const { success, count, error } = await sync();
            if (success) {
                toast.success(`성공! 구글 시트에서 ${count}명의 명단을 동기화했습니다.`);
                setViewMode('today');
            } else if (error) {
                toast.error('동기화 실패: ' + error);
            }
        } finally {
            setIsSyncing(false);
        }
    };

    const fetchCloudTabs = async () => {
        try {
            const res = await fetch(`${GAS_URL}?mode=list`);
            const data = await res.json();
            if (Array.isArray(data)) setCloudTabs(data);
        } catch (e) { console.error('Cloud List Failed:', e); }
    };

    // Import Hub 전용: Cloud 탭 목록을 가져온 뒤 가장 최근 탭을 자동 Clone → 스테이징에 바로 표시
    const handleImportCloudSync = async () => {
        setIsSyncing(true);
        try {
            // 1. 탭 목록 가져오기
            const listRes = await fetch(`${GAS_URL}?mode=list`);
            const tabList = await listRes.json();
            if (!Array.isArray(tabList) || tabList.length === 0) {
                toast.error('Cloud에 탭이 없습니다.');
                return;
            }
            setCloudTabs(tabList);

            // 2. 가장 최근(첫 번째) 탭의 데이터를 가져와서 스테이징에 로드
            const latestTab = tabList[0];
            const dataRes = await fetch(`${GAS_URL}?sheetName=${latestTab}`);
            const data = await dataRes.json();
            if (Array.isArray(data) && data.length > 0) {
                // 기존 sessions를 Map으로 (이름_반 검색용)
                const sessionsMap = new Map(sessions.map(s => {
                    const ns = normalizeSession(s);
                    return [ns._dedupeKey, ns];
                }));

                const normalized = data.map(s => {
                    const ns = normalizeSession(s);
                    const existing = sessionsMap.get(ns._dedupeKey);

                    if (existing) {
                        // 기존 DB에 학생이 있으면, DB의 스케줄 + Cloud의 스케줄을 합쳐서 스테이징에 표시
                        return {
                            ...ns,
                            id: existing.id, // ID 유지 (중복 방지)
                            attendanceDays: Array.from(new Set([...toArray(existing.attendanceDays), ...toArray(ns.attendanceDays)])).filter(Boolean),
                            specialDays: Array.from(new Set([...toArray(existing.specialDays), ...toArray(ns.specialDays)])).filter(Boolean),
                            extraDays: Array.from(new Set([...toArray(existing.extraDays), ...toArray(ns.extraDays)])).filter(Boolean),
                            classes: Array.from(new Set([...toArray(existing.classes), ...toArray(ns.classes)])).filter(Boolean)
                        };
                    }
                    return ns;
                });

                const newImport = { id: `cloud-${Date.now()}`, name: `Cloud:${latestTab}`, students: normalized, isCommited: false };
                setImportHistory(prev => [newImport, ...prev]);
                setActiveImportId(newImport.id);
                toast.success(`'${latestTab}' 탭 (${normalized.length}명)을 기존 데이터와 병합하여 로드했습니다.`);
            } else {
                toast.error(`'${latestTab}' 탭에 데이터가 없습니다.`);
            }
        } catch (e) {
            console.error('Import Cloud Sync Failed:', e);
            toast.error('Cloud 동기화 실패: ' + e.message);
        } finally {
            setIsSyncing(false);
        }
    };


    const handleCloneCloudTab = (sheetName) =>
        withSync(async () => {
            const res = await fetch(`${GAS_URL}?sheetName=${sheetName}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                // Cloud에서 가져온 데이터도 즉시 정규화하여 스테이징에 보관
                const normalized = data.map(normalizeSession);
                const newImport = { id: `cloud-${Date.now()}`, name: `Cloud:${sheetName}`, students: normalized, isCommited: false };
                setImportHistory(prev => [newImport, ...prev]);
                setActiveImportId(newImport.id);
                toast.success(`'${sheetName}' 탭 데이터를 스테이징으로 가져왔습니다.`);
            }
        });

    const handleCreateSessions = async (students) => {
        const now = new Date();
        const pad = (n, l = 2) => String(n).padStart(l, '0');
        const sheetName = [
            String(now.getFullYear()).slice(-2),
            pad(now.getMonth() + 1), pad(now.getDate()),
            pad(now.getHours()), pad(now.getMinutes()),
        ].join('');

        const formatted = students.map(s => ({
            ...s,
            payloadHeader: `| ${s.department} | ${s.name} | ${s.classes?.[0]} | ${s.schoolName} ${s.grade} |`,
        }));

        const success = await sendDataToGAS({ type: 'bulk_import', students: formatted, sheetName });
        if (success) {
            toast.success(`${formatted.length}명의 데이터가 '${sheetName}' 탭으로 전송되었습니다.`);
            setImportHistory(prev => prev.map(h =>
                h.students[0]?.name === students[0]?.name ? { ...h, isCommited: true } : h
            ));
        }

        setSessions(prev => {
            // 기존 세션들을 Map으로 구성 (병합 효율성)
            // normalizeSession을 통해 생성된 _dedupeKey를 매칭 키로 사용
            const map = new Map(prev.map(s => {
                const ns = normalizeSession(s);
                return [ns._dedupeKey, ns];
            }));

            let mergedCount = 0, addedCount = 0;
            formatted.forEach(s => {
                const ns = normalizeSession(s); // 신규 임포트 데이터 정규화
                const key = ns._dedupeKey;

                if (map.has(key)) {
                    mergedCount++;
                    // 기존 데이터가 있으면 정보 및 스케줄만 선별적으로 업데이트 (상태/체크 유실 방지)
                    const existing = map.get(key);
                    const merged = {
                        ...existing,
                        department: ns.department || existing.department,
                        schoolName: ns.schoolName || existing.schoolName,
                        grade: ns.grade || existing.grade,
                        // 요일 데이터는 덮어쓰지 않고 '합치기' (Set 이용 중복 제거)
                        attendanceDays: Array.from(new Set([...toArray(existing.attendanceDays), ...toArray(ns.attendanceDays)])).filter(Boolean),
                        attendanceTime: ns.attendanceTime || existing.attendanceTime,
                        specialDays: Array.from(new Set([...toArray(existing.specialDays), ...toArray(ns.specialDays)])).filter(Boolean),
                        specialTime: ns.specialTime || existing.specialTime,
                        extraDays: Array.from(new Set([...toArray(existing.extraDays), ...toArray(ns.extraDays)])).filter(Boolean),
                        classes: Array.from(new Set([...toArray(existing.classes), ...toArray(ns.classes)])).filter(Boolean)
                    };
                    // 스케줄 변경 추적 로그
                    const scheduleChanged =
                        JSON.stringify(merged.attendanceDays) !== JSON.stringify(existing.attendanceDays) ||
                        JSON.stringify(merged.specialDays) !== JSON.stringify(existing.specialDays) ||
                        JSON.stringify(merged.extraDays) !== JSON.stringify(existing.extraDays);
                    if (scheduleChanged) {
                        console.log(`[Commit 병합] ${ns.name}: 정규 ${JSON.stringify(existing.attendanceDays)}→${JSON.stringify(merged.attendanceDays)}, 특강 ${JSON.stringify(existing.specialDays)}→${JSON.stringify(merged.specialDays)}, 임의 ${JSON.stringify(existing.extraDays)}→${JSON.stringify(merged.extraDays)}`);
                    }
                    map.set(key, merged);
                } else {
                    addedCount++;
                    map.set(key, ns);
                }
            });
            console.log(`[Commit 완료] 병합: ${mergedCount}명, 신규추가: ${addedCount}명, 총: ${map.size}명`);
            return Array.from(map.values());
        });

        return success;
    };

    const handleUpdateStudent = (updatedStudent) => {
        setSessions(prev => prev.map(s => s.id === updatedStudent.id ? updatedStudent : s));
        setImportHistory(prev => prev.map(h => ({
            ...h,
            students: h.students.map(s => s.id === updatedStudent.id ? updatedStudent : s)
        })));
        setActiveProfileStudent(updatedStudent);
        sendToGAS(GAS_URL, updatedStudent, updatedStudent.id);
    };

    const handleIndividualAdd = (studentData) => {
        const newStudent = normalizeSession(createBlankSession(studentData));
        if (activeImportId) {
            setImportHistory(prev => prev.map(h =>
                h.id === activeImportId ? { ...h, students: [newStudent, ...h.students] } : h
            ));
        } else {
            const newImport = {
                id: Date.now().toString(),
                name: `Manual Entry: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                students: [newStudent],
            };
            setImportHistory(prev => [newImport, ...prev]);
            setActiveImportId(newImport.id);
        }
    };

    const handleUpdateStagingStudents = (updates) => {
        if (!activeImportId) return;
        setImportHistory(prev => prev.map(h => {
            if (h.id !== activeImportId) return h;
            return { ...h, students: h.students.map(st => importSelectedIds.has(st.id) ? { ...st, ...updates } : st) };
        }));
    };

    const handleApplyRegularSchedule = () => {
        if (!activeImportId) return;
        const currentImport = importHistory.find(h => h.id === activeImportId);
        if (!currentImport) return;

        const targets = importSelectedIds.size > 0 ? importSelectedIds : new Set(stagedFilteredStudents.map(s => s.id));
        setImportHistory(prev => prev.map(h => {
            if (h.id !== activeImportId) return h;
            return {
                ...h, students: h.students.map(st => {
                    if (!targets.has(st.id)) return st;
                    return {
                        ...st,
                        attendanceDays: importBatchDays.length > 0 ? [...importBatchDays] : st.attendanceDays,
                        attendanceTime: importBatchTime || st.attendanceTime,
                    };
                })
            };
        }));

        setImportBatchDays([]);
        setImportBatchTime('');
        setImportSearchQuery('');
        if (importSelectedIds.size > 0) setImportSelectedIds(new Set());
    };

    const handleApplySpecialSchedule = () => {
        if (!activeImportId) return;
        const currentImport = importHistory.find(h => h.id === activeImportId);
        if (!currentImport) return;

        const targets = importSelectedIds.size > 0 ? importSelectedIds : new Set(stagedFilteredStudents.map(s => s.id));
        setImportHistory(prev => prev.map(h => {
            if (h.id !== activeImportId) return h;
            return {
                ...h, students: h.students.map(st => {
                    if (!targets.has(st.id)) return st;
                    return {
                        ...st,
                        specialDays: importSpecialBatchDays.length > 0 ? [...importSpecialBatchDays] : st.specialDays,
                        specialTime: importSpecialBatchTime || st.specialTime,
                        startDate: importBatchStartDate || st.startDate,
                        endDate: importBatchEndDate || st.endDate,
                    };
                })
            };
        }));
        setImportSpecialBatchDays([]);
        setImportSpecialBatchTime('');
        setImportBatchStartDate('');
        setImportBatchEndDate('');
        setImportSearchQuery('');
        if (importSelectedIds.size > 0) setImportSelectedIds(new Set());
    };

    const handleApplyArbitrarySchedule = () => {
        if (!activeImportId) return;
        const currentImport = importHistory.find(h => h.id === activeImportId);
        if (!currentImport) return;

        const targets = importSelectedIds.size > 0 ? importSelectedIds : new Set(stagedFilteredStudents.map(s => s.id));
        setImportHistory(prev => prev.map(h => {
            if (h.id !== activeImportId) return h;
            return {
                ...h, students: h.students.map(st => {
                    if (!targets.has(st.id)) return st;
                    return {
                        ...st,
                        extraDays: importArbitraryBatchDays.length > 0 ? [...importArbitraryBatchDays] : st.extraDays,
                    };
                })
            };
        }));
        setImportArbitraryBatchDays([]);
        setImportSearchQuery('');
        if (importSelectedIds.size > 0) setImportSelectedIds(new Set());
    };

    const addTask = () => setDeferTasks(t => [...t, '']);
    const removeTask = (i) => setDeferTasks(t => t.length > 1 ? t.filter((_, idx) => idx !== i) : ['']);

    const togglePanel = (panel) => {
        setShowSidebarEdit(panel === 'edit');
        setShowSidebarAdd(panel === 'add');
        setShowExcelBridge(panel === 'excel');
        setShowHistory(panel === 'history');
    };

    // ───────────────────────────────────────────────────────────────────────
    // 렌더
    // ───────────────────────────────────────────────────────────────────────

    return (
        <div className="flex h-screen bg-background text-foreground font-sans antialiased overflow-hidden">

            {/* ── 사이드바 (일반 뷰) ── */}
            {viewMode !== 'import' && (
                <aside className="w-[240px] border-r border-border bg-white flex flex-col shrink-0">
                    <div className="px-4 py-3">
                        <div className="flex items-center justify-between p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer group">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-6 h-6 rounded-md bg-black flex items-center justify-center shrink-0">
                                    <span className="text-white font-black text-[10px]">I7</span>
                                </div>
                                <span className="font-bold text-sm tracking-tight truncate text-foreground">
                                    IMPACT7 <span className="text-muted-foreground font-medium">Workstation</span>
                                </span>
                            </div>
                            <ChevronDown size={14} className="text-muted-foreground group-hover:text-foreground shrink-0" />
                        </div>
                    </div>

                    <nav className="px-3 space-y-0.5 mb-6">
                        <NavItem icon={<Bell size={16} />} label="Notifications" />
                        <NavItem icon={<FileText size={16} />} label="Notes" />
                        <NavItem icon={<Database size={16} />} label="Server Sync" onClick={handleCloudSync} />
                    </nav>

                    <div className="px-3 mb-2">
                        <p className="px-3 py-1 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                            Student Selection
                        </p>
                    </div>

                    {/* 검색 결과 미니 리스트 */}
                    <div className="px-4 mb-4">
                        {sidebarFilteredStudents.length > 0 && (
                            <div className="max-h-52 overflow-y-auto border border-border rounded-lg bg-muted/20 divide-y divide-border/50 scrollbar-hide py-1 shadow-inner">
                                {sidebarFilteredStudents.map(s => (
                                    <div key={s.id}
                                        className="px-2.5 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white transition-colors">
                                        <div className="min-w-0 flex-1 flex flex-col -space-y-0.5">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[11px] font-bold truncate leading-tight">{s.name}</span>
                                                {s.checks?.memos?.toDesk && (
                                                    <MessageSquare size={10}
                                                        className="text-indigo-500 fill-indigo-500/20 shrink-0 cursor-pointer"
                                                        onClick={(e) => { e.stopPropagation(); setActiveMemoStudent(s); setShowMemoModal(true); }} />
                                                )}
                                            </div>
                                            <span className="text-[9px] text-muted-foreground truncate leading-tight">
                                                {s.classes?.[0] || s.grade}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto px-3 space-y-0.5 scrollbar-hide pb-20">
                        <NavItem icon={<Clock size={16} />} label="Attendance" active={viewMode === 'today'} onClick={() => setViewMode('today')} />

                        {/* Coursework */}
                        <NavItem icon={<Users size={16} />} label="Coursework"
                            active={viewMode === 'coursework' && !homeworkSubView}
                            hasDropdown isExpanded={isHomeworkExpanded}
                            onClick={() => {
                                if (viewMode === 'coursework' && !homeworkSubView) setIsHomeworkExpanded(p => !p);
                                else { setViewMode('coursework'); setHomeworkSubView(null); setIsHomeworkExpanded(true); }
                            }} />
                        {isHomeworkExpanded && (
                            <div className="pl-9 space-y-0.5 mt-0.5 mb-2">
                                {[['1st', '1st Check'], ['2nd', '2nd Check'], ['next', 'Next Coursework']].map(([key, label]) => (
                                    <SubNavItem key={key} label={label}
                                        active={viewMode === 'coursework' && homeworkSubView === key}
                                        onClick={() => handleSubViewUpdate(key, 'coursework')} />
                                ))}
                            </div>
                        )}

                        {/* Retention */}
                        <NavItem icon={<Zap size={16} />} label="Retention"
                            active={viewMode === 'retention' && !homeworkSubView}
                            hasDropdown isExpanded={isRetentionExpanded}
                            onClick={() => {
                                if (viewMode === 'retention' && !homeworkSubView) setIsRetentionExpanded(p => !p);
                                else { setViewMode('retention'); setHomeworkSubView(null); setIsRetentionExpanded(true); }
                            }} />
                        {isRetentionExpanded && (
                            <div className="pl-9 space-y-0.5 mt-0.5 mb-2">
                                {[['1st', '1st Trial'], ['2nd', '2nd Trial'], ['next', 'Next Trial']].map(([key, label]) => (
                                    <SubNavItem key={key} label={label}
                                        active={viewMode === 'retention' && homeworkSubView === key}
                                        onClick={() => handleSubViewUpdate(key, 'retention')} />
                                ))}
                            </div>
                        )}

                        <NavItem icon={<Zap size={16} />} label="Automations" />

                        {/* Active Filters */}
                        {['coursework', 'retention'].includes(viewMode) && (
                            <div className="mt-6 pt-6 border-t border-border space-y-4 px-1">
                                <p className="px-2 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">Active Filters</p>
                                <FilterSelect label="Class" value={filters.class} options={filterOptions.classes} onChange={v => setFilters(f => ({ ...f, class: v }))} />
                                <FilterSelect label="School" value={filters.school} options={filterOptions.schools} onChange={v => setFilters(f => ({ ...f, school: v }))} />
                            </div>
                        )}

                        {/* Task Deferral */}
                        <div className="mt-8 pt-8 border-t border-border px-1">
                            <p className="px-2 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-4">Task Deferral</p>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-2">
                                    <SidebarInput type="date" value={deferDate} onChange={e => setDeferDate(e.target.value)} />
                                    <SidebarInput type="time" value={deferTime} onChange={e => setDeferTime(e.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                    {deferTasks.map((task, idx) => (
                                        <div key={idx} className="flex gap-1.5 group">
                                            <SidebarInput placeholder={`Task ${idx + 1}`} value={task}
                                                onChange={e => { const nt = [...deferTasks]; nt[idx] = e.target.value; setDeferTasks(nt); }} />
                                            <button onClick={() => removeTask(idx)}
                                                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all">
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                    <button onClick={addTask} className="text-[10px] font-bold text-primary hover:text-primary/70 transition-colors">+ Add more</button>
                                </div>
                                <button className="w-full h-9 bg-black text-white rounded-md text-[11px] font-bold hover:bg-zinc-800 transition-all">
                                    {isSyncing ? <Loader2 size={12} className="animate-spin inline mr-2" /> : <Plus size={12} className="inline mr-2" />}
                                    Defer Tasks
                                </button>
                            </div>
                        </div>
                    </div>
                </aside>
            )}

            {/* ── 사이드바 (Import 뷰) ── */}
            {viewMode === 'import' && (
                <aside className="w-[280px] border-r border-border bg-white flex flex-col shrink-0">
                    <div className="p-5 border-b border-border bg-zinc-50/50">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
                                <Database size={14} className="text-white" />
                            </div>
                            <h2 className="font-black text-sm tracking-tight uppercase">Import Hub</h2>
                        </div>

                        <button onClick={handleImportCloudSync} disabled={isSyncing}
                            className="w-full h-11 mb-6 bg-gradient-to-br from-indigo-600 to-violet-700 hover:from-indigo-700 hover:to-violet-800 text-white rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-indigo-200 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50">
                            {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
                            <span className="font-black text-[11px] uppercase tracking-wider">Cloud Sync</span>
                        </button>

                        <div className="space-y-4">
                            {/* Information Edit */}
                            <ImportPanel label="Information Edit" icon={<Layers size={14} />}
                                open={showSidebarEdit} onToggle={() => togglePanel(showSidebarEdit ? null : 'edit')}>
                                {importSelectedIds.size > 0 ? (
                                    <div className="p-4 border-t border-zinc-100 bg-zinc-50/30 space-y-4">
                                        <span className="text-[10px] font-bold text-black uppercase tracking-wide bg-zinc-200 px-2 py-0.5 rounded-full">{importSelectedIds.size} SELECTED</span>
                                        <div className="space-y-3">
                                            <FormRow label="소속">
                                                <select className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                    value={localEditForm.dept}
                                                    onChange={e => { setLocalEditForm(f => ({ ...f, dept: e.target.value })); handleUpdateStagingStudents({ department: e.target.value }); }}>
                                                    <option value="">소속 선택...</option>
                                                    <option value="2단지">2단지</option>
                                                    <option value="10단지">10단지</option>
                                                    <option value="기타">기타</option>
                                                </select>
                                            </FormRow>
                                            <FormRow label="반명">
                                                <input className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                    value={localEditForm.class}
                                                    onChange={e => setLocalEditForm(f => ({ ...f, class: e.target.value }))}
                                                    onKeyDown={e => e.key === 'Enter' && handleUpdateStagingStudents({ classes: [localEditForm.class] })} />
                                            </FormRow>
                                            <FormRow label="학교학년">
                                                <input className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                    value={localEditForm.schoolGrade}
                                                    onChange={e => setLocalEditForm(f => ({ ...f, schoolGrade: e.target.value }))}
                                                    onKeyDown={e => {
                                                        if (e.key !== 'Enter') return;
                                                        const [sn, ...gp] = localEditForm.schoolGrade.split(' ');
                                                        handleUpdateStagingStudents({ schoolName: sn || '', grade: gp.join(' ') || '' });
                                                    }} />
                                            </FormRow>
                                            <FormRow label="정규요일">
                                                <DayPicker selectedDays={localEditForm.days} onToggle={d => setLocalEditForm(f => ({ ...f, days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d] }))} />
                                            </FormRow>
                                            <FormRow label="정규시간">
                                                <input type="time" className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                    value={localEditForm.time || ''}
                                                    onChange={e => setLocalEditForm(f => ({ ...f, time: e.target.value }))} />
                                            </FormRow>
                                            <FormRow label="특강요일">
                                                <DayPicker selectedDays={localEditForm.specialDays} onToggle={d => setLocalEditForm(f => ({ ...f, specialDays: f.specialDays.includes(d) ? f.specialDays.filter(x => x !== d) : [...f.specialDays, d] }))} />
                                            </FormRow>
                                            <FormRow label="특강시간">
                                                <input type="time" className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                    value={localEditForm.specialTime || ''}
                                                    onChange={e => setLocalEditForm(f => ({ ...f, specialTime: e.target.value }))} />
                                            </FormRow>
                                            <FormRow label="임의요일">
                                                <DayPicker selectedDays={localEditForm.extraDays || []} onToggle={d => setLocalEditForm(f => ({ ...f, extraDays: (f.extraDays || []).includes(d) ? (f.extraDays || []).filter(x => x !== d) : [...(f.extraDays || []), d] }))} />
                                            </FormRow>
                                            <div className="grid grid-cols-2 gap-2">
                                                <FormRow label="시작일">
                                                    <input type="date" className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                        value={localEditForm.startDate || ''}
                                                        onChange={e => setLocalEditForm(f => ({ ...f, startDate: e.target.value }))} />
                                                </FormRow>
                                                <FormRow label="종료일">
                                                    <input type="date" className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                        value={localEditForm.endDate || ''}
                                                        onChange={e => setLocalEditForm(f => ({ ...f, endDate: e.target.value }))} />
                                                </FormRow>
                                            </div>
                                        </div>
                                        <div className="flex justify-end">
                                            <button onClick={() => {
                                                const [sn, ...gp] = localEditForm.schoolGrade.split(' ');
                                                handleUpdateStagingStudents({
                                                    department: localEditForm.dept,
                                                    classes: [localEditForm.class],
                                                    schoolName: sn || '', grade: gp.join(' ') || '',
                                                    attendanceDays: localEditForm.days, attendanceTime: localEditForm.time,
                                                    specialDays: localEditForm.specialDays, specialTime: localEditForm.specialTime,
                                                    extraDays: localEditForm.extraDays,
                                                    startDate: localEditForm.startDate, endDate: localEditForm.endDate,
                                                });
                                            }} className="h-8 px-4 bg-zinc-200 text-zinc-400 rounded-lg text-[11px] font-bold hover:bg-black hover:text-white transition-all">
                                                Apply All Changes
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-8 text-center">
                                        <p className="text-[11px] font-bold text-zinc-400 mb-1">학생을 선택해주세요</p>
                                        <p className="text-[10px] text-zinc-400">우측 리스트에서 체크 먼저 해주세요</p>
                                    </div>
                                )}
                            </ImportPanel>

                            {/* Individual Add */}
                            <ImportPanel label="Individual Add" icon={<UserPlus size={14} />}
                                open={showSidebarAdd} onToggle={() => togglePanel(showSidebarAdd ? null : 'add')}>
                                <div className="p-4 border-t border-zinc-100 bg-zinc-50/30 space-y-3">
                                    <SidebarInput placeholder="소속 (예: 2단지)" id="add-dept" />
                                    <SidebarInput placeholder="이름" id="add-name" />
                                    <SidebarInput placeholder="반명" id="add-class" />
                                    <SidebarInput placeholder="학교학년" id="add-schoolGrade" />
                                    <FormRow label="요일 선택">
                                        <DayPicker selectedDays={addFormDays} onToggle={d => setAddFormDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])} />
                                    </FormRow>
                                    <FormRow label="등원 시간">
                                        <input type="time" className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                            value={addFormTime} onChange={e => setAddFormTime(e.target.value)} />
                                    </FormRow>
                                    <div className="flex justify-end">
                                        <button onClick={() => {
                                            const name = document.getElementById('add-name').value;
                                            if (!name) return;
                                            handleIndividualAdd({
                                                department: document.getElementById('add-dept').value,
                                                name,
                                                classes: [document.getElementById('add-class').value],
                                                schoolGrade: document.getElementById('add-schoolGrade').value,
                                                attendanceDays: addFormDays,
                                                attendanceTime: addFormTime,
                                            });
                                            ['add-dept', 'add-name', 'add-class', 'add-schoolGrade'].forEach(id => { document.getElementById(id).value = ''; });
                                            setAddFormDays([]);
                                            setAddFormTime('');
                                            togglePanel(null);
                                        }} className="h-8 px-4 bg-zinc-200 text-zinc-400 rounded-lg text-[11px] font-bold hover:bg-black hover:text-white transition-all">
                                            Add to Staging
                                        </button>
                                    </div>
                                </div>
                            </ImportPanel>

                            {/* Excel Bridge */}
                            <ImportPanel label="Excel Bridge" icon={<FileText size={14} />}
                                open={showExcelBridge} onToggle={() => togglePanel(showExcelBridge ? null : 'excel')}>
                                <div className="p-4 border-t border-zinc-100 bg-zinc-50/30 space-y-3">
                                    <textarea value={bulkPastedText} onChange={e => setBulkPastedText(e.target.value)}
                                        placeholder="Paste Excel rows here..."
                                        className="w-full h-24 bg-white border border-zinc-200 rounded-xl p-3 text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-zinc-900/10" />
                                    <div className="flex justify-end">
                                        <button onClick={() => {
                                            if (!bulkPastedText.trim()) return;
                                            const seen = new Set();
                                            const parsed = bulkPastedText.trim().split(/\r?\n/).map((line, i) => {
                                                if (!line.trim()) return null;
                                                const cols = line.split('\t').map(c => (c || '').trim());
                                                if (!cols[0]) return null;
                                                const [name, , , classStr = 'Unassigned', , school = '', grade = ''] = cols;
                                                const dupKey = `${name}${classStr}${school}${grade}`.replace(/\s+/g, '');
                                                if (seen.has(dupKey)) return null;
                                                seen.add(dupKey);
                                                const c3 = classStr.length >= 3 ? classStr.charAt(classStr.length - 3) : '';
                                                const dept = c3 === '1' ? '2단지' : c3 === '2' ? '10단지' : '기타';
                                                return normalizeSession(createBlankSession({ id: `${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`, department: dept, name, classes: [classStr], schoolGrade: `${school} ${grade}`.trim() }));
                                            }).filter(Boolean);
                                            if (parsed.length > 0) {
                                                const newImport = { id: Date.now().toString(), name: `Import ${new Date().toLocaleString()}`, students: parsed, isCommited: false };
                                                setImportHistory(prev => [newImport, ...prev]);
                                                setActiveImportId(newImport.id);
                                                setBulkPastedText('');
                                                togglePanel(null);
                                            }
                                        }} className="h-8 px-4 bg-zinc-200 text-zinc-400 rounded-lg text-[11px] font-bold hover:bg-black hover:text-white transition-all flex items-center gap-2">
                                            <Plus size={14} /> Stage Text Data
                                        </button>
                                    </div>
                                </div>
                            </ImportPanel>

                            {/* History */}
                            <ImportPanel label="History" icon={<Clock size={14} />}
                                open={showHistory} onToggle={() => togglePanel(showHistory ? null : 'history')}>
                                <div className="p-2 border-t border-zinc-100 bg-zinc-50/30 space-y-1">
                                    <SectionDivider label="Cloud Backup" />
                                    <div className="max-h-40 overflow-y-auto space-y-1 mb-4 scrollbar-hide">
                                        {cloudTabs.length > 0 ? cloudTabs.map(tab => (
                                            <div key={tab} className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 border border-zinc-100 hover:border-indigo-200 transition-all group">
                                                <span className="text-[11px] font-bold text-zinc-600">{tab}</span>
                                                <button onClick={() => handleCloneCloudTab(tab)}
                                                    className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[9px] font-black opacity-0 group-hover:opacity-100 transition-opacity">CLONE</button>
                                            </div>
                                        )) : (
                                            <button onClick={fetchCloudTabs} className="w-full py-2 text-[10px] font-bold text-indigo-400 hover:text-indigo-600 transition-colors">
                                                Load Cloud History...
                                            </button>
                                        )}
                                    </div>

                                    <SectionDivider label="Local Imports" />
                                    <div className="space-y-1">
                                        {importHistory.map(session => (
                                            <div key={session.id}
                                                onClick={() => { setActiveImportId(session.id); setImportSelectedIds(new Set()); setImportSearchQuery(''); }}
                                                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-all ${activeImportId === session.id ? 'bg-white border-zinc-300 shadow-md ring-1 ring-black/5' : 'bg-transparent border-transparent hover:bg-white hover:border-zinc-200'}`}>
                                                <div className="min-w-0">
                                                    <p className="text-[12px] font-bold text-zinc-900 truncate tracking-tight">{session.name}</p>
                                                    <p className="text-[10px] font-medium text-zinc-500">{session.students.length} students</p>
                                                </div>
                                                <X size={12} className="text-zinc-400 hover:text-red-500 transition-colors"
                                                    onClick={e => { e.stopPropagation(); setImportHistory(prev => prev.filter(s => s.id !== session.id)); if (activeImportId === session.id) setActiveImportId(null); }} />
                                            </div>
                                        ))}
                                    </div>
                                    {importHistory.length > 0 && (
                                        <button onClick={() => { if (confirm('모든 히스토리를 삭제하시겠습니까?')) { setImportHistory([]); setActiveImportId(null); } }}
                                            className="w-full py-2 text-[10px] font-bold text-zinc-400 hover:text-red-500 hover:bg-red-50/50 rounded-lg transition-all flex items-center justify-center gap-1.5 mt-2">
                                            Clear All History
                                        </button>
                                    )}
                                    {importHistory.length === 0 && (
                                        <div className="p-8 text-center text-[11px] text-zinc-400 font-medium italic">No history yet</div>
                                    )}
                                </div>
                            </ImportPanel>
                        </div>
                    </div>

                    <div className="p-4 border-t border-border mt-auto">
                        <button onClick={() => setViewMode('today')}
                            className="w-full h-10 border border-border rounded-xl text-[11px] font-black text-zinc-400 hover:text-black hover:bg-zinc-50 hover:border-zinc-400 transition-all">
                            Back to Dashboard
                        </button>
                    </div>
                </aside>
            )}

            {/* ── 메인 ── */}
            <main className="flex-1 flex flex-col min-w-0 bg-background/50">
                {/* 헤더 */}
                <header className="h-14 border-b border-border flex items-center px-6 justify-between bg-white sticky top-0 z-20">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            <h1 className="font-bold text-[15px] tracking-tight text-black">
                                {viewMode === 'today' ? 'Timeline Viewer' : viewMode === 'import' ? 'Import Hub' : 'Master List'}
                            </h1>
                            {viewMode === 'today' && (
                                <div className="flex items-center gap-2 mt-0.5">
                                    <button onClick={() => moveDate(-1)} className="p-1 hover:bg-zinc-100 rounded-md transition-colors">
                                        <ChevronLeft size={14} />
                                    </button>
                                    <div className="relative cursor-pointer group h-6 flex items-center"
                                        onClick={() => dateInputRef.current?.showPicker?.()}>
                                        <span className="text-[11px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full ring-1 ring-indigo-200 group-hover:bg-indigo-100 transition-all flex items-center gap-1.5 shadow-sm whitespace-nowrap">
                                            <Calendar size={12} />
                                            {selectedDate.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} ({todayName})
                                        </span>
                                        <input ref={dateInputRef} type="date"
                                            className="absolute inset-0 opacity-0 pointer-events-none"
                                            value={selectedDate.toLocaleDateString('sv-SE')}
                                            onChange={e => { if (e.target.value) setSelectedDate(new Date(e.target.value)); }} />
                                    </div>
                                    <button onClick={() => moveDate(1)} className="p-1 hover:bg-zinc-100 rounded-md transition-colors">
                                        <ChevronRight size={14} />
                                    </button>

                                    {/* 필터 활성화 표시기 */}
                                    {(searchQuery !== '' || filters.departments.length > 0 || filters.grades.length > 0 || filters.class !== 'All' || filters.school !== 'All') && (
                                        <div className="flex items-center gap-1.5 ml-3 px-3 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-200 shadow-sm animate-in fade-in slide-in-from-left-2 transition-all">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                            <span className="text-[10px] font-black tracking-tight">
                                                {searchQuery.trim() ? `"${searchQuery.trim()}" 검색 중` : (searchQuery !== '' ? '공백 검색 중' : '필터 활성화')}
                                            </span>
                                            <button
                                                onClick={() => { setSearchQuery(''); clearFiltersFromStore(); }}
                                                className="ml-1 hover:bg-amber-100 p-0.5 rounded-full transition-colors"
                                                title="검색 및 필터 초기화"
                                            >
                                                <X size={12} strokeWidth={3} />
                                            </button>
                                        </div>
                                    )}
                                    <button onClick={() => setSelectedDate(new Date())}
                                        className="h-6 px-2 text-[10px] font-black text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all ml-1">Today</button>
                                </div>
                            )}
                        </div>
                    </div>
                    <button onClick={() => setViewMode(viewMode === 'import' ? 'today' : 'import')}
                        className={`h-8 px-3 rounded-md text-[11px] font-bold transition-all flex items-center gap-2 ${viewMode === 'import' ? 'bg-zinc-100 text-black border border-border' : 'bg-black text-white'}`}>
                        <DownloadCloud size={14} />
                        {viewMode === 'import' ? 'Exit Import' : 'Import Data'}
                    </button>
                </header>

                <div className="flex-1 flex flex-col min-h-0 relative">
                    {viewMode !== 'import' ? (
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                            {/* 검색 / 필터 바 */}
                            <div className="flex items-center gap-2 mb-6 flex-wrap overflow-x-auto pb-2 scrollbar-hide">
                                <div className="relative min-w-[200px]">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                                    <input placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                        className="h-9 w-48 bg-muted/40 border border-border rounded-xl pl-9 pr-4 text-[12px] focus:outline-none focus:ring-1 focus:ring-black/10 transition-all font-medium" />
                                </div>

                                <div className="h-4 w-[1px] bg-zinc-200 mx-1 shrink-0" />

                                <div className="flex items-center gap-1 bg-zinc-100/50 p-1 rounded-xl border border-zinc-200/50 shrink-0">
                                    {['2단지', '10단지'].map(d => (
                                        <button key={d} onClick={() => toggleFilter('departments', d)}
                                            className={`h-7 px-3 rounded-lg text-[10px] font-black transition-all ${filters.departments.includes(d) ? 'bg-black text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600'}`}>
                                            {d}
                                        </button>
                                    ))}
                                </div>

                                <div className="h-4 w-[1px] bg-zinc-200 mx-1 shrink-0" />

                                <div className="flex items-center gap-1 bg-zinc-100/50 p-1 rounded-xl border border-zinc-200/50 shrink-0">
                                    {['초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3', '기타'].map(g => (
                                        <button key={g} onClick={() => toggleFilter('grades', g)}
                                            className={`h-7 px-2.5 rounded-lg text-[10px] font-black transition-all ${filters.grades.includes(g) ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600'}`}>
                                            {g}
                                        </button>
                                    ))}
                                    <button onClick={clearFilters} className="h-7 px-2 rounded-lg text-[10px] font-black text-zinc-400 hover:text-red-500 transition-all border-l border-zinc-200 ml-1 pl-2">Clear</button>
                                </div>
                                <button onClick={() => {
                                    const next = !isFilterPinned;
                                    setIsFilterPinned(next);
                                    localStorage.setItem('impact7_pinned', String(next));
                                    if (next) localStorage.setItem('impact7_filters', JSON.stringify(filters));
                                }} className={`h-9 w-9 flex items-center justify-center rounded-xl border transition-all shrink-0 ${isFilterPinned ? 'text-indigo-600 bg-indigo-50 border-indigo-200 shadow-sm' : 'text-zinc-300 hover:text-zinc-500 border-zinc-200'}`}>
                                    <Pin size={14} fill={isFilterPinned ? 'currentColor' : 'none'} />
                                </button>
                            </div>

                            {/* 메모 모달 */}
                            {showMemoModal && activeMemoStudent && (
                                <MemoModal
                                    student={activeMemoStudent}
                                    onClose={() => { setShowMemoModal(false); setActiveMemoStudent(null); }}
                                    onDelete={(memoId) => handleDeleteMemo(activeMemoStudent.id, memoId)}
                                />
                            )}

                            {/* 학생 프로필 모달 */}
                            {showProfileModal && activeProfileStudent && (
                                <ProfileModal
                                    student={activeProfileStudent}
                                    show={showProfileModal}
                                    onClose={() => { setShowProfileModal(false); setActiveProfileStudent(null); }}
                                    onUpdate={handleUpdateStudent}
                                    todayName={todayName}
                                    showHighlight={viewMode !== 'import'}
                                />
                            )}

                            {/* 일괄 액션 플로팅 바 */}
                            {selectedSessionIds.size > 0 && (
                                <BulkActionBar
                                    count={selectedSessionIds.size}
                                    viewMode={viewMode}
                                    homeworkSubView={homeworkSubView}
                                    selectedHomeworkAreas={selectedHomeworkAreas}
                                    setSelectedHomeworkAreas={setSelectedHomeworkAreas}
                                    bulkMemo={bulkMemo}
                                    setBulkMemo={setBulkMemo}
                                    onStatusUpdate={handleBulkStatusUpdate}
                                    onHomeworkUpdate={handleBulkHomeworkUpdate}
                                    onMemoUpdate={handleBulkMemoUpdate}
                                    onClear={() => setSelectedSessionIds(new Set())}
                                />
                            )}

                            {/* 테이블 */}
                            <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden mb-20 overflow-x-auto">
                                {filteredSessions.length > 0 ? (
                                    <table className="w-full text-left border-collapse min-w-[800px]">
                                        <thead className="bg-zinc-50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-widest sticky top-0 z-10">
                                            {['coursework', 'retention'].includes(viewMode) ? (
                                                <tr>
                                                    <th className="px-6 py-4 w-12 text-center">
                                                        <input type="checkbox" className="w-3.5 h-3.5 rounded accent-black"
                                                            checked={selectedSessionIds.size === filteredSessions.length && filteredSessions.length > 0}
                                                            onChange={() => setSelectedSessionIds(
                                                                selectedSessionIds.size === filteredSessions.length ? new Set() : new Set(filteredSessions.map(s => s.id))
                                                            )} />
                                                    </th>
                                                    <th className="px-6 py-4">Name</th>
                                                    <th className="px-6 py-4 w-[180px]">Status</th>
                                                    <th className="px-6 py-4 text-center">{viewMode === 'retention' ? '1st Trial' : '1st Check'}</th>
                                                    <th className="px-6 py-4 text-center">{viewMode === 'retention' ? '2nd Trial' : '2nd Check'}</th>
                                                    <th className="px-6 py-4 text-center">{viewMode === 'retention' ? 'Next Trial' : 'Next Coursework'}</th>
                                                </tr>
                                            ) : (
                                                <tr>
                                                    <th className="px-6 py-4 w-12 text-center">
                                                        <input type="checkbox" className="w-3.5 h-3.5 rounded accent-black"
                                                            checked={selectedSessionIds.size === filteredSessions.length && filteredSessions.length > 0}
                                                            onChange={() => setSelectedSessionIds(
                                                                selectedSessionIds.size === filteredSessions.length ? new Set() : new Set(filteredSessions.map(s => s.id))
                                                            )} />
                                                    </th>
                                                    <th className="px-6 py-4">Dept</th>
                                                    <th className="px-6 py-4">Name</th>
                                                    <th className="px-6 py-4">School/Class</th>
                                                    <th className="px-6 py-4">Planned Time</th>
                                                    <th className="px-6 py-4">Schedule</th>
                                                    <th className="px-6 py-4">Status</th>
                                                </tr>
                                            )}
                                        </thead>
                                        <tbody className="divide-y divide-border/50 text-sm">
                                            {filteredSessions.map(s => (
                                                <tr key={s.id}
                                                    onClick={() => { setActiveProfileStudent(s); setShowProfileModal(true); }}
                                                    className={`hover:bg-zinc-50 transition-colors cursor-pointer ${selectedSessionIds.has(s.id) ? 'bg-zinc-50' : ''}`}>
                                                    <td className="px-6 py-3 text-center" onClick={e => e.stopPropagation()}>
                                                        <input type="checkbox" checked={selectedSessionIds.has(s.id)} onChange={() => toggleSelection(s.id)} className="w-3.5 h-3.5 rounded accent-black" />
                                                    </td>

                                                    {['coursework', 'retention'].includes(viewMode) ? (
                                                        <>
                                                            <td className="px-6 py-3 font-black text-[13px]">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex items-baseline gap-1.5">
                                                                        <span>{s.name}</span>
                                                                        <span className="text-[10px] font-medium text-zinc-400">
                                                                            {s.schoolName}{s.grade}
                                                                        </span>
                                                                    </div>
                                                                    <MemoIndicator student={s} onClick={() => { setActiveMemoStudent(s); setShowMemoModal(true); }} />
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-3">
                                                                <StatusButtons session={s}
                                                                    readOnly={!!homeworkSubView}
                                                                    onStatus={(status) => handleInstantStatus(s, status)} />
                                                            </td>
                                                            {/* 1st */}
                                                            <td className="px-6 py-3">
                                                                <CourseCheckGroup student={s}
                                                                    step={viewMode === 'retention' ? 'retention1' : 'homework1'}
                                                                    areas={viewMode === 'retention' ? RETENTION_AREAS : COURSEWORK_AREAS}
                                                                    readOnly={homeworkSubView !== '1st'}
                                                                    onUpdate={(area, val) => handleHomeworkCellUpdate(s, viewMode === 'retention' ? 'retention1' : 'homework1', area, val)} />
                                                            </td>
                                                            {/* 2nd */}
                                                            <td className="px-6 py-3">
                                                                <CourseCheckGroup student={s}
                                                                    step={viewMode === 'retention' ? 'retention2' : 'homework2'}
                                                                    areas={viewMode === 'retention' ? RETENTION_AREAS : COURSEWORK_AREAS}
                                                                    readOnly={homeworkSubView !== '2nd'}
                                                                    validate1stCheck={stu => {
                                                                        const step1 = viewMode === 'retention' ? 'retention1' : 'homework1';
                                                                        return Object.values(stu.checks?.[step1] || {}).some(v => v);
                                                                    }}
                                                                    onUpdate={(area, val) => handleHomeworkCellUpdate(s, viewMode === 'retention' ? 'retention2' : 'homework2', area, val)} />
                                                            </td>
                                                            {/* Next */}
                                                            <td className="px-6 py-3">
                                                                <CourseCheckGroup student={s}
                                                                    step={viewMode === 'retention' ? 'retentionNext' : 'homeworkNext'}
                                                                    areas={viewMode === 'retention' ? RETENTION_AREAS : COURSEWORK_AREAS}
                                                                    isNext readOnly={homeworkSubView !== 'next'}
                                                                    onUpdate={(area, val) => handleHomeworkCellUpdate(s, viewMode === 'retention' ? 'retentionNext' : 'homeworkNext', area, val)} />
                                                            </td>
                                                        </>
                                                    ) : (
                                                        // 출석 뷰
                                                        <>
                                                            <td className="px-6 py-3 font-bold text-xs">{s.department}</td>
                                                            <td className="px-6 py-3 font-black text-[13px]">
                                                                <div className="flex items-center gap-2">
                                                                    {s.name}
                                                                    <MemoIndicator student={s} onClick={() => { setActiveMemoStudent(s); setShowMemoModal(true); }} />
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-3 text-xs font-black text-black/70">
                                                                {s.schoolName}{s.grade}{s.classes?.[0] ? `/${s.classes[0]}` : ''}
                                                            </td>
                                                            <td className="px-6 py-3">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Clock size={12} className="text-zinc-300" />
                                                                    <span className="text-[12px] font-black text-black">{s.attendanceTime || '--:--'}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-3">
                                                                <ScheduleCell student={s} todayName={todayName} />
                                                            </td>
                                                            <td className="px-6 py-3" onClick={e => e.stopPropagation()}>
                                                                <StatusButtons session={s} onStatus={(status) => handleInstantStatus(s, status)}
                                                                    labels={['출석', '지각', '결석']} />
                                                            </td>
                                                        </>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <EmptyState sessions={sessions} todayName={todayName} filters={filters}
                                        onImport={() => setViewMode('import')}
                                        onMaster={() => setViewMode('master')}
                                        onClearFilters={() => { setSearchQuery(''); clearFiltersFromStore(); }} />
                                )}
                            </div>
                        </div>
                    ) : (
                        /* ── Import 뷰 ── */
                        <div className="flex-1 flex flex-col overflow-hidden bg-white">
                            {activeImportId ? (
                                <div className="flex-1 flex flex-col min-h-0">
                                    {/* Import 툴바 */}
                                    <div className="flex flex-col justify-center px-8 py-4 border-b border-zinc-100 bg-zinc-50/20 gap-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-6">
                                                <div className="flex items-center gap-4">
                                                    <span className="text-4xl font-black tabular-nums tracking-tighter">{importSelectedIds.size}</span>
                                                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-none">Selected<br />Students</span>
                                                </div>
                                                <div className="relative">
                                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                                                    <input placeholder="Search staged data..." value={importSearchQuery} onChange={e => setImportSearchQuery(e.target.value)}
                                                        className="h-8 w-60 bg-white border border-border rounded-lg pl-9 pr-3 text-[11px] focus:outline-none transition-all font-medium shadow-sm" />
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => { setImportHistory(prev => prev.filter(h => h.id !== activeImportId)); setActiveImportId(null); }}
                                                    className="h-8 px-4 text-destructive font-black text-[11px] hover:bg-destructive/5 rounded-lg transition-all">Discard Staging</button>
                                            </div>
                                        </div>

                                        {/* 스케줄 툴바 */}
                                        <ScheduleToolbar
                                            batchDays={importBatchDays} setBatchDays={setImportBatchDays}
                                            batchTime={importBatchTime} setBatchTime={setImportBatchTime}
                                            specialDays={importSpecialBatchDays} setSpecialDays={setImportSpecialBatchDays}
                                            specialTime={importSpecialBatchTime} setSpecialTime={setImportSpecialBatchTime}
                                            arbitraryDays={importArbitraryBatchDays} setArbitraryDays={setImportArbitraryBatchDays}
                                            startDate={importBatchStartDate} setStartDate={setImportBatchStartDate}
                                            endDate={importBatchEndDate} setEndDate={setImportBatchEndDate}
                                            onApplyRegular={handleApplyRegularSchedule}
                                            onApplySpecial={handleApplySpecialSchedule}
                                            onApplyArbitrary={handleApplyArbitrarySchedule}
                                            onCommit={async () => {
                                                const curr = importHistory.find(h => h.id === activeImportId);
                                                if (curr) {
                                                    const ok = await handleCreateSessions(curr.students);
                                                    if (ok) setViewMode('today');
                                                }
                                            }}
                                        />
                                    </div>

                                    {/* Import 테이블 */}
                                    <div className="flex-1 overflow-y-auto px-8 py-6">
                                        <table className="w-full border-collapse bg-white border border-border rounded-2xl overflow-hidden">
                                            <thead className="bg-zinc-50/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-widest text-left">
                                                <tr>
                                                    <th className="px-6 py-4 w-12 text-center">
                                                        <input type="checkbox" className="w-3.5 h-3.5 rounded accent-black"
                                                            checked={stagedFilteredStudents.length > 0 && stagedFilteredStudents.every(s => importSelectedIds.has(s.id))}
                                                            onChange={() => {
                                                                const allSelected = stagedFilteredStudents.every(s => importSelectedIds.has(s.id));
                                                                setImportSelectedIds(prev => {
                                                                    const n = new Set(prev);
                                                                    stagedFilteredStudents.forEach(s => allSelected ? n.delete(s.id) : n.add(s.id));
                                                                    return n;
                                                                });
                                                            }} />
                                                    </th>
                                                    <th className="px-6 py-4">소속</th>
                                                    <th className="px-6 py-4">이름</th>
                                                    <th className="px-6 py-4">반명</th>
                                                    <th className="px-6 py-4">학교학년</th>
                                                    <th className="px-6 py-4 text-center">Schedule</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/50">
                                                {stagedFilteredStudents.map(st => (
                                                    <tr key={st.id}
                                                        onClick={() => { setActiveProfileStudent(st); setShowProfileModal(true); }}
                                                        className={`cursor-pointer transition-colors ${importSelectedIds.has(st.id) ? 'bg-zinc-100/80' : 'hover:bg-zinc-50'}`}>
                                                        <td className="px-6 py-4 text-center" onClick={(e) => { e.stopPropagation(); setImportSelectedIds(prev => { const n = new Set(prev); n.has(st.id) ? n.delete(st.id) : n.add(st.id); return n; }); }}>
                                                            <input type="checkbox" checked={importSelectedIds.has(st.id)} readOnly className="w-3.5 h-3.5 rounded accent-black pointer-events-none" />
                                                        </td>
                                                        <td className="px-6 py-4"><span className="text-[11px] font-bold px-2 py-0.5 bg-zinc-200/50 rounded-md">{st.department}</span></td>
                                                        <td className="px-6 py-4"><p className="text-[13px] font-black tracking-tight">{st.name}</p></td>
                                                        <td className="px-6 py-4"><p className="text-[12px] font-bold text-foreground/80">{st.classes?.[0]}</p></td>
                                                        <td className="px-6 py-4 text-[11px] font-medium text-muted-foreground">{st.schoolName} {st.grade}</td>
                                                        <td className="px-6 py-4">
                                                            <ScheduleCell student={st} todayName={todayName} showHighlight={false} />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center opacity-20 grayscale">
                                    <Database size={64} className="mb-4" />
                                    <h2 className="text-xl font-black">No Active Staging Session</h2>
                                    <p className="text-xs font-bold mt-2">Paste data into the sidebar to start importing.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────────────

/** 네비게이션 아이템 */
function NavItem({ icon, label, active, onClick, hasDropdown, isExpanded }) {
    return (
        <div onClick={onClick} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${active ? 'bg-zinc-100 text-black shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-zinc-50'}`}>
            <div className={active ? 'text-black' : 'text-muted-foreground'}>{icon}</div>
            <span className="text-sm font-bold truncate flex-1">{label}</span>
            {hasDropdown && <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />}
        </div>
    );
}

/** 사이드바 서브 네비게이션 */
function SubNavItem({ label, active, onClick }) {
    return (
        <div onClick={onClick}
            className={`px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${active ? 'bg-black text-white' : 'text-zinc-400 hover:text-black hover:bg-zinc-50'}`}>
            {label}
        </div>
    );
}

/** Import 패널 (아코디언) */
function ImportPanel({ label, icon, open, onToggle, children }) {
    return (
        <div className={`group rounded-xl transition-all duration-200 overflow-hidden ${open ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}>
            <button onClick={onToggle}
                className="w-full h-11 flex items-center justify-between px-4 py-3 text-left bg-white hover:bg-zinc-50/50 transition-colors">
                <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${open ? 'bg-black text-white' : 'text-zinc-400 group-hover:text-black'}`}>
                        {icon}
                    </div>
                    <span className={`text-[12px] font-bold transition-colors ${open ? 'text-black' : 'text-zinc-500 group-hover:text-black'}`}>{label}</span>
                </div>
                <ChevronDown size={14} className={`text-zinc-300 transition-transform duration-300 ${open ? 'rotate-180 text-black' : 'group-hover:text-zinc-500'}`} />
            </button>
            {open && children}
        </div>
    );
}

/** 폼 행 (라벨 + 인풋) */
function FormRow({ label, children }) {
    return (
        <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">{label}</label>
            {children}
        </div>
    );
}

/** 섹션 구분선 */
function SectionDivider({ label }) {
    return (
        <p className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest mb-2 flex items-center gap-2 px-1 py-1">
            <span className="h-[1px] flex-1 bg-zinc-100" />{label}<span className="h-[1px] flex-1 bg-zinc-100" />
        </p>
    );
}

/** 사이드바 input */
function SidebarInput({ ...props }) {
    return (
        <input {...props} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-black/10 transition-all font-medium placeholder:text-muted-foreground/30 shadow-sm" />
    );
}

/** 메모 아이콘 인디케이터 */
function MemoIndicator({ student, onClick }) {
    if (!student.checks?.memos?.toDesk) return null;
    return (
        <button onClick={e => { e.stopPropagation(); onClick(); }}
            className="w-5 h-5 rounded-full flex items-center justify-center text-indigo-500 hover:bg-indigo-50 transition-all relative shrink-0">
            <MessageSquare size={12} fill="currentColor" fillOpacity={0.2} />
            <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-indigo-600 rounded-full border border-white" />
        </button>
    );
}

/** 출석 상태 버튼 그룹 */
function StatusButtons({ session, readOnly, onStatus, labels = ['P', 'L', 'A'] }) {
    const configs = [
        { status: 'attendance', color: '#84994F' },
        { status: 'late', color: '#FCB53B' },
        { status: 'absent', color: '#B45253' },
    ];
    return (
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            {configs.map(({ status, color }, i) => (
                <button key={status}
                    onClick={() => {
                        if (readOnly) {
                            toast.warning('이 뷰에서는 출석 상태를 변경할 수 없습니다.');
                            return;
                        }
                        onStatus(status);
                    }}
                    className={`h-7 px-2.5 rounded-lg text-[10px] font-black transition-all border ${session.status === status ? 'text-white border-transparent' : 'bg-zinc-100/50 text-zinc-400 border-zinc-200/50 hover:bg-white hover:border-zinc-300'} ${readOnly ? 'cursor-not-allowed opacity-80' : ''}`}
                    style={session.status === status ? { backgroundColor: color } : {}}>
                    {labels[i]}
                </button>
            ))}
        </div>
    );
}

/** 검색 결과 없음 */
function EmptyState({ sessions, todayName, filters, onImport, onMaster, onClearFilters }) {
    const hasActiveFilters = filters.departments.length > 0 || filters.grades.length > 0 || filters.class !== 'All' || filters.school !== 'All' || filters.searchQuery !== '';
    return (
        <div className="flex flex-col items-center justify-center py-20 px-8 text-center bg-zinc-50/50 rounded-3xl border border-dashed border-zinc-200 m-8">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-6 ring-1 ring-zinc-100">
                <Search size={32} className="text-zinc-200" />
            </div>
            <h3 className="text-sm font-bold text-zinc-900 mb-2">찾으시는 학생이 없나요?</h3>
            <p className="text-[11px] text-zinc-500 max-w-[240px] leading-relaxed mb-8">
                {hasActiveFilters ? "활성화된 필터나 검색어로 인해 학생이 표시되지 않을 수 있습니다. 필터를 초기화하거나 스테이징에서 데이터를 가져와보세요." : "오늘 등원하는 학생이 아직 없습니다. 스테이징(Import Hub)에서 데이터를 가져오거나 마스터 목록에서 명단을 확인해보세요."}
            </p>
            <div className="flex gap-3">
                <button onClick={onMaster}
                    className="h-10 px-6 bg-white border border-zinc-200 rounded-xl text-[12px] font-black hover:bg-zinc-50 transition-all shadow-sm">
                    Master List 보기
                </button>
                <button onClick={onImport}
                    className="h-10 px-6 bg-black text-white rounded-xl text-[12px] font-black hover:bg-zinc-800 transition-all shadow-lg shadow-black/10">
                    데이터 임포트하기
                </button>
            </div>
        </div>
    );
}

/** 필터 셀렉트 */
function FilterSelect({ label, value, options, onChange }) {
    return (
        <div className="space-y-1">
            <label className="text-[9px] font-bold text-muted-foreground uppercase ml-1">{label}</label>
            <select value={value} onChange={e => onChange(e.target.value)}
                className="w-full bg-white border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-black/10 transition-all cursor-pointer font-medium shadow-sm">
                {options.map(opt => <option key={opt} value={opt}>{opt === 'All' ? `All ${label}s` : opt}</option>)}
            </select>
        </div>
    );
}

/** 요일 선택기 */
function DayPicker({ selectedDays, onToggle }) {
    return (
        <div className="flex justify-between bg-zinc-50 p-1 rounded-lg border border-border">
            {DAYS.map(d => (
                <button key={d} onClick={() => onToggle(d)}
                    className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all ${selectedDays.includes(d) ? 'bg-black text-white shadow-md' : 'text-muted-foreground hover:bg-white hover:text-black'}`}>
                    {d}
                </button>
            ))}
        </div>
    );
}

/** Import 스케줄 툴바 */
function ScheduleToolbar({ batchDays, setBatchDays, batchTime, setBatchTime,
    specialDays, setSpecialDays, specialTime, setSpecialTime,
    arbitraryDays, setArbitraryDays,
    startDate, setStartDate, endDate, setEndDate,
    onApplyRegular, onApplySpecial, onApplyArbitrary, onCommit }) {
    return (
        <div className="flex gap-4 items-stretch">
            <div className="flex-1 bg-white/80 p-1.5 rounded-2xl border border-zinc-100 shadow-sm flex flex-col gap-0.5">
                {/* 정규 줄 */}
                <div className="flex items-center justify-between pl-2 pr-1 py-0.5">
                    <div className="flex items-center gap-4">
                        <div className="flex gap-0.5">
                            {DAYS.map(d => (
                                <button key={d} onClick={() => setBatchDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])}
                                    className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all border ${batchDays.includes(d) ? 'bg-black text-white border-black ring-2 ring-black/5' : 'bg-transparent text-zinc-300 border-zinc-100 hover:text-black hover:border-black/40'}`}>
                                    {d}
                                </button>
                            ))}
                        </div>
                        <div className="h-4 w-[1px] bg-zinc-100" />
                        <input type="time" value={batchTime} onChange={e => setBatchTime(e.target.value)}
                            className={`h-6 px-1.5 border border-zinc-100 rounded text-[10px] font-bold focus:outline-none bg-zinc-50/50 ${batchTime ? 'text-black' : 'text-zinc-400'}`} />
                    </div>
                    <button onClick={onApplyRegular} className="h-6 px-3 bg-black text-white rounded-md text-[9px] font-black transition-all flex items-center gap-1.5 shadow-sm hover:scale-105 active:scale-95">
                        <Clock size={10} /> 정규 입력
                    </button>
                </div>
                {/* 특강 줄 */}
                <div className="flex items-center justify-between pl-2 pr-1 py-0.5 border-t border-zinc-50/50">
                    <div className="flex items-center gap-4">
                        <div className="flex gap-0.5">
                            {DAYS.map(d => (
                                <button key={d} onClick={() => setSpecialDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])}
                                    className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all border ${specialDays.includes(d) ? 'bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-500/10' : 'bg-transparent text-indigo-100 border-indigo-50 hover:text-indigo-600 hover:border-indigo-400'}`}>
                                    {d}
                                </button>
                            ))}
                        </div>
                        <div className="h-4 w-[1px] bg-indigo-50" />
                        <div className="flex items-center gap-2">
                            <input type="time" value={specialTime} onChange={e => setSpecialTime(e.target.value)}
                                className={`h-6 px-1.5 border border-indigo-50/50 rounded text-[10px] font-bold focus:outline-none bg-indigo-50/30 ${specialTime ? 'text-indigo-600' : 'text-indigo-200'}`} />
                            <div className="flex items-center gap-1">
                                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                    className={`h-6 px-1 border border-indigo-50/50 rounded text-[9px] font-bold focus:outline-none bg-indigo-50/30 min-w-[95px] ${startDate ? 'text-indigo-600' : 'text-indigo-200'}`} />
                                <span className="text-[10px] text-indigo-100">-</span>
                                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                                    className={`h-6 px-1 border border-indigo-50/50 rounded text-[9px] font-bold focus:outline-none bg-indigo-50/30 min-w-[95px] ${endDate ? 'text-indigo-600' : 'text-indigo-200'}`} />
                            </div>
                        </div>
                    </div>
                    <button onClick={onApplySpecial} className="h-6 px-3 bg-indigo-600 text-white rounded-md text-[9px] font-black transition-all flex items-center gap-1.5 shadow-sm hover:scale-105 active:scale-95">
                        <Zap size={10} /> 특강 입력
                    </button>
                </div>
                {/* 임의 줄 */}
                <div className="flex items-center justify-between pl-2 pr-1 py-0.5 border-t border-zinc-50/50">
                    <div className="flex items-center gap-4">
                        <div className="flex gap-0.5">
                            {DAYS.map(d => (
                                <button key={d} onClick={() => setArbitraryDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])}
                                    className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all border ${arbitraryDays.includes(d) ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-transparent text-orange-100 border-orange-50 hover:text-orange-600 hover:border-orange-400'}`}>
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button onClick={onApplyArbitrary} className="h-6 px-3 bg-orange-500 text-white rounded-md text-[9px] font-black transition-all flex items-center gap-1.5 shadow-sm hover:scale-105 active:scale-95">
                        <Plus size={10} /> 임의 입력
                    </button>
                </div>
            </div>

            {/* 서버 저장 버튼 (우측에 통합) */}
            <button onClick={onCommit}
                className="w-32 bg-gradient-to-br from-indigo-600 to-violet-700 hover:from-indigo-700 hover:to-violet-800 text-white rounded-2xl flex flex-col items-center justify-center gap-2 shadow-xl shadow-indigo-200 transition-all hover:scale-[1.02] active:scale-[0.98]">
                <Save size={20} />
                <span className="font-black text-[12px] uppercase tracking-wider text-center px-2 leading-tight">서버에 저장</span>
                <div className="px-2 py-0.5 bg-white/20 rounded-full text-[8px] font-bold">COMMIT</div>
            </button>
        </div>
    );
}

/** Import 테이블 스케줄 셀 */
function ScheduleCell({ student: st, todayName, showHighlight = true }) {
    return (
        <div className="flex flex-col items-center gap-1">
            <div className="flex gap-0.5 justify-center items-center">
                {DAYS.map(d => {
                    const isReg = isDayMatch(st.attendanceDays, d);
                    const isSpec = isDayMatch(st.specialDays, d);
                    const isExtra = isDayMatch(st.extraDays, d);

                    const count = [isReg, isSpec, isExtra].filter(Boolean).length;

                    let bg = 'bg-transparent text-zinc-200 border-zinc-100';
                    if (count >= 2) bg = 'bg-black text-white border-black';
                    else if (isReg) bg = 'bg-emerald-500 text-white border-emerald-500';
                    else if (isSpec) bg = 'bg-indigo-600 text-white border-indigo-600';
                    else if (isExtra) bg = 'bg-orange-500 text-white border-orange-500';

                    const isToday = showHighlight && d === todayName;
                    const size = isToday ? 'w-5 h-5 text-[10px]' : 'w-4 h-4 text-[8px]';
                    const todayBorder = isToday ? 'border-zinc-900 border-2 shadow-sm' : 'border';

                    return (
                        <span key={d} className={`${size} rounded-[3px] flex items-center justify-center font-black ${bg} ${todayBorder} transition-all`}>
                            {d}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

/** 학생 프로필 모달 (우측 슬라이드 패널) */
function ProfileModal({ student, show, onClose, onUpdate, todayName, showHighlight = true }) {
    const [pendingTasks, setPendingTasks] = useState('');

    if (!show || !student) return null;

    const handleSaveTasks = () => {
        if (pendingTasks.trim()) {
            const updated = {
                ...student,
                checks: {
                    ...student.checks,
                    memos: {
                        ...student.checks?.memos,
                        pendingTasks: pendingTasks.trim()
                    }
                }
            };
            onUpdate(updated);
            setPendingTasks('');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex justify-end z-[100]" onClick={onClose}>
            <div
                className="bg-white w-full max-w-[400px] h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-zinc-900 px-6 py-6 flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-xl font-black text-white tracking-tight">{student.name}</h2>
                        <p className="text-sm font-medium text-zinc-300 mt-0.5">
                            {student.schoolName} {student.grade} {student.classes?.[0] && `/ ${student.classes[0]}`}
                        </p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
                        <span className="text-white text-xl font-bold">×</span>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* Basic Info */}
                    <Section title="기본 정보">
                        <InfoRow label="소속" value={student.department || '-'} />
                        <InfoRow label="학번" value={student.studentId || '-'} />
                        <InfoRow label="스케줄" value={
                            <div className="flex flex-col gap-2">
                                <div className="flex gap-1.5 items-center justify-center">
                                    {DAYS.map(d => {
                                        const isReg = isDayMatch(student.attendanceDays, d);
                                        const isSpec = isDayMatch(student.specialDays, d);
                                        const isExtra = isDayMatch(student.extraDays, d);
                                        const count = [isReg, isSpec, isExtra].filter(Boolean).length;

                                        let bg = 'bg-transparent text-zinc-300 border border-zinc-100';
                                        if (count >= 2) bg = 'bg-black text-white border-black';
                                        else if (isReg) bg = 'bg-emerald-500 text-white border-emerald-500';
                                        else if (isSpec) bg = 'bg-indigo-600 text-white border-indigo-600';
                                        else if (isExtra) bg = 'bg-orange-500 text-white border-orange-500';

                                        const isToday = showHighlight && d === todayName;
                                        const size = isToday ? 'w-8 h-8 text-[12px]' : 'w-7 h-7 text-[11px]';
                                        return (
                                            <div key={d} className={`${size} rounded-md flex items-center justify-center font-black ${bg} border ${isToday ? 'border-zinc-900 border-2 shadow-md' : ''} transition-all`}>
                                                {d}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        } />
                    </Section>

                    {/* Attendance Status */}
                    <Section title="출석 현황">
                        <div className="grid grid-cols-3 gap-2">
                            <StatusBadge label="출석" value={student.status === 'attendance'} color="green" />
                            <StatusBadge label="지각" value={student.status === 'late'} color="yellow" />
                            <StatusBadge label="결석" value={student.status === 'absent'} color="red" />
                        </div>
                    </Section>

                    {/* Coursework Status */}
                    {(student.checks?.homework1 || student.checks?.homework2 || student.checks?.homeworkNext) && (
                        <Section title="Coursework 현황">
                            <CheckStatusGrid
                                step1={student.checks?.homework1}
                                step2={student.checks?.homework2}
                                stepNext={student.checks?.homeworkNext}
                                areas={COURSEWORK_AREAS}
                            />
                        </Section>
                    )}

                    {/* Retention Status */}
                    {(student.checks?.retention1 || student.checks?.retention2 || student.checks?.retentionNext) && (
                        <Section title="Retention 현황">
                            <CheckStatusGrid
                                step1={student.checks?.retention1}
                                step2={student.checks?.retention2}
                                stepNext={student.checks?.retentionNext}
                                areas={RETENTION_AREAS}
                            />
                        </Section>
                    )}

                    {/* Memos */}
                    {student.checks?.memos?.toDesk && (
                        <Section title="메모">
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                <p className="text-sm text-amber-900 whitespace-pre-wrap">{student.checks.memos.toDesk}</p>
                            </div>
                        </Section>
                    )}

                    {/* Pending Tasks */}
                    {student.checks?.memos?.pendingTasks && (
                        <Section title="Pending Tasks">
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <p className="text-sm text-blue-900 whitespace-pre-wrap">{student.checks.memos.pendingTasks}</p>
                            </div>
                        </Section>
                    )}

                    {/* Pending Tasks Input */}
                    <Section title="Pending Tasks 추가">
                        <div className="space-y-2">
                            <textarea
                                value={pendingTasks}
                                onChange={e => setPendingTasks(e.target.value)}
                                placeholder="새로운 pending task를 입력하세요..."
                                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                rows={3}
                            />
                            <button
                                onClick={handleSaveTasks}
                                disabled={!pendingTasks.trim()}
                                className="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:bg-zinc-300 disabled:cursor-not-allowed transition-all"
                            >
                                저장
                            </button>
                        </div>
                    </Section>
                </div>
            </div>
        </div>
    );
}

/** Section wrapper */
function Section({ title, children }) {
    return (
        <div className="space-y-2">
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-wider">{title}</h3>
            <div className="space-y-2">
                {children}
            </div>
        </div>
    );
}

/** Info row */
function InfoRow({ label, value }) {
    return (
        <div className="flex items-start gap-3 py-2 border-b border-zinc-100 last:border-0">
            <span className="text-xs font-bold text-zinc-500 w-24 shrink-0">{label}</span>
            <div className="text-sm font-medium text-zinc-900 flex-1">{value || '-'}</div>
        </div>
    );
}

/** Status badge */
function StatusBadge({ label, value, color }) {
    const colors = {
        green: value ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-zinc-50 text-zinc-400 border-zinc-200',
        yellow: value ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-zinc-50 text-zinc-400 border-zinc-200',
        red: value ? 'bg-rose-100 text-rose-700 border-rose-300' : 'bg-zinc-50 text-zinc-400 border-zinc-200',
    };
    return (
        <div className={`px-3 py-2 rounded-lg border text-center text-xs font-bold ${colors[color]}`}>
            {label}
        </div>
    );
}

/** Check status grid */
function CheckStatusGrid({ step1, step2, stepNext, areas }) {
    return (
        <div className="grid grid-cols-4 gap-2 text-[10px]">
            <div className="font-black text-zinc-500 uppercase">Area</div>
            <div className="font-black text-zinc-500 uppercase text-center">1st</div>
            <div className="font-black text-zinc-500 uppercase text-center">2nd</div>
            <div className="font-black text-zinc-500 uppercase text-center">Next</div>

            {areas.map(area => (
                <React.Fragment key={area.key}>
                    <div className="font-bold text-zinc-700">{area.label}</div>
                    <div className="text-center">
                        {step1?.[area.key] ? <CheckIcon checked={step1[area.key]} /> : '-'}
                    </div>
                    <div className="text-center">
                        {step2?.[area.key] ? <CheckIcon checked={step2[area.key]} /> : '-'}
                    </div>
                    <div className="text-center">
                        {stepNext?.[area.key] ? <CheckIcon checked={stepNext[area.key]} /> : '-'}
                    </div>
                </React.Fragment>
            ))}
        </div>
    );
}

/** Check icon helper */
function CheckIcon({ checked }) {
    if (checked === 'none' || !checked) return <span className="text-zinc-300">○</span>;
    if (checked === 'check') return <span className="text-emerald-600">✓</span>;
    if (checked === 'cross') return <span className="text-rose-600">✗</span>;
    return <span className="text-zinc-300">-</span>;
}

