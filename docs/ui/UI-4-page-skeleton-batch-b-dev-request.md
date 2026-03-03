# UI-4 Development Request
## Page Skeleton Batch B (Brand Review, Content Create, Campaign, Analytics, Email)

---

## Goal

Deliver modular skeleton pages for remaining navigation items, with selected real-data wiring where safe.

---

## Scope

### In Scope

- Add page components:
  - `BrandReview.tsx`
  - `ContentCreate.tsx`
  - `CampaignPlan.tsx`
  - `Analytics.tsx`
  - `EmailAutomation.tsx`
- `BrandReview` reads real markdown from `org_brand_settings` data path.
- Other pages use placeholder/skeleton UI with explicit TODO markers for later phases.
- Add i18n keys for all new labels in `ko.json` and `en.json`.

### Out of Scope

- Real campaign CRUD.
- Real analytics API rendering.
- Email service integration.
- Any chart library dependency assumption.

---

## Analytics Constraint

`recharts` is **not** assumed in dependency scope for this phase.

Analytics page must use plain placeholder blocks (`div`/`section`) until a dedicated chart dependency phase is approved.

---

## Target File Additions

- `apps/desktop/src/pages/BrandReview.tsx`
- `apps/desktop/src/pages/ContentCreate.tsx`
- `apps/desktop/src/pages/CampaignPlan.tsx`
- `apps/desktop/src/pages/Analytics.tsx`
- `apps/desktop/src/pages/EmailAutomation.tsx`

## Target File Updates

- `apps/desktop/src/i18n/locales/ko.json`
- `apps/desktop/src/i18n/locales/en.json`
- `apps/desktop/src/layouts/MainLayout.tsx`

---

## Acceptance Criteria

1. All sidebar items render a corresponding page component.
2. Brand Review page shows real markdown content when present.
3. Analytics renders placeholders only, with no missing dependency errors.
4. New labels are localized through i18n keys (no hardcoded final UI strings).
5. `pnpm --filter @repo/desktop type-check` passes.
6. `pnpm --filter @repo/desktop build` passes.

