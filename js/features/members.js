// 家族（メンバー）。人数が増えても「誰の分？」やこどもNISA が自動で増えるよう、ここから作る（docs/09）
// id：本人は 'self'、最初の子どもは 'child' に固定（以前の記録の「自分」「子ども」をそのまま使うため）

import { getAll, get, put, del, uid, getMeta } from '../db/storage.js';

export const RELATIONS = { self: '本人', spouse: '配偶者', child: '子ども', other: 'その他の家族' };
const ORDER = ['self', 'spouse', 'child', 'other'];

// 医療費の「誰の分？」で、登録していない家族を選ぶための値
export const OTHER_FAMILY = { value: 'family', label: 'ほかの家族' };

export async function loadMembers({ includeInactive = false } = {}) {
  const list = (await getAll('members')).filter((m) => includeInactive || m.active);
  return list.sort((a, b) => (ORDER.indexOf(a.relation) - ORDER.indexOf(b.relation))
    || (a.birthDate || '9999').localeCompare(b.birthDate || '9999'));
}

export function memberName(members, id) {
  if (id === OTHER_FAMILY.value) return OTHER_FAMILY.label;
  return members.find((m) => m.id === id)?.nickname || '（削除した家族）';
}

export function patientOptions(members) {
  return [...members.map((m) => ({ value: m.id, label: m.nickname })), OTHER_FAMILY];
}

export async function addMember({ relation, nickname, birthDate }) {
  const hasFirstChild = !!(await get('members', 'child'));
  const id = relation === 'child' && !hasFirstChild ? 'child' : `m-${uid()}`;
  const member = { id, relation, nickname: nickname || RELATIONS[relation], birthDate: birthDate || '', active: true };
  await put('members', member);
  return member;
}

// 起動時・バックアップ読み込み後に呼ぶ。以前の版（設定に生年月日だけを持っていた）からの移行も兼ねる
export async function ensureMembers() {
  if (!(await get('members', 'self'))) {
    await put('members', {
      id: 'self', relation: 'self', nickname: '自分', birthDate: (await getMeta('selfBirth')) || '', active: true,
    });
  }
  if (!(await get('members', 'child'))) {
    const childBirth = await getMeta('childBirth');
    const usedAsPatient = (await getAll('transactions')).some((t) => t.tax?.patient === 'child');
    if (childBirth || usedAsPatient) {
      await put('members', { id: 'child', relation: 'child', nickname: '子ども', birthDate: childBirth || '', active: true });
    }
  }
  // こどもNISA は子どものもの（以前の版では owner='family' にしていた）
  const kids = await get('accounts', 'kids_nisa');
  if (kids && kids.owner === 'family') await put('accounts', { ...kids, owner: 'child' });
  await del('meta', 'selfBirth');
  await del('meta', 'childBirth');
}
