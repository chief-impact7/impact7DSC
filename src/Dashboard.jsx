import { useState, useMemo, useEffect, useRef } from 'react';
import {
    Users, CheckSquare, MessageSquare, Save, Search, Filter,
    MoreHorizontal, ChevronRight, ChevronLeft, Pin, Check, X, AlertTriangle,
    ChevronDown, Copy, Send, LogOut, Clock, Calendar, Plus, UserPlus, Layers, Loader2,
    Bell, CheckCircle2, FileText, Mail, ArrowUpDown, DownloadCloud, Zap, BarChart3, Settings, Database
} from 'lucide-react';

const getDeptFromClassName = (className) => {
    if (!className) return "기타";
    const nameStr = String(className).trim();
    if (nameStr.length < 3) return "기타";
    const thirdFromRight = nameStr.charAt(nameStr.length - 3);
    if (thirdFromRight === '1') return "2단지";
    if (thirdFromRight === '2') return "10단지";
    return "기타";
};

const getNormalizedGrade = (s) => {
    if (!s.schoolName || !s.grade) return "기타";
    const school = s.schoolName.toString();
    const gradeVal = s.grade.toString();
    const numMatch = gradeVal.match(/\d/);
    const num = numMatch ? numMatch[0] : "";

    if (school.includes('초')) {
        if (['4', '5', '6'].includes(num)) return `초${num}`;
    } else if (school.includes('중')) {
        if (['1', '2', '3'].includes(num)) return `중${num}`;
    } else if (school.includes('고')) {
        if (['1', '2', '3'].includes(num)) return `고${num}`;
    }

    // 학년 컬럼 자체가 "초4" 형식인 경우도 체크
    const directMatch = gradeVal.match(/(초|중|고)([1-6])/);
    if (directMatch) {
        const type = directMatch[1];
        const n = directMatch[2];
        if (type === '초' && ['4', '5', '6'].includes(n)) return `초${n}`;
        if (type === '중' && ['1', '2', '3'].includes(n)) return `중${n}`;
        if (type === '고' && ['1', '2', '3'].includes(n)) return `고${n}`;
    }

    return "기타";
};

// Mock Data
const INITIAL_SESSIONS = [];

const getStatusColor = (status) => {
    switch (status) {
        case 'attendance': return 'bg-green-500/10 text-green-500 border-green-500/20';
        case 'late': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        case 'absent': return 'bg-red-500/10 text-red-500 border-red-500/20';
        case 'waiting': return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
        default: return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
    }
};

export default function Dashboard() {
    const dateInputRef = useRef(null);
    const [sessions, setSessions] = useState(INITIAL_SESSIONS);
    const [selectedSessionIds, setSelectedSessionIds] = useState(new Set());
    const [showDetailPanel, setShowDetailPanel] = useState(false);
    const [stagingEditData, setStagingEditData] = useState({ department: '', className: '', schoolGrade: '', days: [], time: '' });
    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [viewMode, setViewMode] = useState('today');
    const [searchQuery, setSearchQuery] = useState('');
    const [filters, setFilters] = useState(() => {
        const saved = localStorage.getItem('impact7_filters');
        if (saved) {
            const parsed = JSON.parse(saved);
            return {
                departments: Array.isArray(parsed.departments) ? parsed.departments : [],
                grades: Array.isArray(parsed.grades) ? parsed.grades : []
            };
        }
        return { departments: [], grades: [] };
    });
    const [isLoaded, setIsLoaded] = useState(false);
    const [cloudTabs, setCloudTabs] = useState([]);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [isFilterPinned, setIsFilterPinned] = useState(localStorage.getItem('impact7_pinned') === 'true');

    const allGrades = useMemo(() => {
        const set = new Set(sessions.map(s => {
            if (!s.grade) return null;
            // "초3"에서 "3"만 추출하거나 이미 숫자인 경우
            const matched = s.grade.toString().match(/\d+/);
            return matched ? matched[0] : s.grade.toString();
        }).filter(Boolean));
        return Array.from(set).sort((a, b) => a - b);
    }, [sessions]);

    const toggleFilter = (type, value) => {
        setFilters(prev => {
            const current = prev[type] || [];
            let next = [...current];
            if (next.includes(value)) {
                next = next.filter(v => v !== value);
            } else {
                next = [...next, value];
            }
            return { ...prev, [type]: next };
        });
    };

    const clearFilters = () => {
        setFilters({ departments: [], grades: [] });
        setIsFilterPinned(false);
        localStorage.removeItem('impact7_filters');
        localStorage.setItem('impact7_pinned', 'false');
    };


    // Sidebar & Import Logic States
    const [sidebarSelectedIds, setSidebarSelectedIds] = useState(new Set());
    const [deferDate, setDeferDate] = useState(() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    });
    const [deferTime, setDeferTime] = useState('18:00');
    const [deferTasks, setDeferTasks] = useState(['']);
    const [bulkPastedText, setBulkPastedText] = useState('');

    // Import Staging States
    const [importHistory, setImportHistory] = useState([]); // [{id, name, students}]
    const [activeImportId, setActiveImportId] = useState(null);
    const [importSelectedIds, setImportSelectedIds] = useState(new Set());
    const [importSearchQuery, setImportSearchQuery] = useState('');
    const [importBatchDays, setImportBatchDays] = useState([]);
    const [importBatchTime, setImportBatchTime] = useState('');
    const [importSpecialBatchDays, setImportSpecialBatchDays] = useState([]);
    const [importSpecialBatchTime, setImportSpecialBatchTime] = useState('');
    const [importBatchStartDate, setImportBatchStartDate] = useState('');
    const [importBatchEndDate, setImportBatchEndDate] = useState('');

    // UI Toggle States
    const [showSidebarAdd, setShowSidebarAdd] = useState(false);

    const handleInstantStatus = async (session, newStatus) => {
        setIsSyncing(true);
        try {
            // 토글 로직: 이미 해당 상태라면 waiting으로 되돌림
            const targetStatus = session.status === newStatus ? 'waiting' : newStatus;
            const updated = { ...session, status: targetStatus };

            if (targetStatus === 'attendance') updated.checks.summaryConfirmed = true;
            else if (targetStatus === 'waiting') updated.checks.summaryConfirmed = false;

            // UI 선반영
            setSessions(prev => prev.map(ps => ps.id === session.id ? updated : ps));

            // GAS 동기화
            await sendDataToGAS(updated, "https://script.google.com/macros/s/AKfycbzj9U17izH6L6pjvIgapyxHfFiLQLB9WqbQ0umTVa972ZWbSYXFWiHiBknLpqrP924o/exec");
        } catch (error) {
            console.error("Status Update Failed:", error);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleBulkStatusUpdate = async (status) => {
        setIsSyncing(true);
        try {
            const selectedIds = Array.from(selectedSessionIds);
            const updatedSessions = sessions.map(s => {
                if (selectedSessionIds.has(s.id)) {
                    const updated = { ...s, status: status };
                    if (status === 'attendance') updated.checks.summaryConfirmed = true;
                    return updated;
                }
                return s;
            });

            setSessions(updatedSessions);

            for (const id of selectedIds) {
                const student = updatedSessions.find(s => s.id === id);
                if (student) await sendDataToGAS(student, "https://script.google.com/macros/s/AKfycbzj9U17izH6L6pjvIgapyxHfFiLQLB9WqbQ0umTVa972ZWbSYXFWiHiBknLpqrP924o/exec");
            }

            setSelectedSessionIds(new Set());
        } catch (error) {
            console.error(error);
        } finally {
            setIsSyncing(false);
        }
    };


    const [showSidebarEdit, setShowSidebarEdit] = useState(false);
    const [showExcelBridge, setShowExcelBridge] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    // Individual Add Form State
    const [addFormDays, setAddFormDays] = useState([]);
    const [addFormTime, setAddFormTime] = useState('');

    const [localEditForm, setLocalEditForm] = useState({
        dept: '', name: '', class: '', schoolGrade: '', days: [], time: '',
        specialDays: [], specialTime: '', startDate: '', endDate: ''
    });

    const addTask = () => setDeferTasks([...deferTasks, '']);
    const removeTask = (index) => {
        if (deferTasks.length > 1) setDeferTasks(deferTasks.filter((_, i) => i !== index));
        else setDeferTasks(['']);
    };

    // --- Persistence & Auto-filter Logic ---
    useEffect(() => {
        const savedSessions = localStorage.getItem('impact7_sessions');
        if (savedSessions) setSessions(JSON.parse(savedSessions));
        const savedHistory = localStorage.getItem('impact7_history');
        if (savedHistory) setImportHistory(JSON.parse(savedHistory));
        setIsLoaded(true);
    }, []);

    useEffect(() => {
        if (!isLoaded) return;
        localStorage.setItem('impact7_sessions', JSON.stringify(sessions));
        localStorage.setItem('impact7_history', JSON.stringify(importHistory));
        if (isFilterPinned) {
            localStorage.setItem('impact7_filters', JSON.stringify(filters));
        }
    }, [sessions, importHistory, filters, isFilterPinned, isLoaded]);

    const todayName = useMemo(() => ['일', '월', '화', '수', '목', '금', '토'][selectedDate.getDay()], [selectedDate]);
    // ---------------------------------------

    const filteredSessions = useMemo(() => {
        return sessions.filter(s => {
            const matchesSearch = !searchQuery.trim() || searchQuery.toLowerCase().split(/[,|]/).some(group => {
                const groupTrimmed = group.trim();
                if (!groupTrimmed) return false;
                const tokens = groupTrimmed.split(/\s+/);
                return tokens.every(token =>
                    s.name.toLowerCase().includes(token) ||
                    (s.studentId && s.studentId.toLowerCase().includes(token)) ||
                    (s.department && s.department.toLowerCase().includes(token)) ||
                    (s.classes && s.classes.some(c => c.toLowerCase().includes(token))) ||
                    (s.schoolName && s.schoolName.toLowerCase().includes(token)) ||
                    (s.grade && s.grade.toLowerCase().includes(token)) ||
                    (s.attendanceDays && s.attendanceDays.some(d => d.toLowerCase().includes(token))) ||
                    (s.time && s.time.toLowerCase().includes(token))
                );
            });

            const normalizedGrade = getNormalizedGrade(s);
            const matchesDept = filters.departments.length === 0 || filters.departments.includes(s.department);
            const matchesGrade = filters.grades.length === 0 || filters.grades.includes(normalizedGrade);

            if (viewMode === 'today') {
                const isScheduledToday = s.attendanceDays && s.attendanceDays.includes(todayName);
                return matchesSearch && matchesDept && matchesGrade && isScheduledToday;
            }
            return matchesSearch && matchesDept && matchesGrade;
        }).sort((a, b) => {
            // 1. 상태 우선순위: waiting(0) > others(1)
            const getStatusScore = (st) => st === 'waiting' ? 0 : 1;
            const scoreA = getStatusScore(a.status);
            const scoreB = getStatusScore(b.status);
            if (scoreA !== scoreB) return scoreA - scoreB;

            // 2. 시간순 (HH:mm)
            if (a.attendanceTime && b.attendanceTime) {
                return a.attendanceTime.localeCompare(b.attendanceTime);
            }
            if (!a.attendanceTime && b.attendanceTime) return 1;
            if (a.attendanceTime && !b.attendanceTime) return -1;

            return 0;
        });
    }, [sessions, searchQuery, filters, viewMode, todayName]);

    const sidebarFilteredStudents = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const query = searchQuery.toLowerCase();
        return sessions.filter(s =>
            s.name.toLowerCase().includes(query) ||
            (s.classes && s.classes.some(c => c.toLowerCase().includes(query))) ||
            (s.schoolName && s.schoolName.toLowerCase().includes(query)) ||
            (s.grade && s.grade.toLowerCase().includes(query))
        ).slice(0, 50);
    }, [sessions, searchQuery]);

    const stagedFilteredStudents = useMemo(() => {
        const currentImport = importHistory.find(h => h.id === activeImportId);
        if (!currentImport) return [];
        const students = currentImport.students || [];
        const q = importSearchQuery.toLowerCase().trim();
        if (!q) return students;

        const orGroups = q.split(/[,|]/).map(g => g.trim()).filter(Boolean);
        if (orGroups.length === 0) return students;

        return students.filter(st => {
            return orGroups.some(group => {
                const tokens = group.split(/\s+/).filter(Boolean);
                if (tokens.length === 0) return false;
                return tokens.every(token =>
                    st.name.toLowerCase().includes(token) ||
                    (st.classes?.[0] || "").toLowerCase().includes(token) ||
                    (st.department || "").toLowerCase().includes(token) ||
                    (st.schoolName || "").toLowerCase().includes(token) ||
                    (st.grade || "").toLowerCase().includes(token) ||
                    (Array.isArray(st.attendanceDays) && st.attendanceDays.some(d => d.toLowerCase().includes(token))) ||
                    (st.attendanceTime && st.attendanceTime.toLowerCase().includes(token))
                );
            });
        });
    }, [importHistory, activeImportId, importSearchQuery]);

    const filterOptions = useMemo(() => {
        const classes = new Set();
        const schools = new Set();
        const grades = new Set();
        sessions.forEach(s => {
            if (s.classes) s.classes.forEach(c => classes.add(c));
            if (s.schoolName) schools.add(s.schoolName);
            if (s.grade) grades.add(s.grade);
        });
        return {
            classes: ['All', ...Array.from(classes).sort()],
            schools: ['All', ...Array.from(schools).sort()],
            grades: ['All', ...Array.from(grades).sort()]
        };
    }, [sessions]);

    const toggleSelection = (id) => {
        const newSet = new Set(selectedSessionIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedSessionIds(newSet);
    };

    // Effect to sync single selection to edit form
    useMemo(() => {
        if (viewMode === 'import' && importSelectedIds.size === 1) {
            const studentId = Array.from(importSelectedIds)[0];
            const currentImport = importHistory.find(h => h.id === activeImportId);
            const student = currentImport?.students.find(s => s.id === studentId);
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
                    endDate: student.endDate || ''
                });
                setShowSidebarEdit(true);
            }
        } else if (importSelectedIds.size !== 1) {
            setLocalEditForm({
                dept: '', name: '', class: '', schoolGrade: '', days: [], time: '',
                specialDays: [], specialTime: '', startDate: '', endDate: ''
            });
        }
    }, [importSelectedIds, activeImportId, importHistory, viewMode]);

    const updateSessionData = (sessionId, path, value) => {
        setSessions(prev => prev.map(s => {
            if (s.id === sessionId) {
                const newSession = JSON.parse(JSON.stringify(s));
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

    const handleBulkUpdate = (category, item, value) => {
        if (selectedSessionIds.size === 0) return;
        setSessions(prev => prev.map(session => {
            if (selectedSessionIds.has(session.id)) {
                const newChecks = { ...session.checks };
                if (item) newChecks[category] = { ...newChecks[category], [item]: value };
                else newChecks[category] = value;
                return { ...session, checks: newChecks };
            }
            return session;
        }));
    };

    const handleBulkAttendanceDays = (day) => {
        if (selectedSessionIds.size === 0) return;
        setSessions(prev => prev.map(s => {
            if (selectedSessionIds.has(s.id)) {
                const currentDays = s.attendanceDays || [];
                const newDays = currentDays.includes(day)
                    ? currentDays.filter(d => d !== day)
                    : [...currentDays, day];
                return { ...s, attendanceDays: newDays };
            }
            return s;
        }));
    };


    const handleIndividualAdd = (studentData) => {
        const newStudent = createBlankSession(studentData);
        if (activeImportId) {
            setImportHistory(prev => prev.map(h => h.id === activeImportId ? { ...h, students: [newStudent, ...h.students] } : h));
        } else {
            const now = new Date();
            const sessionName = `Manual Entry: ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const newImport = { id: Date.now().toString(), name: sessionName, students: [newStudent] };
            setImportHistory(prev => [newImport, ...prev]);
            setActiveImportId(newImport.id);
        }
    };
    const handleApplyRegularSchedule = () => {
        if (!activeImportId) return;
        const finalTargetIds = importSelectedIds.size > 0
            ? importSelectedIds
            : new Set(stagedFilteredStudents.map(s => s.id));

        setImportHistory(prev => prev.map(h => {
            if (h.id !== activeImportId) return h;
            return {
                ...h,
                students: h.students.map(st => {
                    if (finalTargetIds.has(st.id)) {
                        return {
                            ...st,
                            attendanceDays: importBatchDays.length > 0 ? [...importBatchDays] : st.attendanceDays,
                            attendanceTime: importBatchTime || st.attendanceTime
                        };
                    }
                    return st;
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
        const finalTargetIds = importSelectedIds.size > 0
            ? importSelectedIds
            : new Set(stagedFilteredStudents.map(s => s.id));

        setImportHistory(prev => prev.map(h => {
            if (h.id !== activeImportId) return h;
            return {
                ...h,
                students: h.students.map(st => {
                    if (finalTargetIds.has(st.id)) {
                        return {
                            ...st,
                            specialDays: importSpecialBatchDays.length > 0 ? [...importSpecialBatchDays] : st.specialDays,
                            specialTime: importSpecialBatchTime || st.specialTime,
                            startDate: importBatchStartDate || st.startDate,
                            endDate: importBatchEndDate || st.endDate
                        };
                    }
                    return st;
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

    const handleUpdateStagingStudents = (updates) => {
        if (!activeImportId) return;
        setImportHistory(prev => prev.map(h => {
            if (h.id !== activeImportId) return h;
            return {
                ...h,
                students: h.students.map(st => {
                    if (importSelectedIds.has(st.id)) {
                        return { ...st, ...updates };
                    }
                    return st;
                })
            };
        }));
    };

    const handleCloudSync = async () => {
        setIsSyncing(true);
        try {
            const URL = "https://script.google.com/macros/s/AKfycbzj9U17izH6L6pjvIgapyxHfFiLQLB9WqbQ0umTVa972ZWbSYXFWiHiBknLpqrP924o/exec";
            const response = await fetch(URL);
            const data = await response.json();
            if (data && Array.isArray(data)) {
                setSessions(data);
                alert(`성공! 구글 시트에서 ${data.length}명의 명단을 동기화했습니다.`);
                setViewMode('today');
            }
        } catch (error) {
            console.error("Sync failed:", error);
            alert("동기화 중 오류가 발생했습니다: " + error.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const fetchCloudTabs = async () => {
        try {
            const URL = "https://script.google.com/macros/s/AKfycbzj9U17izH6L6pjvIgapyxHfFiLQLB9WqbQ0umTVa972ZWbSYXFWiHiBknLpqrP924o/exec?mode=list";
            const response = await fetch(URL);
            const data = await response.json();
            if (Array.isArray(data)) setCloudTabs(data);
        } catch (err) {
            console.error("Cloud List Failed:", err);
        }
    };

    const handleCloneCloudTab = async (sheetName) => {
        setIsSyncing(true);
        try {
            const URL = `https://script.google.com/macros/s/AKfycbzj9U17izH6L6pjvIgapyxHfFiLQLB9WqbQ0umTVa972ZWbSYXFWiHiBknLpqrP924o/exec?sheetName=${sheetName}`;
            const response = await fetch(URL);
            const data = await response.json();

            if (data && Array.isArray(data)) {
                const newImport = {
                    id: `cloud-${Date.now()}`,
                    name: `Cloud:${sheetName}`,
                    students: data,
                    isCommited: false
                };
                setImportHistory(prev => [newImport, ...prev]);
                setActiveImportId(newImport.id);
                alert(`'${sheetName}' 탭 데이터를 스테이징으로 가져왔습니다. 'Commit'을 누르면 현재 시간으로 복제됩니다.`);
            }
        } catch (error) {
            alert("불러오기 실패: " + error.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleCreateSessions = async (students) => {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const targetSheetName = `${yy}${mm}${dd}${hh}${mi}`;

        const formattedStudents = students.map(s => ({
            ...s,
            payloadHeader: `| ${s.department} | ${s.name} | ${s.classes?.[0]} | ${s.schoolName} ${s.grade} |`
        }));

        // Sync to GAS
        const GAS_URL = "https://script.google.com/macros/s/AKfycbzj9U17izH6L6pjvIgapyxHfFiLQLB9WqbQ0umTVa972ZWbSYXFWiHiBknLpqrP924o/exec";
        const success = await sendDataToGAS({
            type: 'bulk_import',
            students: formattedStudents,
            sheetName: targetSheetName
        }, GAS_URL);

        if (success) {
            alert(`${formattedStudents.length}명의 데이터가 '${targetSheetName}' 탭으로 성공적으로 전송되었습니다.`);

            // 전송 성공 후에도 히스토리 보존 (isCommited 플래그만 업데이트)
            setImportHistory(prev => prev.map(h => {
                const isThisOne = h.students.length === students.length && h.students[0]?.name === students[0]?.name;
                return isThisOne ? { ...h, isCommited: true } : h;
            }));
        }

        setSessions(prev => {
            const existingMap = new Map();
            prev.forEach(ps => {
                const key = `${ps.name}-${ps.classes?.[0]}`;
                existingMap.set(key, ps);
            });

            formattedStudents.forEach(ns => {
                const key = `${ns.name}-${ns.classes?.[0]}`;
                if (!existingMap.has(key)) {
                    existingMap.set(key, ns);
                }
            });

            return Array.from(existingMap.values());
        });

        return success;
    };

    const sendDataToGAS = async (data, targetUrl) => {
        setIsSyncing(true);
        try {
            const payload = {
                date: data.date || new Date().toISOString().split('T')[0],
                timestamp: new Date().toISOString(),
                ...data
            };

            // no-cors는 성공 여부를 알 수 없으므로, 최대한 전송을 시도합니다.
            // 만약 구글 시트에서 CORS 에러가 나더라도 데이터는 전달될 수 있습니다.
            await fetch(targetUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return true;
        } catch (error) {
            console.error("Link failed:", error);
            alert("전송 중 오류가 발생했습니다: " + error.message);
            return false;
        } finally {
            setIsSyncing(false);
        }
    };

    const handleCheckout = async (session) => {
        setIsSyncing(true);
        try {
            const updatedSession = JSON.parse(JSON.stringify(session));
            updatedSession.status = 'attendance';
            updatedSession.checks.summaryConfirmed = true;
            await sendDataToGAS(updatedSession, "https://script.google.com/macros/s/AKfycbzj9U17izH6L6pjvIgapyxHfFiLQLB9WqbQ0umTVa972ZWbSYXFWiHiBknLpqrP924o/exec");
            setSessions(prev => prev.map(s => s.id === session.id ? updatedSession : s));
            setShowDetailPanel(false);
        } catch (error) {
            console.error("Checkout failed:", error);
        } finally {
            setIsSyncing(false);
        }
    };

    const generateLMS = (session) => {
        if (!session) return "";
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
        if (session.checks.memos.toParent.trim()) message += `■ Memo\n${session.checks.memos.toParent}\n\n`;
        message += `Writer: ${session.lastEditedBy}`;
        return message;
    };

    const copyToClipboard = (text) => navigator.clipboard.writeText(text);

    const activeSession = currentSessionId ? sessions.find(s => s.id === currentSessionId) : null;

    return (
        <div className="flex h-screen bg-background text-foreground font-sans antialiased overflow-hidden">
            {/* Sidebar Logic */}
            {viewMode !== 'import' && (
                <aside className="w-[240px] border-r border-border bg-white flex flex-col shrink-0">
                    <div className="px-4 py-3">
                        <div className="flex items-center justify-between p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer group">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-6 h-6 rounded-md bg-black flex items-center justify-center shrink-0">
                                    <span className="text-white font-black text-[10px]">I7</span>
                                </div>
                                <span className="font-bold text-sm tracking-tight truncate text-foreground">IMPACT7 <span className="text-muted-foreground font-medium">Workstation</span></span>
                            </div>
                            <ChevronDown size={14} className="text-muted-foreground group-hover:text-foreground shrink-0" />
                        </div>
                    </div>

                    <nav className="px-3 space-y-0.5 mb-6">
                        <NavItem icon={<Bell size={16} />} label="Notifications" />
                        <NavItem icon={<CheckSquare size={16} />} label="Tasks" />
                        <NavItem icon={<FileText size={16} />} label="Notes" />
                    </nav>

                    <div className="px-3 mb-2">
                        <p className="px-3 py-1 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest flex items-center justify-between group">
                            Student Selection
                        </p>
                    </div>

                    <div className="px-4 mb-4">
                        <div className="space-y-2">
                            {sidebarFilteredStudents.length > 0 ? (
                                <div className="max-h-52 overflow-y-auto border border-border rounded-lg bg-muted/20 divide-y divide-border/50 scrollbar-hide py-1 shadow-inner">
                                    {sidebarFilteredStudents.map(s => (
                                        <div
                                            key={s.id}
                                            onClick={() => toggleSidebarSelection(s.id)}
                                            className={`px-2.5 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white transition-colors ${sidebarSelectedIds.has(s.id) ? 'bg-white' : ''}`}
                                        >
                                            <input type="checkbox" checked={sidebarSelectedIds.has(s.id)} onChange={() => { }} className="w-3.5 h-3.5 rounded accent-black" />
                                            <div className="min-w-0">
                                                <p className="text-[11px] font-bold truncate">{s.name}</p>
                                                <p className="text-[9px] text-muted-foreground truncate">{s.classes?.[0] || s.grade}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            {sidebarSelectedIds.size > 0 && (
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-[10px] font-bold text-primary">{sidebarSelectedIds.size} selected</span>
                                    <button onClick={() => setSidebarSelectedIds(new Set())} className="text-[10px] font-bold text-muted-foreground hover:text-foreground">Clear</button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-3 space-y-0.5 scrollbar-hide pb-20">
                        <NavItem icon={<Clock size={16} />} label="Timeline" active={viewMode === 'today'} onClick={() => setViewMode('today')} />
                        <NavItem icon={<Users size={16} />} label="Student DB" active={viewMode === 'master'} onClick={() => setViewMode('master')} />
                        <NavItem icon={<BarChart3 size={16} />} label="Performance" />
                        <NavItem icon={<Zap size={16} />} label="Automations" />

                        {viewMode === 'master' && (
                            <div className="mt-6 pt-6 border-t border-border space-y-4 px-1">
                                <p className="px-2 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">Active Filters</p>
                                <div className="space-y-2">
                                    <FilterSelect label="Class" value={filters.class} options={filterOptions.classes} onChange={v => setFilters({ ...filters, class: v })} />
                                    <FilterSelect label="School" value={filters.school} options={filterOptions.schools} onChange={v => setFilters({ ...filters, school: v })} />
                                </div>
                            </div>
                        )}

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
                                            <SidebarInput placeholder={`Task ${idx + 1}`} value={task} onChange={e => { const nt = [...deferTasks]; nt[idx] = e.target.value; setDeferTasks(nt); }} />
                                            <button onClick={() => removeTask(idx)} className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"><X size={12} /></button>
                                        </div>
                                    ))}
                                    <button onClick={addTask} className="text-[10px] font-bold text-primary hover:text-primary/70 Transition-colors">+ Add more</button>
                                </div>
                                <button className="w-full h-9 bg-black text-white rounded-md text-[11px] font-bold hover:bg-zinc-800 transition-all disabled:opacity-50">
                                    {isSyncing ? <Loader2 size={12} className="animate-spin inline mr-2" /> : <Plus size={12} className="inline mr-2" />}
                                    Defer Tasks
                                </button>
                            </div>
                        </div>
                    </div>
                </aside>
            )}

            {viewMode === 'import' && (
                <aside className="w-[280px] border-r border-border bg-white flex flex-col shrink-0">
                    <div className="p-5 border-b border-border bg-zinc-50/50">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
                                <Database size={14} className="text-white" />
                            </div>
                            <h2 className="font-black text-sm tracking-tight uppercase">Import Hub</h2>
                        </div>

                        <button
                            onClick={handleCloudSync}
                            disabled={isSyncing}
                            className="w-full h-11 mb-6 bg-gradient-to-br from-indigo-600 to-violet-700 hover:from-indigo-700 hover:to-violet-800 text-white rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-indigo-200 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 group overflow-hidden relative"
                        >
                            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                            {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
                            <span className="font-black text-[11px] uppercase tracking-wider">Cloud Sync</span>
                        </button>

                        <div className="space-y-4">
                            <div className={`group rounded-xl transition-all duration-200 overflow-hidden ${showSidebarEdit ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}>
                                <button
                                    onClick={() => { setShowSidebarEdit(!showSidebarEdit); if (!showSidebarEdit) { setShowSidebarAdd(false); setShowExcelBridge(false); setShowHistory(false); } }}
                                    className="w-full h-11 flex items-center justify-between px-4 py-3 text-left bg-transparent hover:bg-zinc-50/50 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${showSidebarEdit ? 'bg-black text-white' : 'text-zinc-400 group-hover:text-black'}`}>
                                            <Layers size={14} />
                                        </div>
                                        <span className={`text-[12px] font-bold transition-colors ${showSidebarEdit ? 'text-black' : 'text-zinc-500 group-hover:text-black'}`}>Information Edit</span>
                                    </div>
                                    <ChevronDown size={14} className={`text-zinc-300 transition-transform duration-300 ${showSidebarEdit ? 'rotate-180 text-black' : 'group-hover:text-zinc-500'}`} />
                                </button>

                                {showSidebarEdit && (
                                    importSelectedIds.size > 0 ? (
                                        <div className="p-4 border-t border-zinc-100 bg-zinc-50/30 space-y-4 animate-in slide-in-from-top-1 duration-200">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[10px] font-bold text-black uppercase tracking-wide bg-zinc-200 px-2 py-0.5 rounded-full">{importSelectedIds.size} SELECTED</span>
                                            </div>
                                            <div className="space-y-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">소속</label>
                                                    <select
                                                        className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                        value={localEditForm.dept}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setLocalEditForm({ ...localEditForm, dept: val });
                                                            handleUpdateStagingStudents({ department: val });
                                                        }}
                                                    >
                                                        <option value="">소속 선택...</option>
                                                        <option value="2단지">2단지</option>
                                                        <option value="10단지">10단지</option>
                                                        <option value="기타">기타</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">상태 변경</label>
                                                    <select
                                                        className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val) {
                                                                handleUpdateStagingStudents({ statusChange: val });
                                                            }
                                                        }}
                                                    >
                                                        <option value="">상태 변경 선택...</option>
                                                        <option value="재원→휴원">재원 → 휴원</option>
                                                        <option value="재원→퇴원">재원 → 퇴원</option>
                                                        <option value="휴원→재원">휴원 → 재원</option>
                                                        <option value="휴원→퇴원">휴원 → 퇴원</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">반명</label>
                                                    <input
                                                        className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                        value={localEditForm.class}
                                                        onChange={(e) => setLocalEditForm({ ...localEditForm, class: e.target.value })}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleUpdateStagingStudents({ classes: [localEditForm.class] });
                                                        }}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">학교학년</label>
                                                    <input
                                                        className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                        value={localEditForm.schoolGrade}
                                                        onChange={(e) => setLocalEditForm({ ...localEditForm, schoolGrade: e.target.value })}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                const parts = localEditForm.schoolGrade.split(' ');
                                                                handleUpdateStagingStudents({
                                                                    schoolName: parts[0] || "",
                                                                    grade: parts.slice(1).join(' ') || ""
                                                                });
                                                            }
                                                        }}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">정규요일</label>
                                                    <DayPicker selectedDays={localEditForm.days || []} onToggle={(d) => {
                                                        const newDays = localEditForm.days.includes(d)
                                                            ? localEditForm.days.filter(x => x !== d)
                                                            : [...localEditForm.days, d];
                                                        setLocalEditForm({ ...localEditForm, days: newDays });
                                                    }} />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">정규시간</label>
                                                    <input
                                                        type="time"
                                                        className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                        value={localEditForm.time || ''}
                                                        onChange={(e) => setLocalEditForm({ ...localEditForm, time: e.target.value })}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">특강요일선택</label>
                                                    <DayPicker selectedDays={localEditForm.specialDays || []} onToggle={(d) => {
                                                        const newDays = localEditForm.specialDays.includes(d)
                                                            ? localEditForm.specialDays.filter(x => x !== d)
                                                            : [...localEditForm.specialDays, d];
                                                        setLocalEditForm({ ...localEditForm, specialDays: newDays });
                                                    }} />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">특강시간</label>
                                                    <input
                                                        type="time"
                                                        className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                        value={localEditForm.specialTime || ''}
                                                        onChange={(e) => setLocalEditForm({ ...localEditForm, specialTime: e.target.value })}
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">시작일</label>
                                                        <input
                                                            type="date"
                                                            className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                            value={localEditForm.startDate || ''}
                                                            onChange={(e) => setLocalEditForm({ ...localEditForm, startDate: e.target.value })}
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">종료일</label>
                                                        <input
                                                            type="date"
                                                            className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white"
                                                            value={localEditForm.endDate || ''}
                                                            onChange={(e) => setLocalEditForm({ ...localEditForm, endDate: e.target.value })}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex justify-end">
                                                <button
                                                    onClick={() => {
                                                        const parts = localEditForm.schoolGrade.split(' ');
                                                        handleUpdateStagingStudents({
                                                            department: localEditForm.dept,
                                                            classes: [localEditForm.class],
                                                            schoolName: parts[0] || "",
                                                            grade: parts.slice(1).join(' ') || "",
                                                            attendanceDays: localEditForm.days,
                                                            attendanceTime: localEditForm.time,
                                                            specialDays: localEditForm.specialDays,
                                                            specialTime: localEditForm.specialTime,
                                                            startDate: localEditForm.startDate,
                                                            endDate: localEditForm.endDate
                                                        });
                                                    }}
                                                    className="h-8 px-4 bg-zinc-200 text-zinc-400 rounded-lg text-[11px] font-bold hover:bg-black hover:text-white transition-all"
                                                >
                                                    Apply All Changes
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-8 text-center">
                                            <p className="text-[11px] font-bold text-zinc-400 mb-1">학생을 선택해주세요</p>
                                            <p className="text-[10px] text-zinc-400">우측 리스트에서 체크 먼저 해주세요</p>
                                        </div>
                                    )
                                )}
                            </div>

                            <div className={`group rounded-xl transition-all duration-200 overflow-hidden ${showSidebarAdd ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}>
                                <button
                                    onClick={() => { setShowSidebarAdd(!showSidebarAdd); if (!showSidebarAdd) { setShowSidebarEdit(false); setShowExcelBridge(false); setShowHistory(false); } }}
                                    className="w-full h-11 flex items-center justify-between px-4 py-3 text-left bg-white hover:bg-zinc-50/50 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${showSidebarAdd ? 'bg-black text-white' : 'text-zinc-400 group-hover:text-black'}`}>
                                            <UserPlus size={14} />
                                        </div>
                                        <span className={`text-[12px] font-bold transition-colors ${showSidebarAdd ? 'text-black' : 'text-zinc-500 group-hover:text-black'}`}>Individual Add</span>
                                    </div>
                                    <ChevronDown size={14} className={`text-zinc-300 transition-transform duration-300 ${showSidebarAdd ? 'rotate-180 text-black' : 'group-hover:text-zinc-500'}`} />
                                </button>

                                {showSidebarAdd && (
                                    <div className="p-4 border-t border-zinc-100 bg-zinc-50/30 space-y-3 animate-in slide-in-from-top-1 duration-200">
                                        <div className="space-y-3">
                                            <SidebarInput placeholder="소속 (예: 2단지)" id="add-dept" />
                                            <SidebarInput placeholder="이름" id="add-name" />
                                            <SidebarInput placeholder="반명" id="add-class" />
                                            <SidebarInput placeholder="학교학년" id="add-schoolGrade" />

                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">요일 선택</label>
                                                <DayPicker selectedDays={addFormDays} onToggle={(d) => {
                                                    setAddFormDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
                                                }} />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">등원 시간</label>
                                                <input
                                                    type="time"
                                                    className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white text-zinc-400"
                                                    value={addFormTime}
                                                    onChange={(e) => setAddFormTime(e.target.value)}
                                                />
                                            </div>

                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">첫 등원일</label>
                                                <input
                                                    type="date"
                                                    id="add-firstDate"
                                                    max={new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                                                    min={new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                                                    className="w-full h-9 border border-zinc-200 rounded-lg px-2 text-[12px] font-medium focus:outline-none focus:border-zinc-400 bg-white text-zinc-400"
                                                />
                                            </div>

                                            <div className="flex justify-end">
                                                <button
                                                    onClick={() => {
                                                        const dept = document.getElementById('add-dept').value;
                                                        const name = document.getElementById('add-name').value;
                                                        const cls = document.getElementById('add-class').value;
                                                        const sg = document.getElementById('add-schoolGrade').value;
                                                        if (!name) return;
                                                        handleIndividualAdd({
                                                            department: dept,
                                                            name,
                                                            classes: [cls],
                                                            schoolGrade: sg,
                                                            attendanceDays: addFormDays,
                                                            attendanceTime: addFormTime
                                                        });
                                                        ['add-dept', 'add-name', 'add-class', 'add-schoolGrade'].forEach(id => document.getElementById(id).value = '');
                                                        setAddFormDays([]);
                                                        setAddFormTime('');
                                                        setShowSidebarAdd(false);
                                                    }}
                                                    className="h-8 px-4 bg-zinc-200 text-zinc-400 rounded-lg text-[11px] font-bold hover:bg-black hover:text-white transition-all"
                                                >
                                                    Add to Staging
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className={`group rounded-xl transition-all duration-200 overflow-hidden ${showExcelBridge ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}>
                                <button
                                    onClick={() => { setShowExcelBridge(!showExcelBridge); if (!showExcelBridge) { setShowSidebarAdd(false); setShowSidebarEdit(false); setShowHistory(false); } }}
                                    className="w-full h-11 flex items-center justify-between px-4 py-3 text-left bg-white hover:bg-zinc-50/50 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${showExcelBridge ? 'bg-black text-white' : 'text-zinc-400 group-hover:text-black'}`}>
                                            <FileText size={14} />
                                        </div>
                                        <span className={`text-[12px] font-bold transition-colors ${showExcelBridge ? 'text-black' : 'text-zinc-500 group-hover:text-black'}`}>Excel Bridge</span>
                                    </div>
                                    <ChevronDown size={14} className={`text-zinc-300 transition-transform duration-300 ${showExcelBridge ? 'rotate-180 text-black' : 'group-hover:text-zinc-500'}`} />
                                </button>

                                {showExcelBridge && (
                                    <div className="p-4 border-t border-zinc-100 bg-zinc-50/30 space-y-3 animate-in slide-in-from-top-1 duration-200">
                                        <textarea
                                            value={bulkPastedText}
                                            onChange={e => setBulkPastedText(e.target.value)}
                                            placeholder="Paste Excel rows here..."
                                            className="w-full h-24 bg-white border border-zinc-200 rounded-xl p-3 text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                                        ></textarea>
                                        <div className="flex justify-end">
                                            <button
                                                onClick={() => {
                                                    try {
                                                        if (!bulkPastedText.trim()) return;
                                                        const now = new Date();
                                                        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                                        const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                                        const sessionName = `${dateStr} ${timeStr}`;
                                                        const lines = bulkPastedText.trim().split(/\r?\n/);
                                                        const seen = new Set();

                                                        const parsed = lines.map((line, i) => {
                                                            if (!line.trim()) return null;
                                                            const cols = line.split('\t').map(c => (c || "").trim());
                                                            if (cols.length < 1 || !cols[0]) return null;

                                                            const name = cols[0];
                                                            const classStr = cols[3] || "Unassigned";
                                                            const school = cols[5] || "";
                                                            const grade = cols[6] || "";

                                                            const dupKey = `${name}${classStr}${school}${grade}`.replace(/\s+/g, '');
                                                            if (seen.has(dupKey)) return null;
                                                            seen.add(dupKey);

                                                            const thirdFromEnd = classStr.length >= 3 ? classStr.charAt(classStr.length - 3) : "";
                                                            const department = thirdFromEnd === '1' ? '2단지' : (thirdFromEnd === '2' ? '10단지' : '기타');

                                                            return createBlankSession({
                                                                id: `${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`,
                                                                department: department,
                                                                name: name,
                                                                classes: [classStr],
                                                                schoolGrade: `${school} ${grade}`.trim()
                                                            });
                                                        }).filter(Boolean);

                                                        if (parsed.length > 0) {
                                                            const newImport = { id: Date.now().toString(), name: `Import ${new Date().toLocaleString()}`, students: parsed, isCommited: false };
                                                            setImportHistory(prev => [newImport, ...prev]);
                                                            setActiveImportId(newImport.id);
                                                            setBulkPastedText('');
                                                            setShowExcelBridge(false);
                                                        }
                                                    } catch (err) {
                                                        console.error("Import Error:", err);
                                                        alert("데이터 처리 중 오류가 발생했습니다. 입력 데이터를 확인해주세요.");
                                                    }
                                                }}
                                                className="h-8 px-4 bg-zinc-200 text-zinc-400 rounded-lg text-[11px] font-bold hover:bg-black hover:text-white transition-all flex items-center gap-2"
                                            >
                                                <Plus size={14} /> Stage Text Data
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className={`group rounded-xl transition-all duration-200 overflow-hidden ${showHistory ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}>
                                <button
                                    onClick={() => { setShowHistory(!showHistory); if (!showHistory) { setShowSidebarAdd(false); setShowSidebarEdit(false); setShowExcelBridge(false); } }}
                                    className="w-full h-11 flex items-center justify-between px-4 py-3 text-left bg-white hover:bg-zinc-50/50 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${showHistory ? 'bg-black text-white' : 'text-zinc-400 group-hover:text-black'}`}>
                                            <Clock size={14} />
                                        </div>
                                        <span className={`text-[12px] font-bold transition-colors ${showHistory ? 'text-black' : 'text-zinc-500 group-hover:text-black'}`}>History</span>
                                    </div>
                                    <ChevronDown size={14} className={`text-zinc-300 transition-transform duration-300 ${showHistory ? 'rotate-180 text-black' : 'group-hover:text-zinc-500'}`} />
                                </button>

                                {showHistory && (
                                    <div className="p-2 border-t border-zinc-100 bg-zinc-50/30 space-y-1 animate-in slide-in-from-top-1 duration-200">
                                        <div className="px-1 py-1">
                                            <p className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                <div className="h-[1px] flex-1 bg-zinc-100" />
                                                Cloud Backup
                                                <div className="h-[1px] flex-1 bg-zinc-100" />
                                            </p>
                                            <div className="max-h-40 overflow-y-auto space-y-1 mb-4 scrollbar-hide">
                                                {cloudTabs.length > 0 ? cloudTabs.map(tab => (
                                                    <div key={tab} className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 border border-zinc-100 hover:border-indigo-200 transition-all group">
                                                        <span className="text-[11px] font-bold text-zinc-600">{tab}</span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleCloneCloudTab(tab); }}
                                                            className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[9px] font-black opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            CLONE
                                                        </button>
                                                    </div>
                                                )) : (
                                                    <button onClick={fetchCloudTabs} className="w-full py-2 text-[10px] font-bold text-indigo-400 hover:text-indigo-600 transition-colors">
                                                        Load Cloud History...
                                                    </button>
                                                )}
                                            </div>

                                            <p className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                <div className="h-[1px] flex-1 bg-zinc-100" />
                                                Local Imports
                                                <div className="h-[1px] flex-1 bg-zinc-100" />
                                            </p>
                                            <div className="space-y-1">
                                                {importHistory.map(session => (
                                                    <div
                                                        key={session.id}
                                                        onClick={() => { setActiveImportId(session.id); setImportSelectedIds(new Set()); setImportSearchQuery(''); }}
                                                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-all ${activeImportId === session.id ? 'bg-white border-zinc-300 shadow-md ring-1 ring-black/5' : 'bg-transparent border-transparent hover:bg-white hover:border-zinc-200 hover:shadow-sm'}`}
                                                    >
                                                        <div className="min-w-0">
                                                            <p className="text-[12px] font-bold text-zinc-900 truncate tracking-tight">{session.name}</p>
                                                            <p className="text-[10px] font-medium text-zinc-500">{session.students.length} students</p>
                                                        </div>
                                                        <X size={12} onClick={(e) => { e.stopPropagation(); setImportHistory(prev => prev.filter(s => s.id !== session.id)); if (activeImportId === session.id) setActiveImportId(null); }} className="text-zinc-400 hover:text-red-500 transition-colors" />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        {importHistory.length > 0 && (
                                            <div className="pt-2 px-1">
                                                <button
                                                    onClick={() => { if (confirm("모든 히스토리를 삭제하시겠습니까?")) { setImportHistory([]); setActiveImportId(null); } }}
                                                    className="w-full py-2 text-[10px] font-bold text-zinc-400 hover:text-red-500 hover:bg-red-50/50 rounded-lg transition-all flex items-center justify-center gap-1.5"
                                                >
                                                    Clear All History
                                                </button>
                                            </div>
                                        )}
                                        {importHistory.length === 0 && (
                                            <div className="p-8 text-center text-[11px] text-zinc-400 font-medium italic">
                                                No history yet
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border-t border-border mt-auto">
                        <button onClick={() => setViewMode('today')} className="w-full h-10 border border-border rounded-xl text-[11px] font-black text-zinc-400 hover:text-black hover:bg-zinc-50 hover:border-zinc-400 transition-all">Back to Dashboard</button>
                    </div>
                </aside>
            )}

            <main className="flex-1 flex flex-col min-w-0 bg-background/50">
                <header className="h-14 border-b border-border flex items-center px-6 justify-between bg-white sticky top-0 z-20">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            <h1 className="font-bold text-[15px] tracking-tight text-black flex items-center gap-2">
                                {viewMode === 'today' ? "Timeline Viewer" : viewMode === 'master' ? "All Master List" : "Import Hub"}
                            </h1>
                            {viewMode === 'today' && (
                                <div className="flex items-center gap-2 mt-0.5">
                                    <button onClick={() => setSelectedDate(new Date(selectedDate.setDate(selectedDate.getDate() - 1)))} className="p-1 hover:bg-zinc-100 rounded-md transition-colors shrink-0"><ChevronLeft size={14} /></button>

                                    <div
                                        className="relative cursor-pointer group h-6 flex items-center"
                                        onClick={() => dateInputRef.current?.showPicker?.()}
                                    >
                                        <span className="text-[11px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full ring-1 ring-indigo-200 group-hover:bg-indigo-100 transition-all flex items-center gap-1.5 shadow-sm whitespace-nowrap">
                                            <Calendar size={12} />
                                            {selectedDate.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} ({todayName})
                                        </span>
                                        <input
                                            ref={dateInputRef}
                                            type="date"
                                            className="absolute inset-0 opacity-0 pointer-events-none"
                                            value={selectedDate.toLocaleDateString('sv-SE')}
                                            onChange={(e) => {
                                                if (e.target.value) {
                                                    const newDate = new Date(e.target.value);
                                                    setSelectedDate(newDate);
                                                }
                                            }}
                                        />
                                    </div>

                                    <button onClick={() => setSelectedDate(new Date(selectedDate.setDate(selectedDate.getDate() + 1)))} className="p-1 hover:bg-zinc-100 rounded-md transition-colors shrink-0"><ChevronRight size={14} /></button>

                                    <button onClick={() => {
                                        const now = new Date();
                                        setSelectedDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
                                    }} className="h-6 px-2 text-[10px] font-black text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all ml-1">Today</button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { if (viewMode === 'import') setViewMode('today'); else setViewMode('import'); }}
                            className={`h-8 px-3 rounded-md text-[11px] font-bold transition-all flex items-center gap-2 ${viewMode === 'import' ? 'bg-zinc-100 text-black border border-border' : 'bg-black text-white'}`}
                        >
                            <DownloadCloud size={14} /> {viewMode === 'import' ? 'Exit Import' : 'Import Data'}
                        </button>
                    </div>
                </header>

                <div className="flex-1 flex flex-col min-h-0 relative">
                    {viewMode !== 'import' ? (
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                            <div className="flex items-center gap-2 mb-6 flex-wrap overflow-x-auto pb-2 scrollbar-hide">
                                <div className="relative group min-w-[200px]">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                                    <input placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-9 w-48 bg-muted/40 border border-border rounded-xl pl-9 pr-4 text-[12px] focus:outline-none focus:ring-1 focus:ring-black/10 transition-all font-medium" />
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

                                <button
                                    onClick={() => {
                                        const newPinned = !isFilterPinned;
                                        setIsFilterPinned(newPinned);
                                        localStorage.setItem('impact7_pinned', newPinned);
                                        if (newPinned) localStorage.setItem('impact7_filters', JSON.stringify(filters));
                                    }}
                                    className={`h-9 w-9 flex items-center justify-center rounded-xl border transition-all shrink-0 ${isFilterPinned ? 'text-indigo-600 bg-indigo-50 border-indigo-200 shadow-sm' : 'text-zinc-300 hover:text-zinc-500 border-zinc-200'}`}
                                >
                                    <Pin size={14} fill={isFilterPinned ? "currentColor" : "none"} />
                                </button>
                            </div>
                            {selectedSessionIds.size > 0 && (
                                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-2xl border border-white/50 shadow-[0_20px_50px_rgba(0,0,0,0.15)] rounded-2xl px-6 py-4 flex items-center gap-6 z-50 animate-in slide-in-from-bottom-5 ring-1 ring-black/[0.03]">
                                    <div className="flex items-center gap-3 pr-5 border-r border-black/[0.08]">
                                        <span className="text-xl font-black text-black/90">{selectedSessionIds.size}</span>
                                        <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest leading-none">Selected</span>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <span className="text-[11px] font-black text-black/30 uppercase tracking-tighter shrink-0">일괄처리</span>
                                        <div className="flex gap-1.5">
                                            <button onClick={() => handleBulkStatusUpdate('attendance')} className="h-9 px-4 rounded-xl text-[11px] font-black text-white transition-all shadow-sm" style={{ backgroundColor: '#84994F' }}>출석</button>
                                            <button onClick={() => handleBulkStatusUpdate('late')} className="h-9 px-4 rounded-xl text-[11px] font-black text-white transition-all shadow-sm" style={{ backgroundColor: '#FCB53B' }}>지각</button>
                                            <button onClick={() => handleBulkStatusUpdate('absent')} className="h-9 px-4 rounded-xl text-[11px] font-black text-white transition-all shadow-sm" style={{ backgroundColor: '#B45253' }}>결석</button>
                                            <button onClick={() => handleBulkStatusUpdate('waiting')} className="h-9 px-4 rounded-xl text-[11px] font-black text-black/70 transition-all shadow-sm" style={{ backgroundColor: '#FFE797' }}>취소</button>
                                        </div>
                                    </div>

                                    <div className="pl-6 border-l border-black/[0.08] flex gap-2">
                                        <button onClick={() => setSelectedSessionIds(new Set())} className="p-2 text-black/20 hover:text-black/40 transition-all"><X size={18} /></button>
                                    </div>

                                </div>
                            )}

                            <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden mb-20 overflow-x-auto">
                                {filteredSessions.length > 0 ? (
                                    <table className="w-full text-left border-collapse min-w-[800px]">
                                        <thead className="bg-zinc-50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-widest sticky top-0 z-10">
                                            <tr>
                                                <th className="px-6 py-4 w-12 text-center"><input type="checkbox" className="w-3.5 h-3.5 rounded accent-black" checked={selectedSessionIds.size === filteredSessions.length && filteredSessions.length > 0} onChange={() => { if (selectedSessionIds.size === filteredSessions.length) setSelectedSessionIds(new Set()); else setSelectedSessionIds(new Set(filteredSessions.map(s => s.id))); }} /></th>
                                                <th className="px-6 py-4">Dept</th>
                                                <th className="px-6 py-4">Name</th>
                                                <th className="px-6 py-4">School/Class</th>
                                                <th className="px-6 py-4">Planned Time</th>
                                                <th className="px-6 py-4">Schedule</th>
                                                <th className="px-6 py-4">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50 text-sm">
                                            {filteredSessions.map(s => (
                                                <tr key={s.id} onClick={() => openDetail(s.id)} className={`hover:bg-zinc-50 transition-colors cursor-pointer ${selectedSessionIds.has(s.id) ? 'bg-zinc-50' : ''}`}>
                                                    <td className="px-6 py-4 text-center" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedSessionIds.has(s.id)} onChange={() => toggleSelection(s.id)} className="w-3.5 h-3.5 rounded accent-black" /></td>
                                                    <td className="px-6 py-4 font-bold text-xs">{s.department}</td>
                                                    <td className="px-6 py-4 font-black text-[13px]">{s.name}</td>
                                                    <td className="px-6 py-4 text-xs font-black text-black/70">
                                                        {s.schoolName}{s.grade}{s.classes && s.classes[0] ? `/${s.classes[0]}` : ''}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-1.5">
                                                            <Clock size={12} className={s.status === 'waiting' && s.attendanceTime && s.attendanceTime < new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' }) ? "text-red-500" : "text-zinc-300"} />
                                                            <span className={`text-[12px] font-black ${s.status === 'waiting' && s.attendanceTime && s.attendanceTime < new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' }) ? "text-red-600 animate-pulse" : "text-black"}`}>
                                                                {s.attendanceTime || '--:--'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex gap-1 flex-wrap">
                                                            {s.attendanceDays && s.attendanceDays.length > 0 ? s.attendanceDays.map(d => (
                                                                <span key={d} className={`px-1.5 py-0.5 rounded text-[10px] font-black ${d === todayName ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-600' : 'bg-zinc-100 text-zinc-500'}`}>
                                                                    {d}
                                                                </span>
                                                            )) : <span className="text-[10px] text-zinc-300 font-bold italic">Unassigned</span>}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                                            <button
                                                                onClick={() => handleInstantStatus(s, 'attendance')}
                                                                className={`h-7 px-2.5 rounded-lg text-[10px] font-black transition-all border ${s.status === 'attendance' ? 'text-white border-transparent' : 'bg-zinc-100/50 text-zinc-400 border-zinc-200/50 hover:bg-white hover:border-zinc-300'}`}
                                                                style={s.status === 'attendance' ? { backgroundColor: '#84994F' } : {}}
                                                            >출석</button>
                                                            <button
                                                                onClick={() => handleInstantStatus(s, 'late')}
                                                                className={`h-7 px-2.5 rounded-lg text-[10px] font-black transition-all border ${s.status === 'late' ? 'text-white border-transparent' : 'bg-zinc-100/50 text-zinc-400 border-zinc-200/50 hover:bg-white hover:border-zinc-300'}`}
                                                                style={s.status === 'late' ? { backgroundColor: '#FCB53B' } : {}}
                                                            >지각</button>
                                                            <button
                                                                onClick={() => handleInstantStatus(s, 'absent')}
                                                                className={`h-7 px-2.5 rounded-lg text-[10px] font-black transition-all border ${s.status === 'absent' ? 'text-white border-transparent' : 'bg-zinc-100/50 text-zinc-400 border-zinc-200/50 hover:bg-white hover:border-zinc-300'}`}
                                                                style={s.status === 'absent' ? { backgroundColor: '#B45253' } : {}}
                                                            >결석</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-zinc-50/20 rounded-3xl border border-dashed border-zinc-200 m-4">
                                        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-zinc-100 flex items-center justify-center mb-6">
                                            <Users size={32} className="text-zinc-200" />
                                        </div>
                                        <h3 className="text-lg font-black tracking-tight text-zinc-900 mb-2">
                                            {sessions.length === 0 ? "데이터가 비어 있습니다" : "조건에 맞는 학생이 없습니다"}
                                        </h3>
                                        <p className="text-sm text-zinc-500 max-w-[300px] leading-relaxed mb-8">
                                            {sessions.length === 0
                                                ? "상단의 'Import Data' 버튼이나 아래 버튼을 눌러 학생 정보를 먼저 추가해 주세요."
                                                : `현재 '${todayName}요일' 등원 예정 학생이 없거나 필터와 일치하는 결과가 없습니다.`}
                                        </p>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => { setViewMode('master'); console.log("Switched to Master"); }}
                                                className={`h-10 px-6 bg-white border rounded-xl text-[12px] font-black hover:bg-zinc-50 transition-all shadow-sm ${viewMode === 'master' ? 'border-black ring-1 ring-black' : 'border-zinc-200'}`}
                                            >
                                                Master List 보기
                                            </button>
                                            <button
                                                onClick={() => { setViewMode('import'); setShowExcelBridge(true); }}
                                                className="h-10 px-6 bg-black text-white rounded-xl text-[12px] font-black hover:bg-zinc-800 transition-all shadow-lg shadow-black/10"
                                            >
                                                데이터 임포트하기
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col overflow-hidden bg-white">
                            {activeImportId ? (
                                <div className="flex-1 flex flex-col min-h-0">
                                    <div className="flex flex-col justify-center px-8 py-4 border-b border-zinc-100 bg-zinc-50/20 gap-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-6">
                                                <div className="flex items-center gap-4">
                                                    <span className="text-4xl font-black tabular-nums tracking-tighter" key={importSelectedIds.size}>
                                                        {importSelectedIds.size}
                                                    </span>
                                                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-none">
                                                        Selected<br />Students
                                                    </span>
                                                </div>
                                                <div className="relative group">
                                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                                                    <input
                                                        placeholder="Search staged data..."
                                                        value={importSearchQuery}
                                                        onChange={e => setImportSearchQuery(e.target.value)}
                                                        className="h-8 w-60 bg-white border border-border rounded-lg pl-9 pr-3 text-[11px] focus:outline-none focus:ring-1 focus:ring-black/10 transition-all font-medium shadow-sm"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={async () => {
                                                        const curr = importHistory.find(h => h.id === activeImportId);
                                                        if (curr) {
                                                            const success = await handleCreateSessions(curr.students);
                                                            if (success) {
                                                                // 히스토리에서 즉시 삭제하지 않고 상태만 변경 (사용자가 나중에 닫을 수 있도록)
                                                                // 또는 요청대로 보관이 필요하다면 setViewMode('today')로만 이동
                                                                setViewMode('today');
                                                            }
                                                        }
                                                    }}
                                                    className="h-8 px-6 bg-black text-white rounded-lg text-[11px] font-black transition-all flex items-center gap-2 shadow-lg shadow-black/10 opacity-20 hover:opacity-100 grayscale hover:grayscale-0"
                                                >
                                                    <Save size={14} /> Commit to Database
                                                </button>
                                                <button onClick={() => { setImportHistory(prev => prev.filter(h => h.id !== activeImportId)); setActiveImportId(null); }} className="h-8 px-4 text-destructive font-black text-[11px] hover:bg-destructive/5 rounded-lg transition-all">Discard</button>
                                            </div>
                                        </div>

                                        <div className="bg-white/80 p-1.5 rounded-2xl border border-zinc-100 shadow-sm flex flex-col gap-0.5">
                                            {/* 정규 줄 */}
                                            <div className="flex items-center justify-between pl-2 pr-1 py-0.5">
                                                <div className="flex items-center gap-4">
                                                    <div className="flex gap-0.5">
                                                        {['월', '화', '수', '목', '금', '토', '일'].map(d => (
                                                            <button
                                                                key={d}
                                                                onClick={() => setImportBatchDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                                                                className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all border ${importBatchDays.includes(d) ? 'bg-black text-white border-black ring-2 ring-black/5' : 'bg-transparent text-zinc-300 border-zinc-100 hover:text-black hover:border-black/40'}`}
                                                            >
                                                                {d}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="h-4 w-[1px] bg-zinc-100" />
                                                    <input
                                                        type="time"
                                                        value={importBatchTime}
                                                        onChange={e => setImportBatchTime(e.target.value)}
                                                        className={`h-6 px-1.5 border border-zinc-100 rounded text-[10px] font-bold focus:outline-none focus:ring-1 focus:ring-black/10 bg-zinc-50/50 transition-colors ${importBatchTime ? 'text-black' : 'text-zinc-400 hover:text-black'}`}
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleApplyRegularSchedule}
                                                    className="h-6 px-3 bg-black text-white rounded-md text-[9px] font-black transition-all flex items-center gap-1.5 shadow-sm opacity-20 hover:opacity-100 grayscale hover:grayscale-0"
                                                >
                                                    <Clock size={10} /> 정규 저장
                                                </button>
                                            </div>

                                            {/* 특강 줄 */}
                                            <div className="flex items-center justify-between pl-2 pr-1 py-0.5 border-t border-zinc-50/50">
                                                <div className="flex items-center gap-4">
                                                    <div className="flex gap-0.5">
                                                        {['월', '화', '수', '목', '금', '토', '일'].map(d => (
                                                            <button
                                                                key={d}
                                                                onClick={() => setImportSpecialBatchDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                                                                className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all border ${importSpecialBatchDays.includes(d) ? 'bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-500/10' : 'bg-transparent text-indigo-100 border-indigo-50 hover:text-indigo-600 hover:border-indigo-400'}`}
                                                            >
                                                                {d}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="h-4 w-[1px] bg-indigo-50" />
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="time"
                                                            value={importSpecialBatchTime}
                                                            onChange={e => setImportSpecialBatchTime(e.target.value)}
                                                            className={`h-6 px-1.5 border border-indigo-50/50 rounded text-[10px] font-bold focus:outline-none focus:ring-1 focus:ring-indigo-100 bg-indigo-50/30 transition-colors ${importSpecialBatchTime ? 'text-indigo-600' : 'text-indigo-200 hover:text-indigo-600'}`}
                                                        />
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="date"
                                                                value={importBatchStartDate}
                                                                onChange={e => setImportBatchStartDate(e.target.value)}
                                                                className={`h-6 px-1 border border-indigo-50/50 rounded text-[9px] font-bold focus:outline-none bg-indigo-50/30 transition-colors min-w-[95px] ${importBatchStartDate ? 'text-indigo-600' : 'text-indigo-200 hover:text-indigo-600'}`}
                                                            />
                                                            <span className="text-[10px] text-indigo-100">-</span>
                                                            <input
                                                                type="date"
                                                                value={importBatchEndDate}
                                                                onChange={e => setImportBatchEndDate(e.target.value)}
                                                                className={`h-6 px-1 border border-indigo-50/50 rounded text-[9px] font-bold focus:outline-none bg-indigo-50/30 transition-colors min-w-[95px] ${importBatchEndDate ? 'text-indigo-600' : 'text-indigo-200 hover:text-indigo-600'}`}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={handleApplySpecialSchedule}
                                                    className="h-6 px-3 bg-indigo-600 text-white rounded-md text-[9px] font-black transition-all flex items-center gap-1.5 shadow-sm opacity-20 hover:opacity-100 grayscale hover:grayscale-0"
                                                >
                                                    <Zap size={10} /> 특강 저장
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex-1 overflow-y-auto px-8 py-6 relative">
                                        <table className="w-full border-collapse bg-white border border-border rounded-2xl overflow-hidden">
                                            <thead className="bg-zinc-50/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-widest text-left">
                                                <tr>
                                                    <th className="px-6 py-4 w-12 text-center">
                                                        <input
                                                            type="checkbox"
                                                            className="w-3.5 h-3.5 rounded accent-black"
                                                            checked={stagedFilteredStudents.length > 0 && stagedFilteredStudents.every(s => importSelectedIds.has(s.id))}
                                                            onChange={() => {
                                                                if (stagedFilteredStudents.every(s => importSelectedIds.has(s.id))) {
                                                                    // Deselect only the currently filtered ones
                                                                    const newSelection = new Set(importSelectedIds);
                                                                    stagedFilteredStudents.forEach(s => newSelection.delete(s.id));
                                                                    setImportSelectedIds(newSelection);
                                                                } else {
                                                                    // Select all currently filtered ones
                                                                    const newSelection = new Set(importSelectedIds);
                                                                    stagedFilteredStudents.forEach(s => newSelection.add(s.id));
                                                                    setImportSelectedIds(newSelection);
                                                                }
                                                            }}
                                                        />
                                                    </th>
                                                    <th className="px-6 py-4">소속</th>
                                                    <th className="px-6 py-4">이름</th>
                                                    <th className="px-6 py-4">반명</th>
                                                    <th className="px-6 py-4">학교학년</th>
                                                    <th className="px-6 py-4 text-center">Schedule</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/50">
                                                {stagedFilteredStudents.map(st => {
                                                    if (!st || !st.id) return null;
                                                    return (
                                                        <tr
                                                            key={st.id}
                                                            onClick={() => {
                                                                setImportSelectedIds(prev => {
                                                                    const n = new Set(prev);
                                                                    if (n.has(st.id)) n.delete(st.id);
                                                                    else n.add(st.id);
                                                                    return n;
                                                                });
                                                            }}
                                                            className={`group cursor-pointer transition-colors ${importSelectedIds.has(st.id) ? 'bg-zinc-100/80' : 'hover:bg-zinc-50'}`}
                                                        >
                                                            <td className="px-6 py-4 text-center">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={importSelectedIds.has(st.id)}
                                                                    readOnly
                                                                    className="w-3.5 h-3.5 rounded accent-black cursor-pointer pointer-events-none"
                                                                />
                                                            </td>
                                                            <td className="px-6 py-4"><span className="text-[11px] font-bold px-2 py-0.5 bg-zinc-200/50 rounded-md">{st.department}</span></td>
                                                            <td className="px-6 py-4"><p className="text-[13px] font-black tracking-tight">{st.name}</p></td>
                                                            <td className="px-6 py-4"><p className="text-[12px] font-bold text-foreground/80">{st.classes?.[0]}</p></td>
                                                            <td className="px-6 py-4 text-[11px] font-medium text-muted-foreground">{st.schoolName} {st.grade}</td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex flex-col items-center gap-2">
                                                                    {/* 정규 스택 */}
                                                                    <div className="flex flex-col items-center gap-1">
                                                                        <div className="flex gap-0.5 justify-center">
                                                                            {['월', '화', '수', '목', '금', '토', '일'].map(d => {
                                                                                const isReg = st.attendanceDays?.includes(d);
                                                                                const isSpec = st.specialDays?.includes(d);
                                                                                let bgColor = 'bg-transparent text-zinc-300 border border-zinc-100';
                                                                                if (isReg && isSpec) bgColor = 'bg-emerald-400 text-white border-emerald-400 shadow-sm';
                                                                                else if (isReg) bgColor = 'bg-black text-white border-black shadow-sm';

                                                                                return <span key={d} className={`w-4.5 h-4.5 rounded-[3px] flex items-center justify-center text-[8px] font-black transition-all ${bgColor}`}>{d}</span>;
                                                                            })}
                                                                        </div>
                                                                        {st.attendanceTime && (
                                                                            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 rounded text-[9px] font-bold text-black border border-zinc-200">
                                                                                <Clock size={8} /> {st.attendanceTime}
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* 특강 스택 */}
                                                                    {(st.specialDays?.length > 0 || st.specialTime) && (
                                                                        <div className="flex flex-col items-center gap-1 pt-1.5 border-t border-zinc-100 w-full">
                                                                            <div className="flex gap-0.5 justify-center">
                                                                                {['월', '화', '수', '목', '금', '토', '일'].map(d => {
                                                                                    const isReg = st.attendanceDays?.includes(d);
                                                                                    const isSpec = st.specialDays?.includes(d);
                                                                                    let bgColor = 'bg-transparent text-indigo-100 border border-indigo-50';
                                                                                    if (isReg && isSpec) bgColor = 'bg-emerald-400 text-white border-emerald-400 shadow-sm';
                                                                                    else if (isSpec) bgColor = 'bg-indigo-600 text-white border-indigo-600 shadow-sm';

                                                                                    return <span key={d} className={`w-4.5 h-4.5 rounded-[3px] flex items-center justify-center text-[8px] font-black transition-all ${bgColor}`}>{d}</span>;
                                                                                })}
                                                                            </div>
                                                                            {st.specialTime && (
                                                                                <div className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 rounded text-[9px] font-bold text-indigo-700 border border-indigo-100">
                                                                                    <Zap size={8} /> {st.specialTime}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
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

            {/* Modal/Panel Sections Removed - Integrated into Sidebar */}
        </div >
    );
}

// Subcomponents
function SidebarInput({ ...props }) {
    return (
        <input {...props} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-black/10 transition-all font-medium placeholder:text-muted-foreground/30 shadow-sm" />
    );
}

function NavItem({ icon, label, active, onClick }) {
    return (
        <div onClick={onClick} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${active ? 'bg-zinc-100 text-black shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-zinc-50'}`}>
            <div className={active ? 'text-black' : 'text-muted-foreground'}>{icon}</div>
            <span className="text-sm font-bold truncate">{label}</span>
        </div>
    );
}

function SectionTitle({ title, noMargin }) {
    return <h3 className={`text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em] ${noMargin ? '' : 'mb-4'}`}>{title}</h3>;
}

function CheckRow({ label, value, onChange }) {
    const options = [
        { id: 'o', icon: <Check size={14} />, color: 'peer-checked:bg-green-500 peer-checked:text-white' },
        { id: 'triangle', icon: <span className="text-[10px] font-bold">▲</span>, color: 'peer-checked:bg-yellow-500 peer-checked:text-white' },
        { id: 'x', icon: <X size={14} />, color: 'peer-checked:bg-red-500 peer-checked:text-white' },
        { id: 'none', icon: <X size={14} className="rotate-45" />, color: 'peer-checked:bg-zinc-400 peer-checked:text-white' }
    ];
    return (
        <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-border shadow-sm">
            <span className="text-sm font-bold text-foreground">{label}</span>
            <div className="flex gap-2">
                {options.map(opt => (
                    <label key={opt.id} className="cursor-pointer">
                        <input type="radio" name={label} value={opt.id} checked={value === opt.id} onChange={() => onChange(opt.id)} className="hidden peer" />
                        <div className={`w-9 h-9 rounded-lg bg-zinc-50 text-muted-foreground/40 flex items-center justify-center transition-all ${opt.color} hover:bg-zinc-100`}>
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
        <div className="bg-white p-3 rounded-xl border border-border shadow-sm">
            <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1 block">{label}</label>
            <input value={value} onChange={e => onChange(e.target.value)} className="w-full bg-transparent text-sm text-foreground focus:outline-none placeholder:text-muted-foreground/20" placeholder="..." />
        </div>
    );
}

function BulkGroup({ label, onUpdate }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-tight">{label}</span>
            <div className="flex gap-1">
                <button onClick={() => onUpdate('o')} className="w-7 h-7 rounded-lg border border-border bg-zinc-50 text-green-600 hover:bg-green-500 hover:text-white transition-all flex items-center justify-center"><Check size={12} /></button>
                <button onClick={() => onUpdate('triangle')} className="w-7 h-7 rounded-lg border border-border bg-zinc-50 text-yellow-600 hover:bg-yellow-500 hover:text-white transition-all flex items-center justify-center text-[10px] font-bold">▲</button>
                <button onClick={() => onUpdate('x')} className="w-7 h-7 rounded-lg border border-border bg-zinc-50 text-red-600 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center"><X size={12} /></button>
            </div>
        </div>
    );
}

function FilterSelect({ label, value, options, onChange }) {
    return (
        <div className="space-y-1">
            <label className="text-[9px] font-bold text-muted-foreground uppercase ml-1">{label}</label>
            <select value={value} onChange={e => onChange(e.target.value)} className="w-full bg-white border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-black/10 transition-all cursor-pointer font-medium shadow-sm">
                {options.map(opt => <option key={opt} value={opt}>{opt === 'All' ? `All ${label}s` : opt}</option>)}
            </select>
        </div>
    );
}

function DayPicker({ selectedDays, onToggle }) {
    const days = ['월', '화', '수', '목', '금', '토', '일'];
    return (
        <div className="flex justify-between bg-zinc-50 p-1 rounded-lg border border-border">
            {days.map(d => (
                <button
                    key={d}
                    onClick={() => onToggle(d)}
                    className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all ${selectedDays.includes(d) ? 'bg-black text-white shadow-md' : 'text-muted-foreground hover:bg-white hover:text-black'}`}
                >
                    {d}
                </button>
            ))}
        </div>
    );
}

function createBlankSession(data) {
    const schoolParts = String(data.schoolGrade || "").split(' ');
    return {
        id: data.id || (Date.now().toString() + Math.random().toString(36).substring(2, 9)),
        studentId: "st_" + Math.random().toString(36).substring(2, 7),
        name: (data.name || "Unknown").trim(),
        department: data.department || "기타",
        parentPhones: data.parentPhones || [],
        studentPhones: data.studentPhones || [],
        classes: data.classes || ["Unassigned"],
        attendanceDays: data.attendanceDays || [],
        attendanceTime: data.attendanceTime || "",
        schoolName: schoolParts[0] || "",
        grade: schoolParts.slice(1).join(' ') || "",
        status: "waiting",
        backlogCount: 0,
        lastEditedBy: "Teacher Kim",
        checks: {
            basic: { voca: "none", idiom: "none", step3: "none", isc: "none" },
            homework: { reading: "none", grammar: "none", practice: "none", listening: "none", etc: "none" },
            review: { reading: "none", grammar: "none", practice: "none", listening: "none" },
            nextHomework: { reading: "", grammar: "", practice: "", listening: "", extra: "" },
            memos: { toDesk: "", fromDesk: "", toParent: "" },
            homeworkResult: "none",
            summaryConfirmed: false
        }
    };
}
