# 제주버스가이드 🚌

현재 위치(GPS)에서 가장 가까운 정류장을 찾고, **"이 정류장에서 특정 버스를 타고 어디까지 갈 수 있는지"** 와 그 버스의 실시간 도착예정시간을 보여주는 모바일 웹앱.

**🔗 데모:** <https://nolzenstudio.github.io/Bus/>

> 위치 권한은 HTTPS에서만 동작합니다. 위 배포 주소(HTTPS)에서 사용하세요.

## 주요 기능

- **가까운 정류장 추천** — 제주 전역 정류장 4,079곳을 내장해, GPS 좌표로 가장 가까운 8곳을 API 호출 없이 즉시 계산(하버사인)
- **여정 선택 흐름 (2단 중첩 아코디언)** — 정류장 → 지나는 버스 → 도착 정류장 → 실시간 전광판을 카드 확장/접힘으로 탐색
- **노선 그룹화** — 한 번호 아래 수십 개인 세부 계통을 `번호 + 방향`으로 묶어 리스트 정리
- **도착지 기준 필터** — 선택한 도착지를 실제로 지나는 계통만 전광판에 표시(같은 번호라도 반대 방향·무관 계통 제외)
- **LED 도착 전광판** — 실제 버스정류장 전광판을 재현, 20초마다 자동 갱신
- **위치 권한/범위 안내** — 권한 거부 시 iOS·안드로이드 재설정 안내, 제주 밖이면 범위밖 배너

## 기술 스택

- 순수 HTML / CSS / JavaScript (프레임워크 없음, 단일 파일)
- Cloudflare Workers — `bus.jeju.go.kr` 실시간 API 호출용 CORS 프록시
- GitHub Pages 배포

## 저장소 구조

- `index.html` — GitHub Pages 배포 진입점(`jeju-bus-guide-final.html`의 복사본)
- `jeju-bus-guide-final.html` — 최종 완성본(편집 기준 마스터)
- `doc/제주버스가이드_인수인계.md` — 상세 인수인계 문서(아키텍처·API·디자인·배포)
- `doc/제주특별자치도_버스정류소현황_20221101.csv` — 원본 정류장 데이터(공공데이터, `final.html`에 내장)

> ⚠️ `index.html`과 `jeju-bus-guide-final.html`은 **내용이 동일해야** 합니다. `index.html`을 편집한 뒤 `cp index.html jeju-bus-guide-final.html`로 동기화하고 **둘 다 커밋**하세요.

## 로컬 실행

정적 파일이라 별도 빌드가 없습니다. 다만 GPS 위치 권한은 HTTPS(또는 `localhost`)에서만 동작하므로 로컬 서버로 여세요.

```bash
# 저장소 루트에서
python -m http.server 8000
# 브라우저에서 http://localhost:8000/ 접속
```

## 배포 (GitHub Pages)

`main` 브랜치에 push하면 자동 재배포됩니다(1~2분 소요).

- **소스 설정:** Settings → Pages → Deploy from a branch, `main` / `root`
- Pages 최초 활성화는 저장소 소유자(admin) 계정에서만 가능합니다.

자세한 내용은 [인수인계 문서](doc/제주버스가이드_인수인계.md)를 참고하세요.

## 데이터 출처

- 정류장 현황: 제주특별자치도 공공데이터 (2022-11-01 기준)
- 실시간 도착·노선 정보: 제주버스정보시스템 `bus.jeju.go.kr`
