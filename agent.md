# Agent Workflow Notes

## Phase Completion Rule

각 phase 개발 완료 후 아래를 반드시 수행한다.

1. 문서 작성
- 인덱스: `docs/progress/phase-index.md`
- 완료 보고서: `docs/progress/phase-<phase>-completion.md` (예: `phase-1-1-completion.md`)

2. 저장소 반영
- 변경사항 커밋
- 원격 저장소 푸시

## Minimum Completion Checklist

- [ ] `phase-index.md`에 해당 phase 상태/완료일/보고서 링크 반영
- [ ] `phase-<phase>-completion.md` 작성 완료
- [ ] `git add .`
- [ ] `git commit -m "<phase 요약 메시지>"`
- [ ] `git push`

## Latest Completion

- 1-7d: `docs/progress/phase-1-7d-completion.md` (Instagram Graph Business Discovery Crawler Replacement)
- 1-7e: `docs/progress/phase-1-7e-completion.md` (Naver Blog Hybrid Collection via Search API + RSS Fallback)
- 1-7f: `docs/progress/phase-1-7f-completion.md` (Desktop Auth Session Persistence + Dashboard Resume Routing)
- 2-1: `docs/progress/phase-2-1-completion.md` (RAG Infrastructure: Multi-Profile Embeddings + Backend-only RPC + Smoke Validation)
