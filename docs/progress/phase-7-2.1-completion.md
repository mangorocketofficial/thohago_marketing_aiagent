# Phase 7-2.1 Completion Report

- Phase: 7-2.1
- Title: Local Image Generation Refactor
- Status: Done
- Completed On: 2026-03-05

## Summary

- Instagram 이미지 합성 경로를 로컬 런타임 중심으로 재정렬해 편집-미리보기 루프를 단순화했다.
- 공용 `@repo/media-engine` 패키지를 기준으로 API/Desktop 합성 계약을 단일화했다.
- 기존 API 내부 media 모듈은 제거하고 공용 엔진 의존으로 정리했다.

## API Behavior Update

- 템플릿/합성 로직은 API 내부 구현 대신 `@repo/media-engine`의 공용 계약을 사용한다.
- Instagram 메타데이터 저장 계약은 로컬 합성 중심 흐름에서 재사용 가능하게 유지했다.
- API 단위 테스트는 공용 엔진 기반 경로로 갱신됐다.

## UX Flow Update

- 스케줄러 Instagram 편집기는 로컬 compose 결과를 즉시 프리뷰로 반영한다.
- 채팅 완료 카드 프리뷰도 동일한 로컬 compose 계약을 사용한다.
- 텍스트/이미지 변경 시 재합성과 메타데이터 동기화가 동일 runtime 훅으로 통합됐다.

## Validation

- `pnpm --filter @repo/media-engine build` passed.
- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/desktop type-check` passed.
- `pnpm --filter @repo/api test:unit` passed.
- `pnpm type-check` and `pnpm lint` passed.

## Follow-up

- 7-2.2: 템플릿 스키마를 실제 자산 포맷(`overlays.photos/texts`)으로 고도화.
- 7-2c: 승인/리비전 플로우와 로컬 compose 편집 상태의 최종 연결.

### Decisions

[D-010]

Why this approach:
합성 엔진을 공용 패키지로 분리해 API/Desktop의 렌더 결과와 계약 드리프트를 줄였다.

Alternatives considered:
- API 전용/Desktop 전용 이중 엔진 유지 — 동작 불일치와 회귀 비용 증가로 제외.

Blockers hit:
- 기존 `apps/api/src/media/*` 경로와 신규 엔진 경로가 공존하며 참조 충돌이 발생해 공용 엔진 단일 참조로 정리했다.

Tech debt introduced:
- DEBT-010 합성 결과 시각 회귀 스냅샷(E2E/Playwright) 미도입 -> affects Phase 7-2c.
