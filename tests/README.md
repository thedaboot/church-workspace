# tests

브라우저를 실제로 띄워 화면을 재는 검증 스위트. 단위 테스트 프레임워크는 쓰지 않는다 —
각 파일이 헤드리스 Chrome을 CDP로 붙잡고, 화면을 만들고, 좌표·계산값·localStorage를 재서
`PASS` / `FAIL` 줄을 찍고 종료 코드로 결과를 알린다.

```bash
npm run verify                 # 전부 (게스트 모드 dev 서버를 알아서 띄운다)
npm run verify -- calfit drag  # 골라서
npm run verify -- --jobs 3     # 동시 실행 (스크립트마다 CDP 포트가 달라 충돌 없음)
SHOTS=1 npm run verify         # 스크린샷도 저장
CHROME=/path/to/chrome npm run verify   # 크롬 경로가 다를 때
```

- 러너가 `vite --mode guest`를 띄운다. `.env.guest`가 없으면 만든다(빈 Supabase 키 = 로그인
  없이 localStorage 모드). 이 파일은 커밋하지 않는다.
- 각 스위트는 `node tests/<name>.mjs <베이스 URL>` 로 혼자서도 돌아간다.

## 스위트

| 파일 | 보는 것 |
|---|---|
| `logcheck` `mdcheck` | 활동 기록·마크다운 라운드트립 (브라우저 없이 순수 로직) |
| `aictx` | AI 프롬프트에 실리는 주변 업무 컨텍스트 |
| `errhunt` | 화면 × 데이터 상태 × 화면폭 64조합에서 ErrorBoundary·콘솔 오류 |
| `handoff` | 핸드오프 규격(토큰·모션·4개 화면 구조·업무 상세/수정) |
| `navsmoke` `onebar` `mobbits` | 내비 구조, 데스크톱/모바일 내비가 하나만 마운트되는지, 모바일 상단바 |
| `bottomgap` | 모바일 각 탭에서 마지막 내용이 하단 탭바에 가리지 않는지 |
| `modalclose` | 업무 상세 모달 바깥 클릭·드래그·닫기 |
| `batch10` `batch11` `dashfix` `wide` | 대시보드·모바일 조작·문구·KPI 배치(320~1920px) |
| `share` `onboard` | 공유 링크(프로젝트·업무), 첫 로그인 팀 설정 |
| `three` | 프로젝트 이름 수정, 모바일 가로 스크롤 잠금, 컬럼 구분 |
| `calfit` | 캘린더가 창 높이에 맞는지, 띠가 잘리지 않는지, 날짜 한 번에 선택 |
| `drag` `dragdesk` | 터치/마우스 드래그로 상태 이동, 상태 칩 드롭 |

## 셀렉터가 낡으면

앱 마크업이 바뀌면 셀렉터가 못 찾고 스크립트가 **예외로 죽는다**. 이때 종료 코드는 1이지만
`FAIL` 줄이 없어서 러너가 `CRASH`로 표시한다 — "테스트가 통과했다"와 구분되니, CRASH가
보이면 그 스위트의 셀렉터를 지금 화면 기준으로 다시 맞춰야 한다.
