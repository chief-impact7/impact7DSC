import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { openDB } from 'idb';

// ─── 0. 상수 ─────────────────────────────────────────────────────────────────

/** IndexedDB 데이터베이스 이름 & 버전 */
const DB_NAME = 'impact7_db';
const DB_VERSION = 2;

/** ObjectStore 이름 */
export const STORE = {
  SESSIONS: 'sessions',    // 원생 세션
  OUTBOX: 'outbox',       // GAS 전송 대기 큐
  META: 'meta',         // 필터·설정 등 소형 메타데이터
};

/** GAS 전송 관련 설정 */
const GAS_MAX_RETRY = 5;          // 최대 재시도 횟수
const GAS_RETRY_BASE_MS = 1_000;      // 지수 백오프 기준 (ms)
const GAS_BATCH_SIZE = 20;         // 한 번에 전송할 outbox 항목 수

// ─── 1. idb 데이터베이스 초기화 ──────────────────────────────────────────────

/**
 * openDB(name, version, { upgrade }) 패턴으로 DB를 열고,
 * 필요한 ObjectStore를 생성/마이그레이션합니다.
 *
 * @returns {Promise<IDBDatabase>}  – idb 래퍼 인스턴스
 */
export async function openDatabase() {

  return openDB(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // ── v1: sessions, outbox 스토어
      if (oldVersion < 1) {
        if (!database.objectStoreNames.contains(STORE.SESSIONS)) {
          const sessStore = database.createObjectStore(STORE.SESSIONS, { keyPath: 'id' });
          // 자주 사용하는 필터 컬럼에 인덱스 추가 → filteredSessions 성능 향상
          sessStore.createIndex('by_class', 'classes', { multiEntry: true });
          sessStore.createIndex('by_department', 'department');
          sessStore.createIndex('by_attendanceDays', 'attendanceDays', { multiEntry: true });
          sessStore.createIndex('by_status', 'status');
        }

        if (!database.objectStoreNames.contains(STORE.OUTBOX)) {
          const outboxStore = database.createObjectStore(STORE.OUTBOX, {
            keyPath: 'outboxId', autoIncrement: true,
          });
          // 전송 상태별 조회용 인덱스
          outboxStore.createIndex('by_status', 'status');
          outboxStore.createIndex('by_createdAt', 'createdAt');
        }
      }

      // ── v2: meta 스토어 (필터·설정 저장)
      if (oldVersion < 2) {
        if (!database.objectStoreNames.contains(STORE.META)) {
          database.createObjectStore(STORE.META);
        }
      }
    },
    blocked() {
      console.warn('[idb] DB upgrade blocked. Please close other tabs.');
    },
    blocking() {
      console.warn('[idb] This tab is blocking a DB upgrade.');
    },
  });
}

// ─── 2. sessionStore  ────────────────────────────────────────────────────────
//
//   sessions ObjectStore에 대한 CRUD 래퍼.
//   모든 함수는 async/await 기반이며 UI 스레드를 블로킹하지 않습니다.
// ─────────────────────────────────────────────────────────────────────────────

export const sessionStore = {

  /**
   * 모든 세션을 배열로 반환합니다.
   * @returns {Promise<Session[]>}
   */
  async getAll() {
    const db = await openDatabase();
    return db.getAll(STORE.SESSIONS);
  },

  /**
   * 단일 세션을 ID로 조회합니다.
   * @param {string} id
   * @returns {Promise<Session|undefined>}
   */
  async getById(id) {
    const db = await openDatabase();
    return db.get(STORE.SESSIONS, id);
  },

  /**
   * 여러 세션을 한 번의 트랜잭션으로 upsert(put)합니다.
   * React.memo 대응: 변경 전후를 비교해 **실제 변경된 세션만** write합니다.
   *
   * @param {Session[]} sessions   – 최신 세션 배열 전체
   * @param {Session[]} prevSessions – 직전 세션 배열 (비교 기준)
   * @returns {Promise<number>}    – 실제 write된 건수
   */
  async bulkUpsert(sessions, prevSessions = []) {
    const db = await openDatabase();
    const prevMap = new Map(prevSessions.map(s => [s.id, s]));

    // 변경된 세션만 추려서 write (불필요한 I/O 최소화)
    const changed = sessions.filter(s => {
      const prev = prevMap.get(s.id);
      if (!prev) return true; // 신규
      // 빠른 비교: JSON stringify (1,000명 × shallow 비교보다 안전)
      return JSON.stringify(s) !== JSON.stringify(prev);
    });

    if (changed.length === 0) return 0;

    const tx = db.transaction(STORE.SESSIONS, 'readwrite');
    await Promise.all([
      ...changed.map(s => tx.store.put(normalizeSession(s))),
      tx.done,
    ]);
    return changed.length;
  },

  /**
   * 단일 세션 upsert (출석 상태 즉시 변경 등 단건 업데이트용)
   * @param {Session} session
   */
  async put(session) {
    const db = await openDatabase();
    return db.put(STORE.SESSIONS, normalizeSession(session));
  },

  /**
   * 세션을 ID로 삭제합니다.
   * @param {string} id
   */
  async delete(id) {
    const db = await openDatabase();
    return db.delete(STORE.SESSIONS, id);
  },

  /**
   * 모든 세션을 삭제합니다 (새로고침 초기화).
   */
  async clear() {
    const db = await openDatabase();
    return db.clear(STORE.SESSIONS);
  },

  /**
   * 오늘 요일에 해당하는 세션만 조회합니다.
   * IndexedDB 인덱스를 활용해 전체 scan을 피합니다.
   *
   * @param {string} todayName  – 예: '월', '화'
   * @returns {Promise<Session[]>}
   */
  async getTodaySessions(todayName) {
    const db = await openDatabase();
    return db.getAllFromIndex(STORE.SESSIONS, 'by_attendanceDays', todayName);
  },
};

// ─── 3. metaStore  ───────────────────────────────────────────────────────────
//
//   필터, 핀 상태 등 소형 설정값 저장소.
//   기존 localStorage 코드와 1:1 교체 가능하도록 get/set 인터페이스 제공.
// ─────────────────────────────────────────────────────────────────────────────

export const metaStore = {

  /**
   * @param {string} key
   * @returns {Promise<any>}
   */
  async get(key) {
    const db = await openDatabase();
    return db.get(STORE.META, key);
  },

  /**
   * @param {string} key
   * @param {any} value
   */
  async set(key, value) {
    const db = await openDatabase();
    return db.put(STORE.META, value, key);
  },

  /**
   * @param {string} key
   */
  async delete(key) {
    const db = await openDatabase();
    return db.delete(STORE.META, key);
  },
};


// ─── 4. gasBuffer  ───────────────────────────────────────────────────────────
//
//   GAS 전송 실패 시 outbox에 항목을 보관하고,
//   다음 기회에 자동으로 재전송을 시도합니다.
//
//   outbox 스키마:
//   {
//     outboxId  : number (autoIncrement, PK)
//     sessionId : string | null
//     payload   : object  – GAS에 전달할 데이터
//     status    : 'pending' | 'sending' | 'failed' | 'sent'
//     retries   : number
//     createdAt : string (ISO)
//     sentAt    : string | null (ISO)
//   }
// ─────────────────────────────────────────────────────────────────────────────

export const gasBuffer = {

  /**
   * outbox에 전송 항목을 추가합니다.
   * 직접 GAS 전송 전 반드시 이 함수로 큐에 등록해야 유실을 방지할 수 있습니다.
   *
   * @param {object} payload    – GAS에 전달할 데이터
   * @param {string} [sessionId]
   * @returns {Promise<number>}  – 생성된 outboxId
   */
  async enqueue(payload, sessionId = null) {
    const db = await openDatabase();
    return db.add(STORE.OUTBOX, {
      sessionId,
      payload,
      status: 'pending',
      retries: 0,
      createdAt: new Date().toISOString(),
      sentAt: null,
    });
  },

  /**
   * 전송 대기 중(pending/failed)인 항목을 최대 GAS_BATCH_SIZE개 반환합니다.
   * @returns {Promise<OutboxItem[]>}
   */
  async getPending() {
    const db = await openDatabase();
    const tx = db.transaction(STORE.OUTBOX, 'readonly');
    const idx = tx.store.index('by_status');

    const pending = await idx.getAll('pending', GAS_BATCH_SIZE);
    const failed = await idx.getAll('failed', GAS_BATCH_SIZE - pending.length);
    await tx.done;

    // 실패 횟수가 GAS_MAX_RETRY 미만인 항목만 재시도
    return [
      ...pending,
      ...failed.filter(item => item.retries < GAS_MAX_RETRY),
    ];
  },

  /**
   * outboxId 목록을 '전송 완료(sent)' 상태로 마킹하고
   * DB에서 제거합니다 (전송 완료 후 정리).
   *
   * @param {number[]} outboxIds
   */
  async markSent(outboxIds) {
    if (!outboxIds.length) return;
    const db = await openDatabase();
    const tx = db.transaction(STORE.OUTBOX, 'readwrite');
    await Promise.all([
      ...outboxIds.map(id => tx.store.delete(id)),
      tx.done,
    ]);
  },

  /**
   * 전송 실패 시 재시도 카운트를 올리고 'failed' 상태로 마킹합니다.
   *
   * @param {number} outboxId
   */
  async markFailed(outboxId) {
    const db = await openDatabase();
    const item = await db.get(STORE.OUTBOX, outboxId);
    if (!item) return;
    await db.put(STORE.OUTBOX, {
      ...item,
      status: item.retries + 1 >= GAS_MAX_RETRY ? 'failed' : 'pending',
      retries: item.retries + 1,
    });
  },

  /**
   * outbox에 쌓인 항목 수를 반환합니다.
   * @returns {Promise<number>}
   */
  async pendingCount() {
    const db = await openDatabase();
    const tx = db.transaction(STORE.OUTBOX, 'readonly');
    const count = await tx.store.index('by_status').count('pending');
    await tx.done;
    return count;
  },
};

// ─── 5. GAS 전송 함수 (버퍼 연동) ─────────────────────────────────────────────
//
//   기존 Dashboard.jsx의 sendDataToGAS() 를 대체합니다.
//   호출 흐름:
//     1. outbox 에 enqueue (데이터 유실 방지)
//     2. 즉시 GAS 전송 시도
//     3. 성공 → outbox 항목 삭제
//     4. 실패 → outbox에 'failed' 마킹, 백그라운드 재전송 스케줄
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GAS Web App에 데이터를 전송합니다.
 * 내부적으로 outbox 버퍼를 사용해 전송 실패 시 데이터 유실을 방지합니다.
 *
 * @param {string}  gasUrl   – GAS Web App URL
 * @param {object}  data     – 전송할 페이로드
 * @param {string}  [sessionId]
 * @returns {Promise<boolean>}  – 전송 성공 여부
 */
export async function sendToGAS(gasUrl, data, sessionId = null) {
  const payload = {
    date: data.date || new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    ...data,
  };

  // ① outbox에 먼저 등록 (실패해도 데이터 보존)
  const outboxId = await gasBuffer.enqueue(payload, sessionId);

  try {
    await _fetchGAS(gasUrl, payload);

    // ② 전송 성공 → outbox에서 제거
    await gasBuffer.markSent([outboxId]);
    return true;

  } catch (err) {
    console.warn('[GAS] 전송 실패, outbox에 보관:', err.message);

    // ③ 전송 실패 → 실패 카운트 증가
    await gasBuffer.markFailed(outboxId);

    // ④ 백그라운드 재전송 스케줄 (지수 백오프)
    scheduleFlush(gasUrl);
    return false;
  }
}

/**
 * outbox에 쌓인 'pending' / 'failed' 항목을 일괄 재전송합니다.
 * 탭 포커스 복귀 시, 또는 타이머 기반으로 호출합니다.
 *
 * @param {string} gasUrl
 * @returns {Promise<{success: number, fail: number}>}
 */
export async function flushOutbox(gasUrl) {
  const items = await gasBuffer.getPending();
  if (!items.length) return { success: 0, fail: 0 };

  let success = 0, fail = 0;

  for (const item of items) {
    // 지수 백오프 딜레이 (재시도 횟수에 따라)
    if (item.retries > 0) {
      await _sleep(GAS_RETRY_BASE_MS * 2 ** (item.retries - 1));
    }

    try {
      await _fetchGAS(gasUrl, item.payload);
      await gasBuffer.markSent([item.outboxId]);
      success++;
    } catch {
      await gasBuffer.markFailed(item.outboxId);
      fail++;
    }
  }

  if (success > 0) {
    console.info(`[GAS] flush 완료: ${success}건 전송, ${fail}건 실패`);
  }

  return { success, fail };
}

// ─── 6. 데이터 정규화 & 중복 제거 ────────────────────────────────────────────
//
//   Dashboard.jsx의 filteredSessions useMemo 부하를 줄이기 위해
//   IndexedDB에 저장하기 전 데이터를 정규화합니다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 세션 객체를 정규화합니다.
 * - 배열 타입 필드가 실제 배열인지 보장
 * - 빈 문자열 → undefined 정리 (저장 용량 절약)
 * - classes[0] 기준 정렬 키 추가 (IndexedDB 인덱스 성능)
 *
 * @param {object} raw  – 원본 세션 객체
 * @returns {Session}   – 정규화된 세션
 */
export function normalizeSession(raw) {
  return {
    ...raw,
    // 배열 타입 보장
    classes: toArray(raw.classes),
    attendanceDays: toArray(raw.attendanceDays),
    specialDays: toArray(raw.specialDays),
    extraDays: toArray(raw.extraDays),
    parentPhones: toArray(raw.parentPhones),
    studentPhones: toArray(raw.studentPhones),
    // 빈 문자열 정리
    department: raw.department || '기타',
    schoolName: raw.schoolName || '',
    grade: raw.grade || '',
    attendanceTime: raw.attendanceTime || '',
    // checks 안전 보장
    checks: normalizeChecks(raw.checks),
    // 중복 방지용 정규화 키 (이름 + 반 조합)
    _dedupeKey: `${(raw.name || '').trim()}_${(toArray(raw.classes)[0] || '')}`,
  };
}

/**
 * checks 필드를 안전하게 정규화합니다.
 * @param {object} checks
 * @returns {object}
 */
export function normalizeChecks(checks = {}) {
  return {
    basic: {
      voca: 'none', idiom: 'none', step3: 'none', isc: 'none',
      ...(checks.basic || {}),
    },
    homework: {
      reading: 'none', grammar: 'none', practice: 'none', listening: 'none', etc: 'none',
      ...(checks.homework || {}),
    },
    review: {
      reading: 'none', grammar: 'none', practice: 'none', listening: 'none',
      ...(checks.review || {}),
    },
    nextHomework: {
      reading: '', grammar: '', practice: '', listening: '', extra: '',
      ...(checks.nextHomework || {}),
    },
    memos: {
      toDesk: '', fromDesk: '', toParent: '',
      ...(checks.memos || {}),
    },
    homeworkResult: checks.homeworkResult ?? 'none',
    summaryConfirmed: checks.summaryConfirmed ?? false,
  };
}

/**
 * 배열 또는 쉼표 구분 문자열을 배열로 변환합니다.
 * @param {any} val
 * @returns {string[]}
 */
function toArray(val) {
  if (Array.isArray(val)) {
    return val.flatMap(v =>
      typeof v === 'string' ? v.split(/[,/\s]+/).map(s => s.trim().replace(/['"\[\]]/g, '')) : v
    ).filter(Boolean);
  }
  if (typeof val === 'string' && val.trim()) {
    return val.split(/[,/\s]+/).map(v => v.trim().replace(/['"\[\]]/g, '')).filter(Boolean);
  }
  return [];
}

/**
 * 세션 배열에서 중복을 제거합니다.
 * 중복 기준: name + classes[0] 조합 (정규화된 _dedupeKey)
 *
 * @param {Session[]} sessions
 * @returns {Session[]}  – 중복 제거된 세션 배열
 */
export function deduplicateSessions(sessions) {
  const seen = new Map();
  for (const s of sessions) {
    const key = s._dedupeKey || `${(s.name || '').trim()}_${(toArray(s.classes)[0] || '')}`;
    if (!seen.has(key)) {
      seen.set(key, s);
    }
    // 중복 발견 시 더 최근에 수정된 항목 유지
    else {
      const prev = seen.get(key);
      if ((s.updatedAt || '') > (prev.updatedAt || '')) {
        seen.set(key, s);
      }
    }
  }
  return Array.from(seen.values());
}

// ─── 7. React Hook: useSessions ──────────────────────────────────────────────
//
//   Dashboard.jsx의 useEffect + localStorage 코드를
//   이 훅으로 교체하면 됩니다.
//
//   사용 예:
//   const { sessions, setSessions, isLoaded, pendingCount } = useSessions(GAS_URL);
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} UseSessionsReturn
 * @property {Session[]} sessions            – 현재 세션 목록
 * @property {React.Dispatch}  setSessions   – 세션 업데이트 함수
 * @property {boolean} isLoaded              – 초기 로드 완료 여부
 * @property {number}  pendingCount          – GAS 전송 대기 건수
 * @property {Function} sync                 – Cloud → IndexedDB 수동 동기화
 * @property {Function} flush                – outbox 수동 flush
 */

/**
 * IndexedDB 기반 세션 상태 훅.
 * Dashboard.jsx의 초기 로드 / 저장 / 동기화 로직을 대체합니다.
 *
 * @param {string} gasUrl  – GAS Web App URL
 * @returns {UseSessionsReturn}
 */
export function useSessions(gasUrl) {
  const [sessions, setSessions] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const prevSessionsRef = useRef([]);

  // ── 초기 로드 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await sessionStore.getAll();
        if (!cancelled) {
          const normalized = deduplicateSessions(stored.map(normalizeSession));
          setSessions(normalized);
          prevSessionsRef.current = normalized;
          setIsLoaded(true);
        }
      } catch (err) {
        console.error('[useSessions] 초기 로드 실패:', err);
        if (!cancelled) setIsLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ── 세션 변경 시 IndexedDB에 비동기 저장 ──────────────────────────────────
  useEffect(() => {
    if (!isLoaded) return;

    // 마운트 직후의 쓸데없는 write 방지
    const prev = prevSessionsRef.current;
    if (sessions === prev) return;

    const timeout = setTimeout(async () => {
      try {
        const written = await sessionStore.bulkUpsert(sessions, prev);
        if (written > 0) {
          console.debug(`[idb] ${written}개 세션 저장 완료`);
        }
        prevSessionsRef.current = sessions;
      } catch (err) {
        console.error('[idb] 세션 저장 실패:', err);
      }
    }, 300); // 300ms 디바운스: 연속 상태 업데이트 일괄 처리

    return () => clearTimeout(timeout);
  }, [sessions, isLoaded]);

  // ── outbox 대기 건수 주기적 확인 ──────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded) return;

    const check = async () => {
      const count = await gasBuffer.pendingCount();
      setPendingCount(count);
    };

    check();
    const id = setInterval(check, 30_000); // 30초마다
    return () => clearInterval(id);
  }, [isLoaded]);

  // ── 탭 포커스 복귀 시 outbox flush ────────────────────────────────────────
  useEffect(() => {
    if (!gasUrl) return;

    const onFocus = () => {
      flushOutbox(gasUrl).then(({ success }) => {
        if (success > 0) {
          gasBuffer.pendingCount().then(setPendingCount);
        }
      });
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [gasUrl]);

  // ── Cloud → IndexedDB 수동 동기화 ─────────────────────────────────────────
  const sync = useCallback(async () => {
    if (!gasUrl) return { success: false, count: 0 };

    try {
      const res = await fetch(gasUrl, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
      });
      const data = await res.json();

      if (!Array.isArray(data)) {
        throw new Error('GAS 응답이 배열이 아닙니다.');
      }

      const normalized = deduplicateSessions(data.map(normalizeSession));

      // IndexedDB에 일괄 저장
      await sessionStore.clear();
      await sessionStore.bulkUpsert(normalized, []);

      // React 상태 업데이트
      setSessions(normalized);
      prevSessionsRef.current = normalized;

      return { success: true, count: normalized.length };
    } catch (err) {
      console.error('[useSessions] Cloud sync 실패:', err);
      return { success: false, count: 0, error: err.message };
    }
  }, [gasUrl]);

  // ── outbox 수동 flush ─────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (!gasUrl) return;
    const result = await flushOutbox(gasUrl);
    const count = await gasBuffer.pendingCount();
    setPendingCount(count);
    return result;
  }, [gasUrl]);

  return { sessions, setSessions, isLoaded, pendingCount, sync, flush };
}

// ─── 8. importHistory 전용 저장소 헬퍼 ──────────────────────────────────────
//
//   importHistory는 크기가 크지 않아 META 스토어에 JSON으로 저장합니다.
// ─────────────────────────────────────────────────────────────────────────────

export const importHistoryStore = {
  async load() {
    return (await metaStore.get('importHistory')) || [];
  },
  async save(history) {
    return metaStore.set('importHistory', history);
  },
};

// ─── 9. 필터 저장소 헬퍼 ─────────────────────────────────────────────────────

export const filterStore = {
  async load() {
    return (await metaStore.get('impact7_filters')) || {
      departments: [], grades: [], class: 'All', school: 'All',
    };
  },
  async save(filters) {
    return metaStore.set('impact7_filters', filters);
  },
  async clear() {
    const defaultFilters = { departments: [], grades: [], class: 'All', school: 'All' };
    return metaStore.set('impact7_filters', defaultFilters);
  },
  async loadPinned() {
    return (await metaStore.get('impact7_pinned')) === true;
  },
  async savePinned(value) {
    return metaStore.set('impact7_pinned', value);
  },
};

// ─── 10. React Hook: useImportHistory ────────────────────────────────────────
//
//   Dashboard.jsx의 importHistory 상태 + useEffect 를 대체합니다.
// ─────────────────────────────────────────────────────────────────────────────

export function useImportHistory() {
  const [importHistory, setImportHistory] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    importHistoryStore.load().then(h => {
      setImportHistory(h);
      setIsLoaded(true);
    });
  }, []);

  // 변경 시 자동 저장 (디바운스)
  useEffect(() => {
    if (!isLoaded) return;

    const timeout = setTimeout(() => {
      importHistoryStore.save(importHistory).catch(err =>
        console.error('[idb] importHistory 저장 실패:', err)
      );
    }, 500);

    return () => clearTimeout(timeout);
  }, [importHistory, isLoaded]);

  const clear = useCallback(() => {
    setImportHistory([]);
    importHistoryStore.save([]);
  }, []);

  return { importHistory, setImportHistory, isLoaded, clear };
}

// ─── 11. React Hook: useFilters ───────────────────────────────────────────────
//
//   Dashboard.jsx의 filters / isFilterPinned 상태 + useEffect 를 대체합니다.
// ─────────────────────────────────────────────────────────────────────────────

export function useFilters() {
  const DEFAULT_FILTERS = { departments: [], grades: [], class: 'All', school: 'All' };

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [isFilterPinned, setIsFilterPinned] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    Promise.all([filterStore.load(), filterStore.loadPinned()]).then(([f, pinned]) => {
      setFilters(f);
      setIsFilterPinned(pinned);
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded || !isFilterPinned) return;
    filterStore.save(filters);
  }, [filters, isFilterPinned, isLoaded]);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setIsFilterPinned(false);
    filterStore.clear();
    filterStore.savePinned(false);
  }, []);

  const toggleFilterPin = useCallback((pinned) => {
    setIsFilterPinned(pinned);
    filterStore.savePinned(pinned);
    if (!pinned) filterStore.clear();
  }, []);

  return {
    filters, setFilters,
    isFilterPinned, setIsFilterPinned: toggleFilterPin,
    clearFilters,
  };
}

// ─── 12. 내부 유틸 ───────────────────────────────────────────────────────────

/**
 * GAS fetch 호출 (no-cors 모드)
 * @param {string} url
 * @param {object} payload
 */
async function _fetchGAS(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // no-cors에서는 status를 읽을 수 없으므로 응답 자체가 왔으면 성공 처리
  return res;
}

/** 밀리초 sleep */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 재전송 스케줄러 (debounce: 연속 실패 시 중복 flush 방지) */
let _flushTimer = null;
function scheduleFlush(gasUrl) {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushOutbox(gasUrl).catch(err => console.warn('[GAS] flush 스케줄 실패:', err));
  }, 5_000);
}


// ─── 13. 마이그레이션: localStorage → IndexedDB ───────────────────────────────
//
//   기존 localStorage 데이터를 IndexedDB로 일회성 이전합니다.
//   App.jsx 마운트 시점에 한 번만 호출하면 됩니다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * localStorage에 남은 legacy 데이터를 IndexedDB로 마이그레이션합니다.
 * 마이그레이션 완료 후 localStorage 키를 제거합니다.
 *
 * @returns {Promise<{migrated: boolean, sessionCount: number}>}
 */
export async function migrateFromLocalStorage() {
  const MIGRATION_KEY = 'impact7_migrated_v2';

  // 이미 마이그레이션 완료 여부 확인
  if ((await metaStore.get(MIGRATION_KEY)) === true) {
    return { migrated: false, sessionCount: 0 };
  }

  let sessionCount = 0;

  try {
    // sessions 마이그레이션
    const rawSessions = localStorage.getItem('impact7_sessions');
    if (rawSessions) {
      const parsed = JSON.parse(rawSessions);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = deduplicateSessions(parsed.map(normalizeSession));
        await sessionStore.bulkUpsert(normalized, []);
        sessionCount = normalized.length;
        localStorage.removeItem('impact7_sessions');
        console.info(`[migration] sessions ${sessionCount}건 이전 완료`);
      }
    }

    // importHistory 마이그레이션
    const rawHistory = localStorage.getItem('impact7_history');
    if (rawHistory) {
      const parsed = JSON.parse(rawHistory);
      if (Array.isArray(parsed)) {
        await importHistoryStore.save(parsed);
        localStorage.removeItem('impact7_history');
        console.info('[migration] importHistory 이전 완료');
      }
    }

    // filters 마이그레이션
    const rawFilters = localStorage.getItem('impact7_filters');
    if (rawFilters) {
      await filterStore.save(JSON.parse(rawFilters));
      localStorage.removeItem('impact7_filters');
    }

    const rawPinned = localStorage.getItem('impact7_pinned');
    if (rawPinned !== null) {
      await filterStore.savePinned(rawPinned === 'true');
      localStorage.removeItem('impact7_pinned');
    }

    // 마이그레이션 완료 플래그
    await metaStore.set(MIGRATION_KEY, true);

    return { migrated: true, sessionCount };
  } catch (err) {
    console.error('[migration] 실패:', err);
    return { migrated: false, sessionCount: 0, error: err.message };
  }
}

// ─── 14. 디버그 유틸 ─────────────────────────────────────────────────────────
//
//   브라우저 콘솔에서 직접 호출해 DB 상태를 확인할 수 있습니다.
//   (프로덕션에서는 tree-shaking으로 제거됩니다)
// ─────────────────────────────────────────────────────────────────────────────

export const debug = {
  /** 전체 세션 수 출력 */
  async countSessions() {
    const db = await openDatabase();
    return db.count(STORE.SESSIONS);
  },
  /** outbox 전체 내용 출력 */
  async dumpOutbox() {
    const db = await openDatabase();
    return db.getAll(STORE.OUTBOX);
  },
  /** IndexedDB 전체 초기화 (주의!) */
  async nukeAll() {
    const { deleteDB } = await import('idb');
    await deleteDB(DB_NAME);
    console.warn('[debug] IndexedDB 삭제 완료. 페이지를 새로고침하세요.');
  },
};
/* [Log #2111] 2024-03-21
작업: React import 방식 수정 및 _getReact 제거를 통한 화이트 스크린 오류 해결 시도. 명시적 가로채기(Explicit Imports) 사용으로 변경. */
/* [Log #2211] 2024-03-21
작업: Dashboard.jsx의 중복된 로컬 스토리지 로직 제거 및 정의되지 않은 setIsLoaded 호출 오류 수정. isSyncing 상태 추가. */
/* [Log #2275] 2024-03-21
작업: 화이트 스크린 오류 최종 해결. 
1. src/user_log.js의 React import 방식 정상화 및 _getReact 제거.
2. Dashboard.jsx의 redundant localStorage useEffect 및 정의되지 않은 setIsLoaded 호출 제거.
3. 중복된 root 경로의 user_log.js 삭제(src/user_log.js로 통합).
4. handleCloudSync가 신규 sync 라이브러리를 사용하도록 수정. */
/*
-----------------------------------------
[Log #2276] [2026-02-17 20:05:40]

사용자: localhost 주소가 5173이야?

작업: vite.config.js를 확인하여 기본 포트인 5173이 사용되고 있음을 확인하고 사용자에게 답변함.

  -----------------------------------------
   */
/*
-----------------------------------------
[Log #2277] [2026-02-17 20:07:46]

사용자: @[TerminalName: esbuild, ProcessId: 25372] 

작업: 터미널에서 발생한 Vite Internal Server Error를 확인하고 src/user_log.js의 구문 오류(주석 처리 미흡)를 해결하기 위해 파일을 분석 중.

  -----------------------------------------
   */
/* [Log #2397] 2024-03-21
작업: IndexedDB 및 GAS 연동 개선.
1. idb 정적 import로 변경하여 초기 로드 안정성 확보.
2. sync 요청 시 fetch 옵션에 { credentials: 'omit', redirect: 'follow' } 추가.
3. 초기 마이그레이션 실패 시에도 sync를 시도하도록 로직 보완. */
/* [Log #2422] 2026-02-17
작업: 서버 연결 거부 오류 확인. Vite 프로세스 재시작(npm run dev). */
/* [Log #2608] 2026-02-17
작업: Attendance 필터링 버그 수정 (Critical Fix).
1. filterStore.clear() 메서드 수정: delete 대신 기본값({ class: 'All', school: 'All' }) 설정.
2. 필터 초기화 시 class/school 속성 누락으로 인한 전체 목록 필터링 문제 해결.
3. EmptyState 컴포넌트에 filters prop 전달 및 디버그 모드 개선. */
/* [Log #2656] 2026-02-17
작업: Coursework 및 Retention 뷰 학생 정보 표시 개선.
학생 이름 옆에 학교+학년 정보를 작은 회색 글씨로 표시하도록 추가. */
/* [Log #2853] 2026-02-18
작업: 학생 상세 프로필 모달 및 오버레이 기능 구현.
학생 이름/행 클릭 시 상세 정보(이름, 학교/반, 출석 유형, 출석/과제/리텐션 현황, 메모, Pending Tasks)를 보여주는 모달 기능 추가.
Pending Tasks 입력 및 저장 기능 추가 (GAS 동기화 포함).
메인 리스트 및 임포트 스테이징 구역 모두에 적용. */
/* [Log #2918] 2026-02-18
작업: 특강 스케줄 학생 필터링 문제 해결.
기존 정규 스케줄(attendanceDays)만 확인하던 로직에서 특강 스케줄(specialDays)도 함께 확인하도록 필터 강화.
디버그 모드에서 정규/특강 인원수 각각 확인 가능하도록 세분화. */
/* [Log #2939] 2026-02-18
작업: 학생 상세 프로필 뷰를 우측 슬라이드 패널(Side Drawer)로 변경.
중앙 모달 방식에서 우측에서 슬라이드 인 되는 세로형 패널로 UI 개선.
상세 정보 가독성 향상 및 메인 화면과의 동시 작업 편의성 고려. */
/* [Log #2966] 2026-02-18
작업: 스케줄 표시 및 병합 로직 최종 보완.
메인 출석 리스트에서 정규(검정)와 특강(보라) 스케줄을 모두 표시하도록 개선.
데이터 배정 시 기존 체크 상태가 유실되지 않도록 선별적 병합(Merge) 로직 적용.
기존 학생이 수요일 특강으로 배정된 경우 오늘 출석 목록에 정상적으로 나타나도록 해결. */
/* [Log #2999] 2026-02-18
작업: 스케줄 표시 UI 단일 줄 통합 및 컬러 시스템 적용.
정규(검정), 특강(보라), 중복(초록) 컬러를 사용하여 한 줄에 모든 스케줄 표시.
오늘 요일은 더 굵은 테두리로 강조하여 등원 정당성 시각화.
메인 리스트, 임포트 리스트, 상세 프로필 패널 모두 동일한 규칙 적용. */
/* [Log #3162] 2026-02-18
작업: 스케줄 표시 고도화 및 임의요일(Arbitrary Schedule) 기능 추가.
시간 표시(하단 텍스트)를 삭제하여 UI를 간소화.
새로운 컬러 시스템 적용: 정규(초록), 특강(보라), 임의(오렌지), 중복(블랙).
오늘 요일 아이콘 확대 및 테두리 강조로 가독성 향상.
임의요일 일괄 배정 및 개별 편집 기능을 사이드바와 툴바에 통합. */
/* [Log #3218] 2026-02-18
작업: 프로필 모달 크래시(화이트스크린) 수정 및 요일 아이콘 정렬 개선.
ProfileModal에 todayName 변수가 누락되어 발생하던 ReferenceError를 해결.
메인 리스트 및 프로필 모달 내 요일 아이콘들을 가로/세로 중앙 정렬하여 시각적 균형을 맞춤. */
/* [Log #3315] 2026-02-18
작업: 특강 학생 필터링 오류 수정 및 임포트 허브 UI 최적화.
특강(specialDays)이나 임의등원(extraDays)만 있는 학생이 오늘 명단에 나타나지 않던 오류를 해결 (필터링 로직에 string/array 호환성 추가).
임포트 허브(staging)의 스케줄 셀에서는 오늘 날짜 강조(검은 테두리 및 확대)를 제거하여 관리 가독성을 높임.
데이터 정규화 로직에 특강 및 임의등원 필드를 추가하여 데이터 일관성 확보. */
/* [Log #3361] 2026-02-18
작업: 스케줄 필터링 및 요콘 매칭 로직 완전 자동화 (Robust Matching).
특강(specialDays)이나 임의등원(extraDays) 학생이 출석 명단에서 누락되던 문제를 isDayMatch 헬퍼 함수를 도입하여 해결. 정규/특강/임의 등 모든 등원 유형에 대해 일관된 매칭 알고리즘 적용.
임포트 허브(staging)의 모든 영역(테이블 및 프로필 모달)에서 오늘 날짜 강조(검은 테두리)를 비활성화하여 데이터 관리 가독성 개선. */
/* [Log #3415] 2026-02-18
작업: 데이터 통합(Merge) 및 필터 시각화 개선.
스테이징에서 실제 출석부(Attendance)로 데이터를 넘길 때(Commit), 이름과 반 정보를 기반으로 한 병합 로직을 정규화 키(_dedupeKey) 방식으로 교체하여 데이터 유실 및 중복 생성을 원천 차단.
데이터 유입 모든 단계(Cloud Import, Paste, Individual Add)에 정규화 로직을 강제 적용하여 데이터 형식이 깨지는 문제 해결.
오늘 출석 명단 헤더에 '필터링 중' 상태 표시기를 추가하여, 학년/반 필터로 인해 학생이 가려졌을 때 사용자가 즉시 인지하고 해제할 수 있도록 개선. */
/* [Log #3440] 2026-02-18
작업: 화이트스크린(ReferenceError) 긴급 수정.
isDayMatch 헬퍼 함수가 Dashboard 컴포넌트 내부에 정의되어 있어 외부 컴포넌트(ScheduleCell, ProfileModal)에서 참조하지 못하던 문제를 해결.
함수를 파일 최상위 스코프로 이동하여 모든 컴포넌트가 정상적으로 참조할 수 있도록 수정했습니다. */
/* [Log #3535] 2026-02-18 02:24
사용자: Cloud Sync 버튼을 누르면 최근 탭이 자동으로 스테이징에 로드되어야 하는데 안되고 계속 클론하고 있다. 이것부터 해결해달라.
작업: Import Hub의 CLOUD SYNC 버튼에 handleImportCloudSync 함수를 새로 구현. 기존 handleCloudSync는 DB 전체 동기화 후 Attendance로 이동하는 함수였으나, Import Hub 전용 함수는 Cloud 탭 목록을 가져온 뒤 가장 최근(첫번째) 탭의 데이터를 자동으로 Clone하여 스테이징에 즉시 표시. normalizeSession import 누락 수정. */
