import { describe, expect, it } from 'vitest'
import {
  SDD_DRAFT_FILE_NAME,
  buildSddDraftRelativePath,
  isSddDraftRelativePath,
  isSddImageRelativePath,
  isSddPrototypeRelativePath,
  normalizeSddRelativePath,
  sddDraftRelativePathForPlanPath,
  sddDraftTraceRelativePath,
  sddRequirementUnitDir,
  sddUnitChatDir,
  sddUnitImageDir,
  sddUnitProtoDir
} from './sdd'

const UUID = '123e4567-e89b-12d3-a456-426614174000'
const DRAFT = `.kunsdd/requirements/${UUID}/${SDD_DRAFT_FILE_NAME}`

describe('sdd shared paths', () => {
  it('builds a canonical requirement-unit draft path', () => {
    expect(buildSddDraftRelativePath(UUID)).toBe(DRAFT)
  })

  it('validates only uuid-backed requirement drafts under requirements/', () => {
    expect(isSddDraftRelativePath(DRAFT)).toBe(true)
    expect(isSddDraftRelativePath(`.kunsdd/requirements/not-a-uuid/requirement.md`)).toBe(false)
    expect(isSddDraftRelativePath(`.kunsdd/requirements/${UUID}/other.md`)).toBe(false)
    expect(isSddDraftRelativePath(`.kunsdd/requirements/${UUID}/nested/requirement.md`)).toBe(false)
    // The pre-unit layout is explicitly retired (clean switch, no migration).
    expect(isSddDraftRelativePath(`.kunsdd/draft/${UUID}/requirement.md`)).toBe(false)
  })

  it('derives the unit directories from the draft path', () => {
    expect(sddRequirementUnitDir(DRAFT)).toBe(`.kunsdd/requirements/${UUID}`)
    expect(sddUnitImageDir(DRAFT)).toBe(`.kunsdd/requirements/${UUID}/img`)
    expect(sddUnitProtoDir(DRAFT)).toBe(`.kunsdd/requirements/${UUID}/proto`)
    expect(sddUnitChatDir(DRAFT)).toBe(`.kunsdd/requirements/${UUID}/chat`)
    expect(sddDraftTraceRelativePath(DRAFT)).toBe(`.kunsdd/requirements/${UUID}/trace.json`)
    expect(sddRequirementUnitDir(`.kunsdd/draft/${UUID}/requirement.md`)).toBeNull()
    expect(sddUnitImageDir('not-a-draft.md')).toBeNull()
  })

  it('maps SDD plan paths back to the requirement unit', () => {
    expect(sddDraftRelativePathForPlanPath(`.kunsdd/plan/sdd-${UUID}.md`)).toBe(DRAFT)
    expect(sddDraftRelativePathForPlanPath(`.kunsdd/plan/sdd-${UUID}-2.md`)).toBe(DRAFT)
    expect(sddDraftRelativePathForPlanPath('.kunsdd/plan/other.md')).toBeNull()
  })

  it('validates per-unit image and prototype paths', () => {
    expect(normalizeSddRelativePath(`./.kunsdd\\requirements\\${UUID}\\img\\a.png`)).toBe(
      `.kunsdd/requirements/${UUID}/img/a.png`
    )
    expect(isSddImageRelativePath(`.kunsdd/requirements/${UUID}/img/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.kunsdd/requirements/${UUID}/img/nested/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.kunsdd/requirements/${UUID}/img/../escape.png`)).toBe(false)
    expect(isSddImageRelativePath(`.kunsdd/requirements/not-a-uuid/img/a.png`)).toBe(false)
    expect(isSddImageRelativePath('.kunsdd/img/wireframe.png')).toBe(false)
    expect(isSddImageRelativePath('img/wireframe.png')).toBe(false)

    expect(isSddPrototypeRelativePath(`.kunsdd/requirements/${UUID}/proto/p.html`)).toBe(true)
    expect(isSddPrototypeRelativePath('.kunsdd/proto/p.html')).toBe(false)
    expect(isSddPrototypeRelativePath(`.kunsdd/requirements/${UUID}/img/p.html`)).toBe(false)
  })
})
