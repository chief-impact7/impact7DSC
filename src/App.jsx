import { migrateFromLocalStorage } from './user_log';
import { useEffect } from 'react';
import Dashboard from './Dashboard';

function App() {
  useEffect(() => {
    // 앱이 처음 켜질 때 딱 한 번 실행되어 데이터를 idb로 옮깁니다.
    migrateFromLocalStorage().then(({ migrated, sessionCount }) => {
      if (migrated) {
        console.log(`기존 데이터 ${sessionCount}명 이전 완료`);
      }
    });
  }, []);

  return <Dashboard />;
}

export default App;