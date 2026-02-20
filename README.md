# EduMonitor (경기도교육청 웹사이트 모니터링 시스템)

경기도교육청 산하 기관 및 교육지원청 웹사이트의 가용성을 모니터링하고 실시간 장애 여부를 점검하는 시스템입니다. Vercel 서버리스 환경에 최적화되어 있으며, 구글 시트를 통해 대상을 관리합니다.

## 🚀 주요 기능

- **실시간 가용성 모니터링**: 대상 웹사이트의 HTTP 상태를 주기적으로 체크합니다.
- **다단계 재시도 (4-Step Strategy)**: '잘못된 요청(400)', '시간초과' 등이 빈번한 공공기관 사이트 특성을 고려하여, 헤더 전략(Chrome, Mobile, Curl, None)과 타임아웃(최대 15초)을 변경하며 4단계로 자동 재시도합니다.
- **구글 시트 동기화**: `GOOGLE_SHEET_URL` 및 관리자 페이지를 통해 모니터링 대상을 구글 시트에서 실시간으로 가져옵니다.
- **서버리스 콜드 스타트 대응**: Vercel의 서버리스 인스턴스가 초기화될 때마다 구글 시트에서 데이터를 자동으로 복구하여 데이터 연속성을 보장합니다.
- **모바일 최적화**: 40여 개 이상의 모니터링 대상을 모바일에서도 직관적으로 확인할 수 있는 대시보드를 제공합니다.

## 🛠 기술 스택

- **Framework**: Next.js 15 (App Router, Node.js Runtime)
- **Styling**: Tailwind CSS
- **Data Store**: In-memory (globalThis) with Google Sheets Auto-Sync
- **Deployment**: Vercel

## ⚙️ 환경 설정 (Environment Variables)

Vercel 배포 시 다음 환경변수를 설정해야 합니다.

| 변수명 | 설명 | 비고 |
|--------|------|------|
| `GOOGLE_SHEET_URL` | 모니터링 대상이 포함된 구글 시트 주소 | 링크가 있는 모든 사용자 공개 필요 |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `0`으로 설정 (공공기관 구형 SSL 대응) | **필수** |

## 💻 로컬 개발 환경

1. **의존성 설치**:
   ```bash
   npm install
   ```
2. **개발 서버 실행**:
   ```bash
   npm run dev
   ```
3. **빌드 테스트**:
   ```bash
   npm run build
   ```

## 📂 프로젝트 구조

- `src/actions/index.ts`: 서버 사이드 로직 및 구글 시트 동기화 (Auto-recovery 구현)
- `src/lib/monitor.ts`: 4단계 재시도 전략이 포함된 핵심 모니터링 로직
- `src/app/`: 대시보드 및 관리자 페이지 레이아웃

---
Developed by **PYHGOSHIFT** (Digital Workforce for The 7 Parks)
