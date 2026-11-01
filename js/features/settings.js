// 設定画面：API キー、生年月日、使い始めの残高、固定費・定期収入、バックアップ

import { getAll, put, del, uid, getMeta, setMeta, requestPersist } from '../db/storage.js';
import { MODELS, DEFAULT_MODEL } from '../config/settings.js';
import { loadMasters, runRecurring } from './transactions.js';
import { exportBackup, importBackup, daysSinceBackup } from '../db/backup.js';
import { yen, esc, todayISO, monthKey, num } from '../utils/format.js';
import { toast, isCurrent } from '../utils/ui.js';
import { loadMembers, addMember, RELATIONS } from './members.js';

// 定期登録の支払元に楽天カード・他社カードは出さない（カード明細から入るので二重になる。docs/03）
const RECURRING_ACCOUNTS = ['rakuten_bank', 'cash'];
const EVERY = [
  { value: 1, label: '毎月' }, { value: 2, label: '2か月ごと' }, { value: 6, label: '半年ごと' }, { value: 12, label: '年1回' },
];

export async function renderSettings(el) {
  const m = await loadMasters();
  const recurring = await getAll('recurring');
  const apiKey = await getMeta('apiKey', '');
  const model = await getMeta('model', DEFAULT_MODEL);
  const usage = (await getMeta('apiUsage', {}))[monthKey(todayISO())];
  const persist = await requestPersist();
  const days = await daysSinceBackup();
  const members = await loadMembers({ includeInactive: true });
  if (!isCurrent('settings')) return;
  const catOptions = (group) => m.categories.filter((c) => (group === 'income' ? c.group === 'income' : c.group !== 'income'))
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  el.innerHTML = `
    <section class="view settings">
      <h2>レシート読み取り（Claude API）</h2>
      <div class="form">
        <label>API キー<input type="password" id="api-key" autocomplete="off" value="${esc(apiKey)}" placeholder="sk-ant-..."></label>
        <p class="hint">この iPhone の中にだけ保存し、バックアップにも入れません。Anthropic Console で月の利用上限を設定しておいてください。</p>
        <label>モデル<select id="model">${Object.entries(MODELS).map(([id, v]) => `<option value="${id}"${id === model ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <p class="hint">今月の利用：${usage ? `${usage.count}枚・約${num(usage.yen)}円` : 'なし'}</p>
        <button type="button" id="save-api">保存</button>
      </div>

      <h2>家族</h2>
      <div class="form" id="members">
        ${members.map((mm) => `
          <div class="member-row${mm.active ? '' : ' inactive'}" data-id="${mm.id}">
            <label>${RELATIONS[mm.relation]}<input data-f="nickname" value="${esc(mm.nickname)}" aria-label="呼び名"></label>
            <label>生年月日<input type="date" data-f="birthDate" value="${esc(mm.birthDate)}"></label>
            ${mm.id === 'self' ? '' : `<label class="inline"><input type="checkbox" data-f="active"${mm.active ? ' checked' : ''}> 一覧に出す</label>`}
          </div>`).join('')}
        <p class="hint">呼び名（「妻」「長男」など）だけを入れ、本名は入れないでください。医療費の「誰の分？」、こどもNISA、入学の年の計算に使います。外には送りません。</p>
        <button type="button" id="save-members">保存</button>
        <div class="member-add">
          <label>追加する家族<select id="m-relation">${['spouse', 'child', 'other'].map((r) => `<option value="${r}">${RELATIONS[r]}</option>`).join('')}</select></label>
          <label>呼び名<input id="m-nickname" placeholder="妻"></label>
          <label>生年月日<input type="date" id="m-birth"></label>
          <button type="button" id="add-member">追加</button>
        </div>
      </div>

      <h2>使い始めの残高</h2>
      <div class="form" id="opening">
        ${m.accounts.map((a) => `
          <label>${esc(a.name)}${a.kind === 'card' ? '（次の引き落とし予定額。「-」は付けずにそのまま入力）' : ''}
          <input inputmode="numeric" data-acc="${a.id}" value="${Math.abs(a.openingBalance) || ''}" placeholder="0"></label>`).join('')}
        <label>この残高の日付<input type="date" id="opening-date" value="${esc(m.accounts[0].openingDate || todayISO())}"></label>
        <button type="button" id="save-opening">保存</button>
      </div>

      <h2>固定費・定期収入</h2>
      <p class="hint">口座振替の家賃・保育料や給与を登録すると、毎月その日に自動で記録されます。楽天カード払いのものはカード明細から入るので登録しません。</p>
      <ul class="cat-list" id="recurring-list">${recurring.length ? recurring.map((r) => `
        <li><div class="cat-row"><span>${esc(r.label)}<small>${esc(m.acc[r.accountId]?.name || '')}・${EVERY.find((e) => e.value === r.everyMonths)?.label || '毎月'} ${r.dayOfMonth}日${r.variable ? '・毎回確認' : ''}</small></span>
        <span>${r.variable ? '変動' : yen(r.amount)} <button type="button" class="btn-small" data-del="${r.id}">削除</button></span></div></li>`).join('')
        : '<li class="empty">まだ登録がありません</li>'}</ul>
      <div class="form" id="recurring-form">
        <label>名前<input id="r-label" placeholder="家賃"></label>
        <label>種類<select id="r-type"><option value="expense">支出</option><option value="income">収入</option></select></label>
        <label>費目<select id="r-cat">${catOptions('expense')}</select></label>
        <label>口座<select id="r-acc">${RECURRING_ACCOUNTS.map((id) => `<option value="${id}">${esc(m.acc[id].name)}</option>`).join('')}</select></label>
        <label>金額<input id="r-amount" inputmode="numeric" placeholder="0"></label>
        <label class="inline"><input type="checkbox" id="r-variable"> 毎回金額が変わる（給与など）</label>
        <label>日<input id="r-day" inputmode="numeric" value="27"></label>
        <label>くり返し<select id="r-every">${EVERY.map((e) => `<option value="${e.value}">${e.label}</option>`).join('')}</select></label>
        <label>最初の月<input type="month" id="r-start" value="${monthKey(todayISO())}"></label>
        <p class="hint">児童手当は「2か月ごと・最初の月＝次の偶数月」、賞与は「半年ごと・最初の月＝次の賞与月」にします。</p>
        <button type="button" id="add-recurring">登録</button>
      </div>

      <h2>バックアップ</h2>
      <div class="form">
        <p class="hint">最後の保存：${days === null ? 'まだありません' : `${days}日前`}。データの自動削除の保護：${persist === 'granted' ? '有効' : persist === 'denied' ? '許可されていません（ホーム画面から開くと許可されやすくなります）' : 'この環境では使えません'}</p>
        <button type="button" id="export">バックアップを保存</button>
        <label>バックアップから戻す<input type="file" id="import" accept="application/json,.json"></label>
        <p class="hint">ホーム画面のアイコンを削除するとデータも消えます。機種変更や URL を変える前にも保存してください。</p>
      </div>
    </section>`;

  const $ = (s) => el.querySelector(s);

  $('#save-api').onclick = async () => {
    await setMeta('apiKey', $('#api-key').value.trim());
    await setMeta('model', $('#model').value);
    toast('保存しました');
  };

  $('#save-members').onclick = async () => {
    for (const row of el.querySelectorAll('.member-row')) {
      const mm = members.find((x) => x.id === row.dataset.id);
      const active = row.querySelector('[data-f="active"]');
      await put('members', {
        ...mm,
        nickname: row.querySelector('[data-f="nickname"]').value.trim() || RELATIONS[mm.relation],
        birthDate: row.querySelector('[data-f="birthDate"]').value,
        active: active ? active.checked : true,
      });
    }
    toast('保存しました');
    renderSettings(el);
  };

  // 子どもを追加したら、その子のこどもNISA の口座も用意する（1人目は最初からある）
  $('#add-member').onclick = async () => {
    const relation = $('#m-relation').value;
    const mm = await addMember({ relation, nickname: $('#m-nickname').value.trim(), birthDate: $('#m-birth').value });
    if (relation === 'child' && mm.id !== 'child') {
      await put('accounts', {
        id: `kids_nisa_${mm.id}`, name: `こどもNISA（${mm.nickname}）`, kind: 'kids_nisa', liquid: false,
        owner: mm.id, openingBalance: 0, openingDate: null,
      });
    }
    toast(`${mm.nickname}を追加しました`);
    renderSettings(el);
  };

  $('#save-opening').onclick = async () => {
    const date = $('#opening-date').value || todayISO();
    for (const input of el.querySelectorAll('[data-acc]')) {
      const a = m.acc[input.dataset.acc];
      const v = Number(input.value.replace(/[^\d-]/g, '')) || 0;
      await put('accounts', { ...a, openingBalance: a.kind === 'card' ? -Math.abs(v) : v, openingDate: date });
    }
    toast('保存しました');
    renderSettings(el);
  };

  $('#r-type').onchange = () => { $('#r-cat').innerHTML = catOptions($('#r-type').value); };

  $('#add-recurring').onclick = async () => {
    const label = $('#r-label').value.trim();
    const amount = Number($('#r-amount').value.replace(/[^\d]/g, ''));
    const variable = $('#r-variable').checked;
    const day = Math.min(31, Math.max(1, Number($('#r-day').value) || 1));
    if (!label) { toast('名前を入れてください'); return; }
    if (!amount && !variable) { toast('金額を入れてください'); return; }
    await put('recurring', {
      id: uid(), label, type: $('#r-type').value, categoryId: $('#r-cat').value, accountId: $('#r-acc').value,
      amount, variable, dayOfMonth: day, everyMonths: Number($('#r-every').value),
      startMonth: $('#r-start').value || monthKey(todayISO()), endMonth: null, active: true,
    });
    const created = await runRecurring();
    toast(created ? `登録しました（${created}件を記録）` : '登録しました');
    renderSettings(el);
  };

  $('#recurring-list').onclick = async (e) => {
    const id = e.target.dataset?.del;
    if (!id || !confirm('この定期登録を削除しますか？（記録済みの分は残ります）')) return;
    await del('recurring', id);
    renderSettings(el);
  };

  $('#export').onclick = async () => {
    if (await exportBackup()) { toast('バックアップを保存しました'); renderSettings(el); }
  };

  $('#import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !confirm('今のデータをバックアップの内容で置き換えます。よろしいですか？')) return;
    try {
      await importBackup(file);
      toast('バックアップから戻しました');
      renderSettings(el);
    } catch (err) {
      toast(err.message);
    }
  };
}
