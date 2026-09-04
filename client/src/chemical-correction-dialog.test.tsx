import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ChemicalCorrectionDialog, buildChemicalCorrectionPayload, cancelChemicalCorrection, canCorrectChemical, completeChemicalCorrection,
  correctChemical, dateTimeLocalValue, replaceCorrectedChemical, startChemicalCorrection,
} from './chemical-correction-dialog.js';
import { ChemicalModal } from './views.js';
import type { Chemical, UserView } from './types.js';

const owner: UserView = { id: 4, username: 'member-a', displayName: '成员甲', role: 'member', active: true, demo: true, version: 1 };
const otherMember: UserView = { id: 5, username: 'member-b', displayName: '成员乙', role: 'member', active: true, demo: true, version: 1 };
const normalAdmin: UserView = { id: 2, username: 'admin', displayName: '普通管理员', role: 'normal_admin', active: true, demo: true, version: 1 };
const hazardousBuyer: UserView = { id: 3, username: 'hazard', displayName: '危险品采购人', role: 'hazardous_buyer', active: true, demo: true, version: 1 };
const superAdmin: UserView = { id: 1, username: 'teacher', displayName: '李老师', role: 'super_admin', active: true, demo: true, version: 1 };
const chemical: Chemical = {
  id: 7, name: '乙腈', specification: 'HPLC 4L', casNumber: '75-05-8', cabinet: 'B', shelf: 2, status: 'active', version: 3,
  owner: { id: owner.id, username: owner.username, displayName: owner.displayName },
  inboundOperator: { id: otherMember.id, username: otherMember.username, displayName: otherMember.displayName },
  inboundAt: '2026-09-01T08:00:00.000Z', createdAt: '2026-08-30T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z', discardReason: null,
};

afterEach(() => { vi.restoreAllMocks(); });

describe('chemical detail correction UI', () => {
  it('shows the correction affordance only to the active owner or a super administrator', () => {
    expect(canCorrectChemical(owner, chemical)).toBe(true);
    expect(canCorrectChemical(superAdmin, chemical)).toBe(true);
    for (const user of [otherMember, normalAdmin, hazardousBuyer]) expect(canCorrectChemical(user, chemical)).toBe(false);
    expect(canCorrectChemical(owner, { ...chemical, status: 'discarded' })).toBe(false);

    const ownerHtml = renderToStaticMarkup(<ChemicalModal user={owner} chemical={chemical} onClose={() => undefined} onCorrect={() => undefined} onDiscard={() => undefined} onDone={() => undefined} />);
    expect(ownerHtml).toContain('CAS号'); expect(ownerHtml).toContain('75-05-8');
    expect(ownerHtml).toContain('调动'); expect(ownerHtml).toContain('更正信息'); expect(ownerHtml).toContain('废弃药品');
    const outsiderHtml = renderToStaticMarkup(<ChemicalModal user={otherMember} chemical={{ ...chemical, casNumber: null }} onClose={() => undefined} onCorrect={() => undefined} onDiscard={() => undefined} onDone={() => undefined} />);
    expect(outsiderHtml).toContain('未填写');
    expect(outsiderHtml).not.toContain('更正信息');
  });

  it('renders a prefilled accessible in-app modal with optional CAS and no location/owner controls', () => {
    const html = renderToStaticMarkup(<ChemicalCorrectionDialog chemical={chemical} onClose={() => undefined} onDone={() => undefined} />);
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
    expect(html).toContain('更正药品信息'); expect(html).toContain('保存更正');
    expect(html).toContain('value="乙腈"'); expect(html).toContain('value="HPLC 4L"'); expect(html).toContain('value="75-05-8"');
    expect(html).toContain('CAS号（推荐填写）'); expect(html).toContain('type="datetime-local"');
    expect(html).not.toContain('name="cabinet"'); expect(html).not.toContain('name="ownerId"');
    expect(html).not.toMatch(/\b(?:prompt|confirm)\s*\(/);
  });

  it('builds strict normalized detail payloads while allowing CAS to be cleared', () => {
    expect(buildChemicalCorrectionPayload({
      name: ' 乙腈（更正） ', specification: ' HPLC 4L ', casNumber: ' 75-05-8 ', inboundAt: '2026-09-02T09:30:00.000Z',
    }, 3)).toEqual({ name: '乙腈（更正）', specification: 'HPLC 4L', casNumber: '75-05-8', inboundAt: '2026-09-02T09:30:00.000Z', version: 3 });
    expect(buildChemicalCorrectionPayload({ name: '乙腈', specification: 'HPLC', casNumber: '  ', inboundAt: '2026-09-02T09:30:00.000Z' }, 3).casNumber).toBeNull();
    expect(() => buildChemicalCorrectionPayload({ name: '', specification: 'HPLC', casNumber: '', inboundAt: '2026-09-02T09:30:00.000Z' }, 3)).toThrow('请填写药品名称');
    expect(() => buildChemicalCorrectionPayload({ name: '乙腈', specification: 'HPLC', casNumber: '75-05-9', inboundAt: '2026-09-02T09:30:00.000Z' }, 3)).toThrow('CAS号校验位不正确');
  });

  it('round-trips an unchanged inbound timestamp without silently losing seconds or milliseconds', () => {
    const original = '2026-09-01T08:00:42.456Z';
    const localValue = dateTimeLocalValue(original);
    expect(buildChemicalCorrectionPayload({
      name: chemical.name, specification: chemical.specification, casNumber: chemical.casNumber, inboundAt: localValue,
    }, chemical.version).inboundAt).toBe(original);
    const html = renderToStaticMarkup(<ChemicalCorrectionDialog chemical={{ ...chemical, inboundAt: original }} onClose={() => undefined} onDone={() => undefined} />);
    expect(html).toContain(`value="${localValue}"`);
    expect(html).toContain('step="0.001"');
  });

  it('returns correction cancel and success to the detail without clearing non-empty search context', () => {
    const untouched = { ...chemical, id: 8, name: 'retained item' };
    const queueContext = { scope: 'incoming' as const };
    const initial = {
      chemicals: [chemical, untouched], selected: chemical, correcting: null,
      search: 'acetonitrile 75-05-8', debouncedSearch: 'acetonitrile 75-05-8', queueContext,
    };

    const opened = startChemicalCorrection(initial);
    expect(opened.selected).toBeNull();
    expect(opened.correcting).toBe(chemical);

    const cancelled = cancelChemicalCorrection(opened);
    expect(cancelled.selected).toBe(chemical);
    expect(cancelled.correcting).toBeNull();
    expect(cancelled.chemicals).toBe(initial.chemicals);
    expect(cancelled.search).toBe(initial.search);
    expect(cancelled.debouncedSearch).toBe(initial.debouncedSearch);
    expect(cancelled.queueContext).toBe(queueContext);

    const corrected = {
      ...chemical, name: 'acetonitrile corrected', specification: 'LC-MS 1 L', casNumber: '75-05-8',
      inboundAt: '2026-09-02T09:30:00.000Z', version: 4,
    };
    const completed = completeChemicalCorrection(startChemicalCorrection(cancelled), corrected);
    expect(completed.selected).toBe(corrected);
    expect(completed.correcting).toBeNull();
    expect(completed.chemicals).toEqual([corrected, untouched]);
    expect(completed.chemicals[0]).toBe(corrected);
    expect(completed.search).toBe(initial.search);
    expect(completed.debouncedSearch).toBe(initial.debouncedSearch);
    expect(completed.queueContext).toBe(queueContext);
  });

  it('uses the detail endpoint/version and can replace the visible item without resetting surrounding view state', async () => {
    const updated = { ...chemical, name: '乙腈（更正）', version: 4 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ chemical: updated }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(correctChemical(chemical.id, { name: updated.name, specification: updated.specification, casNumber: updated.casNumber, inboundAt: updated.inboundAt, version: chemical.version })).resolves.toEqual(updated);
    expect(fetchMock).toHaveBeenCalledWith('/api/chemicals/7/details', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ name: '乙腈（更正）', specification: 'HPLC 4L', casNumber: '75-05-8', inboundAt: chemical.inboundAt, version: 3 }),
    }));
    const untouched = { ...chemical, id: 8, name: '保留项' };
    expect(replaceCorrectedChemical([chemical, untouched], updated)).toEqual([updated, untouched]);
  });
});
