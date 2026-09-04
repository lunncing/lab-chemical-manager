import { useState, type FormEvent } from 'react';
import { normalizeCasNumber } from '../../shared/cas.js';
import { ActionDialog } from './action-dialog.js';
import { api } from './api.js';
import { CasNumberField } from './inventory-forms.js';
import type { Chemical, UserView } from './types.js';

export interface ChemicalCorrectionPayload {
  name: string;
  specification: string;
  casNumber: string | null;
  inboundAt: string;
  version: number;
}

interface CorrectionFields {
  name: unknown;
  specification: unknown;
  casNumber: unknown;
  inboundAt: unknown;
}

export function canCorrectChemical(user: UserView, chemical: Chemical): boolean {
  return chemical.status === 'active' && (user.role === 'super_admin' || chemical.owner.id === user.id);
}

export function buildChemicalCorrectionPayload(fields: CorrectionFields, version: number): ChemicalCorrectionPayload {
  const name = String(fields.name ?? '').trim(); const specification = String(fields.specification ?? '').trim();
  if (!name) throw new Error('请填写药品名称');
  if (!specification) throw new Error('请填写规格');
  const casNumber = normalizeCasNumber(fields.casNumber);
  const date = new Date(String(fields.inboundAt ?? ''));
  if (Number.isNaN(date.getTime())) throw new Error('入库时间无效');
  if (!Number.isInteger(version) || version < 1) throw new Error('药品版本无效');
  return { name, specification, casNumber, inboundAt: date.toISOString(), version };
}

export async function correctChemical(id: number, payload: ChemicalCorrectionPayload): Promise<Chemical> {
  return (await api<{ chemical: Chemical }>(`/chemicals/${id}/details`, { method: 'PATCH', body: JSON.stringify(payload) })).chemical;
}

export function replaceCorrectedChemical(chemicals: Chemical[], corrected: Chemical): Chemical[] {
  return chemicals.map((chemical) => chemical.id === corrected.id ? corrected : chemical);
}

export function dateTimeLocalValue(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
}

export function ChemicalCorrectionDialog({ chemical, onClose, onDone }: {
  chemical: Chemical; onClose: () => void; onDone: (chemical: Chemical) => void;
}) {
  const [name, setName] = useState(chemical.name); const [specification, setSpecification] = useState(chemical.specification);
  const [casNumber, setCasNumber] = useState(chemical.casNumber ?? ''); const [inboundAt, setInboundAt] = useState(dateTimeLocalValue(chemical.inboundAt));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = buildChemicalCorrectionPayload({ name, specification, casNumber, inboundAt }, chemical.version);
      const corrected = await correctChemical(chemical.id, payload);
      setBusy(false); onDone(corrected);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '更正失败，请重试'); setBusy(false);
    }
  }
  return <ActionDialog
    title="更正药品信息"
    description="仅更正名称、规格、CAS号和入库时间；位置请使用调动功能。"
    confirmLabel="保存更正"
    busy={busy}
    error={error}
    onClose={onClose}
    onSubmit={submit}
  >
    <div className="form-grid dialog-form-grid">
      <label>药品名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required autoFocus /></label>
      <label>规格<input value={specification} onChange={(event) => setSpecification(event.target.value)} maxLength={200} required /></label>
      <CasNumberField value={casNumber} onChange={(event) => setCasNumber(event.target.value)} />
      <label>入库时间<input type="datetime-local" step="0.001" value={inboundAt} onChange={(event) => setInboundAt(event.target.value)} required /></label>
    </div>
  </ActionDialog>;
}
