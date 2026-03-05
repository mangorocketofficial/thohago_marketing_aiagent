# Phase 7-2.2 Completion Report

- Phase: 7-2.2
- Title: Template Schema Redesign (Dynamic Overlay Slots)
- Status: Done
- Completed On: 2026-03-05

## Summary

- Instagram 템플릿 스키마를 `main/sub` 고정 구조에서 `photos[]/texts[]/badge/header` 구조로 전환했다.
- `koica_cover_01` 실자산 포맷을 기준으로 프리셋/레지스트리/합성 파이프라인을 정렬했다.
- 에디터 텍스트 편집은 슬롯 `id` 기반 동적 렌더링으로 변경했다.

## API Behavior Update

- 템플릿 조회 응답은 `size + overlays + header` 구조를 반환한다.
- 콘텐츠 메타데이터 저장은 `overlay_texts: Record<string,string>` 계약을 기본으로 사용한다.
- 레거시 `overlay_main/sub`는 호환 목적으로만 병행 저장된다.

## UX Flow Update

- Overlay 텍스트 편집 UI는 템플릿 `texts[]` 배열을 기준으로 자동 생성된다.
- 이미지 슬롯 수는 템플릿 `photos[]` 정의를 기준으로 동적으로 계산된다.
- Badge 텍스트는 슬롯 ID 맵에서 합성 가능하게 연결됐다.

## Validation

- `pnpm --filter @repo/media-engine build` passed.
- `pnpm --filter @repo/api test:unit` passed (phase 7-2a golden 포함).
- `pnpm --filter @repo/api type-check` and `pnpm --filter @repo/desktop type-check` passed.
- `pnpm type-check` and `pnpm lint` passed.

## Follow-up

- 자산 준비 완료 시 `koica_cover_01` 외 다중 프리셋을 동일 스키마로 확장.
- 7-2c에서 편집/승인 워크플로우 메타데이터를 `overlay_texts` 단일 계약으로 완전 수렴.

### Decisions

[D-011]

Why this approach:
실제 자산 `config.json` 구조를 표준으로 채택해 템플릿 확장성과 에디터 슬롯 참조 일관성을 확보했다.

Alternatives considered:
- `mainText/subText` 고정 확장 — 템플릿 다양성(3~6 텍스트, badge) 수용 한계로 제외.

Blockers hit:
- 구 프리셋 잔여 파일이 dist에 남아 로딩 경고를 유발해 빌드 복사 단계에서 대상 디렉터리 초기화로 해결했다.
