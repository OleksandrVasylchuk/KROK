import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowsDownUp, ArrowCounterClockwise, Bank, Barbell, BookOpen, CalendarBlank, CaretLeft, CaretRight, Check, Coffee, CreditCard, DotsThree, GameController, Gift, Heart, House, MagnifyingGlass, Money, PencilSimple, Plus, Receipt, Repeat, ShoppingBag, ShoppingCart, SuitcaseRolling, Target, Trash, TrendDown, Wallet, WarningCircle, X } from '@phosphor-icons/react';
import { localDate, selectFinance } from './model.js';
import { FINANCE_CATEGORIES } from './catalog.js';
import './money.css';

const number = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const money = value => `${number.format(Math.abs(value))} ₴`;
const categoryIcons = { food: ShoppingCart, cafe: Coffee, car: ArrowsDownUp, home: House, bills: Receipt, health: Heart, sport: Barbell, book: BookOpen, game: GameController, bag: ShoppingBag, repeat: Repeat, gift: Gift, travel: SuitcaseRolling, work: Bank, other: DotsThree };
const categoryMeta = label => FINANCE_CATEGORIES.find(item => item.label === label) || { label, color: '#a8b49c', icon: 'other' };
const transactionType = item => item.type === 'income' ? 'income' : 'expense';
const accountLabel = value => value === 'cash' ? 'Готівка' : 'Картка';
const entryLabel = count => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'операція' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'операції' : 'операцій'}`;
const monthLabel = month => new Date(`${month}-01T12:00:00`).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }).replace(/\s*р\.?$/, '');
const dayLabel = date => date === localDate() ? 'Сьогодні' : new Date(`${date}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', weekday: 'short' });

function changeMonth(month, difference) {
  const [year, index] = month.split('-').map(Number);
  return localDate(new Date(year, index - 1 + difference, 1, 12)).slice(0, 7);
}

function CategoryIcon({ category, size = 20 }) {
  const meta = categoryMeta(category);
  const Icon = categoryIcons[meta.icon] || DotsThree;
  return <span className="mf-category-icon" style={{ '--category-color': meta.color }}><Icon size={size} weight="light" /></span>;
}

function Meter({ value, label, danger = false }) {
  const percent = Math.max(0, Math.min(100, value || 0));
  return <div className={`mf-meter ${danger ? 'is-over' : ''}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ transform: `scaleX(${percent / 100})` }} /></div>;
}

function MoneyDialog({ title, description, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal mf-dialog ${wide ? 'mf-dialog-wide' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}><div className="modal-content"><button type="button" className="icon-button modal-close" aria-label="Закрити" onClick={onClose}><X size={20} /></button><span className="eyebrow">ФІНАНСОВА ЯСНІСТЬ</span><h2>{title}</h2><p className="modal-subtitle">{description}</p>{children}</div></dialog>;
}

function TransactionForm({ transaction, state, month, onSave }) {
  const today = localDate();
  const [type, setType] = useState(transactionType(transaction || {}));
  const [account, setAccount] = useState(transaction?.account || 'card');
  const [category, setCategory] = useState(transaction?.category || FINANCE_CATEGORIES[0].label);
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [error, setError] = useState('');
  const categories = [...new Set([...FINANCE_CATEGORIES.map(item => item.label), ...state.expenses.map(item => item.category)])];
  const defaultDate = transaction?.date || (month === today.slice(0, 7) ? today : `${month}-01`);
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cleaned = amount.trim().replace(',', '.');
    const value = Number(cleaned);
    const title = String(form.get('title') || '').trim();
    const date = String(form.get('date') || '');
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(cleaned) || !Number.isFinite(value) || value <= 0 || value > 1_000_000) { setError('Вкажи суму від 0,01 до 1 000 000 ₴, до двох цифр після коми.'); return; }
    if (!title) { setError('Додай коротку назву операції.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2000-01-01' || date > today) { setError('Обери дату від 2000 року до сьогодні.'); return; }
    if (!transaction && state.expenses.length >= 10000) { setError('Досягнуто ліміту 10 000 операцій. Збережи резервну копію й видали непотрібні записи.'); return; }
    onSave({ title, amount: Math.round(value * 100) / 100, category, date, type, account, note: String(form.get('note') || '').trim() });
  }
  return <form className="form-stack mf-transaction-form" onSubmit={submit}>
    <fieldset className="mf-segment-field"><legend className="mf-sr-only">Тип операції</legend><div className="mf-segments"><button type="button" aria-pressed={type === 'expense'} className={type === 'expense' ? 'is-active' : ''} onClick={() => { setType('expense'); if (category === 'Зарплата') setCategory(FINANCE_CATEGORIES[0].label); }}><ArrowUpRight size={18} /> Витрата</button><button type="button" aria-pressed={type === 'income'} className={type === 'income' ? 'is-active is-income' : ''} onClick={() => { setType('income'); if (!transaction) setCategory('Зарплата'); }}><ArrowDownLeft size={18} /> Надходження</button></div></fieldset>
    <label className="mf-amount-field"><span>Сума операції</span><div><input aria-label="Сума операції" inputMode="decimal" placeholder="0,00" value={amount} onChange={event => { setAmount(event.target.value); setError(''); }} maxLength={12} required autoFocus /><span>₴</span></div></label>
    <label className="field">Назва<input name="title" defaultValue={transaction?.title || ''} required maxLength={80} placeholder={type === 'income' ? 'Наприклад, зарплата за листопад' : 'Наприклад, продукти на тиждень'} /></label>
    <div className="form-row"><label className="field">Категорія<select aria-label="Категорія операції" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(label => <option key={label} value={label}>{label}</option>)}</select></label><label className="field">Дата<input aria-label="Дата операції" name="date" type="date" defaultValue={defaultDate} min="2000-01-01" max={today} required /></label></div>
    <fieldset className="mf-segment-field"><legend>Спосіб оплати</legend><div className="mf-account-options"><button type="button" className={account === 'card' ? 'is-active' : ''} aria-pressed={account === 'card'} onClick={() => setAccount('card')}><CreditCard size={19} weight="light" /> Картка {account === 'card' && <Check size={14} />}</button><button type="button" className={account === 'cash' ? 'is-active' : ''} aria-pressed={account === 'cash'} onClick={() => setAccount('cash')}><Money size={19} weight="light" /> Готівка {account === 'cash' && <Check size={14} />}</button></div></fieldset>
    <label className="field">Нотатка <span className="mf-optional">необов’язково</span><textarea name="note" defaultValue={transaction?.note || ''} maxLength={300} rows={2} placeholder="Деталь, яку хочеш запам’ятати" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary submit-button" type="submit">{transaction ? 'Зберегти зміни' : type === 'income' ? 'Додати надходження' : 'Додати витрату'}<span className="button-circle"><Check size={18} /></span></button>
  </form>;
}

function BudgetForm({ budgets, categories, onSave }) {
  const [limit, setLimit] = useState(String(budgets?.monthLimit || ''));
  const [limits, setLimits] = useState(budgets?.categories || {});
  const [error, setError] = useState('');
  const sum = Object.values(limits).reduce((total, value) => total + (Number(value) || 0), 0);
  function submit(event) {
    event.preventDefault();
    const monthLimit = Number(limit || 0);
    const categories = Object.fromEntries(Object.entries(limits).filter(([, value]) => Number(value) > 0).map(([label, value]) => [label, Math.round(Number(value) * 100) / 100]));
    if (![monthLimit, ...Object.values(categories)].every(value => Number.isFinite(value) && value >= 0 && value <= 1_000_000)) { setError('Кожен ліміт має бути від 0 до 1 000 000 ₴.'); return; }
    onSave({ monthLimit: Math.round(monthLimit * 100) / 100, categories });
  }
  return <form className="form-stack mf-budget-form" onSubmit={submit}>
    <label className="field mf-budget-main-label">Загальний ліміт на місяць<div className="mf-input-currency"><input aria-label="Загальний ліміт на місяць" type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={limit} onChange={event => setLimit(event.target.value)} placeholder="Наприклад, 20000" /><span>₴</span></div></label>
    <p className="mf-form-note">Порожнє поле або 0 — без ліміту. Ці налаштування застосовуються до кожного місяця.</p>
    <div className="mf-budget-form-heading"><h3>Ліміти за категоріями</h3><span>{money(sum)} усього</span></div>
    <div className="mf-category-inputs">{categories.map(label => <label key={label}><span><CategoryIcon category={label} size={18} /><span>{label}</span></span><div className="mf-input-currency"><input aria-label={`Ліміт: ${label}`} type="number" inputMode="decimal" min="0" max="1000000" step="0.01" placeholder="—" value={limits[label] || ''} onChange={event => setLimits(old => ({ ...old, [label]: event.target.value }))} /><span>₴</span></div></label>)}</div>
    {Number(limit) > 0 && sum > Number(limit) && <p className="mf-budget-advice"><WarningCircle size={18} />Сума лімітів категорій більша за загальний бюджет. Можеш зберегти їх окремо або зменшити.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary submit-button" type="submit">Зберегти бюджет<span className="button-circle"><Check size={18} /></span></button>
  </form>;
}

export default function MoneyView({ state, dispatch }) {
  const currentMonth = localDate().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('newest');
  const [modal, setModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleted, setDeleted] = useState(null);
  const [notice, setNotice] = useState('');
  const [allCategories, setAllCategories] = useState(false);
  const finance = useMemo(() => selectFinance(state, { month, category, type, query }), [state, month, category, type, query]);
  const categories = useMemo(() => [...new Set([...FINANCE_CATEGORIES.map(item => item.label), ...state.expenses.map(item => item.category), ...Object.keys(state.budgets?.categories || {})])], [state.expenses, state.budgets]);
  const transactions = [...finance.transactions].sort((a, b) => (sort === 'newest' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  const groups = transactions.reduce((result, item) => { (result[item.date] ||= []).push(item); return result; }, {});
  const categoryRows = [...finance.byCategory].filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount);
  const visibleCategories = allCategories ? categoryRows : categoryRows.slice(0, 6);
  const budgetRows = categories.map(label => ({ label, limit: Number(state.budgets?.categories?.[label]) || 0, spent: finance.byCategory.find(item => item.category === label)?.amount || 0 })).filter(item => item.limit > 0);
  const spentPercent = finance.limit ? finance.expense / finance.limit * 100 : 0;
  const hasFilters = query.trim() || category !== 'all' || type !== 'all';
  function resetFilters() { setQuery(''); setCategory('all'); setType('all'); }
  function saveTransaction(expense) {
    const editing = modal?.kind === 'edit';
    dispatch(editing ? { type: 'UPDATE_EXPENSE', id: modal.transaction.id, expense } : { type: 'ADD_EXPENSE', expense });
    setMonth(expense.date.slice(0, 7));
    resetFilters();
    setModal(null);
    setDeleted(null);
    setNotice(editing ? 'Операцію оновлено.' : 'Операцію додано.');
  }
  function removeTransaction(item) {
    dispatch({ type: 'DELETE_EXPENSE', id: item.id });
    setDeleted(item);
    setConfirmDelete(null);
    setNotice('Операцію видалено.');
  }
  return <div className="mf-page">
    <header className="mf-page-heading"><div><span className="eyebrow">МЕНШЕ ХАОСУ. БІЛЬШЕ ЯСНОСТІ.</span><h1>Гроші під контролем.</h1><p>Помічай, куди йдуть гроші. Залишай більше для важливого.</p></div><button className="button button-primary mf-add-button" onClick={() => setModal({ kind: 'add' })}><Plus size={18} /> Додати операцію</button></header>
    <div className="mf-period-row"><div className="mf-month-control"><button className="icon-button" aria-label="Попередній місяць" disabled={month <= '2000-01'} onClick={() => setMonth(changeMonth(month, -1))}><CaretLeft size={18} /></button><label><CalendarBlank size={17} weight="light" /><span>{monthLabel(month)}</span><input aria-label="Місяць фінансів" type="month" value={month} min="2000-01" max={currentMonth} onChange={event => { const value = event.target.value; if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= '2000-01' && value <= currentMonth) setMonth(value); }} /></label><button className="icon-button" aria-label="Наступний місяць" disabled={month >= currentMonth} onClick={() => setMonth(changeMonth(month, 1))}><CaretRight size={18} /></button></div><span className="mf-period-note"><span /> {entryLabel(finance.transactionCount)}</span></div>
    <section className="mf-overview panel" aria-label="Підсумок місяця"><div className="mf-overview-main"><span className="mf-metric-label"><Wallet size={19} weight="light" /> Баланс місяця</span><strong className={finance.balance < 0 ? 'is-negative' : ''}>{finance.balance < 0 ? '−' : ''}{money(finance.balance)}</strong><span className="mf-metric-foot">Надходження мінус витрати</span></div><div className="mf-overview-detail"><span className="mf-metric-label"><span className="mf-metric-arrow income"><ArrowDownLeft size={18} /></span> Надходження</span><strong>{money(finance.income)}</strong><span className="mf-metric-foot">Усе, що отримав цього місяця</span></div><div className="mf-overview-detail"><span className="mf-metric-label"><span className="mf-metric-arrow expense"><ArrowUpRight size={18} /></span> Витрати</span><strong>{money(finance.expense)}</strong><span className="mf-metric-foot">Усе, що записав як витрату</span></div></section>

    <div className="mf-insights-grid">
      <section className="panel mf-breakdown"><div className="mf-section-title"><div><span className="eyebrow">КАРТИНА МІСЯЦЯ</span><h2>На що йдуть гроші</h2></div><span className="mf-soft-icon"><TrendDown size={22} weight="light" /></span></div>
        {categoryRows.length ? <><div className="mf-category-share" role="img" aria-label={`Частки витрат: ${categoryRows.map(item => `${item.category} ${Math.round(item.percent)}%`).join(', ')}`}>{categoryRows.map(item => <span key={item.category} style={{ flexGrow: item.amount, background: categoryMeta(item.category).color }} title={`${item.category}: ${money(item.amount)}`} />)}</div><div className="mf-category-breakdown">{visibleCategories.map(item => <button className={`mf-category-row ${category === item.category ? 'is-selected' : ''}`} key={item.category} onClick={() => setCategory(category === item.category ? 'all' : item.category)} aria-pressed={category === item.category}><CategoryIcon category={item.category} /><span className="mf-category-copy"><span>{item.category}</span><span className="mf-category-track"><i style={{ width: `${Math.max(1, item.percent)}%`, background: categoryMeta(item.category).color }} /></span></span><span className="mf-category-value"><strong>{money(item.amount)}</strong><small>{number.format(Math.round(item.percent * 10) / 10)}%</small></span></button>)}</div>{categoryRows.length > 6 && <button className="text-button mf-show-categories" onClick={() => setAllCategories(!allCategories)}>{allCategories ? 'Показати основні' : `Усі категорії · ${categoryRows.length}`}<CaretRight size={15} className={allCategories ? 'is-expanded' : ''} /></button>}</> : <div className="mf-chart-empty"><div className="mf-empty-bars" aria-hidden="true"><i /><i /><i /><i /><i /></div><h3>Побачиш картину з першої витрати</h3><p>Додай операцію — тут з’являться справжні частки твоїх витрат.</p><button className="text-button" onClick={() => setModal({ kind: 'add' })}>Додати першу витрату <Plus size={16} /></button></div>}
      </section>
      <section className="panel mf-budget"><div className="mf-section-title"><div><span className="eyebrow">ВЛАСНІ МЕЖІ</span><h2>План на місяць</h2></div><button className="icon-button" aria-label="Налаштувати бюджет" title="Налаштувати бюджет" onClick={() => setModal({ kind: 'budget' })}><PencilSimple size={20} weight="light" /></button></div>
        {finance.limit > 0 ? <><div className={`mf-budget-remaining ${finance.remaining < 0 ? 'is-over' : ''}`}><span>{finance.remaining < 0 ? 'Понад твій ліміт' : 'Ще в межах бюджету'}</span><strong>{money(finance.remaining)}</strong></div><Meter value={spentPercent} label="Використано місячного бюджету" danger={finance.remaining < 0} /><div className="mf-budget-scale"><span>{money(finance.expense)} витрачено</span><span>із {money(finance.limit)}</span></div><p className={`mf-budget-status ${finance.remaining < 0 ? 'is-over' : ''}`}>{finance.remaining < 0 ? <WarningCircle size={16} /> : <Check size={16} />}{finance.remaining < 0 ? `Ліміт перевищено на ${number.format(Math.round(spentPercent - 100))}%. Переглянь свої записи й план.` : `Використано ${number.format(Math.round(spentPercent))}% місячного ліміту.`}</p></> : <div className="mf-budget-empty"><span className="mf-budget-empty-icon"><Target size={34} weight="light" /></span><h3>Дай грошам орієнтир</h3><p>Вкажи комфортну суму витрат на місяць і спостерігай за залишком.</p><button className="button button-ghost" onClick={() => setModal({ kind: 'budget' })}>Встановити ліміт <Plus size={16} /></button></div>}
        {budgetRows.length > 0 && <div className="mf-category-budgets"><div className="mf-subheading"><h3>Ліміти категорій</h3><button className="text-button" onClick={() => setModal({ kind: 'budget' })}>Змінити</button></div>{budgetRows.map(item => <div key={item.label}><div className="mf-limit-label"><span>{item.label}</span><strong className={item.spent > item.limit ? 'is-over' : ''}>{money(item.spent)} <small>/ {money(item.limit)}</small></strong></div><Meter value={item.spent / item.limit * 100} label={`Бюджет: ${item.label}`} danger={item.spent > item.limit} /></div>)}</div>}
        {finance.limit > 0 && !budgetRows.length && <button className="mf-category-limit-link" onClick={() => setModal({ kind: 'budget' })}><Target size={19} weight="light" /><span>Додати ліміти за категоріями</span><Plus size={16} /></button>}
      </section>
    </div>

    <section className="mf-transactions" aria-label="Історія операцій"><div className="mf-transactions-heading"><div><span className="eyebrow">УСІ ДЕТАЛІ НА МІСЦІ</span><h2>Історія операцій <span>{transactions.length}</span></h2></div><label className="mf-sort"><ArrowsDownUp size={17} /><span className="mf-sr-only">Порядок операцій</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Спочатку нові</option><option value="oldest">Спочатку давні</option></select></label></div>
      <div className="mf-filters"><label className="mf-search"><MagnifyingGlass size={18} weight="light" /><span className="mf-sr-only">Пошук операцій</span><input type="search" placeholder="Знайти операцію…" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label><label className="mf-filter-select"><span className="mf-sr-only">Фільтр категорії</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">Усі категорії</option>{categories.map(label => <option key={label} value={label}>{label}</option>)}</select></label><div className="mf-type-filter" aria-label="Тип операцій">{[{ id: 'all', label: 'Усі' }, { id: 'expense', label: 'Витрати' }, { id: 'income', label: 'Надходження' }].map(item => <button key={item.id} aria-pressed={type === item.id} className={type === item.id ? 'is-active' : ''} onClick={() => setType(item.id)}>{item.label}</button>)}</div></div>
      {hasFilters && <div className="mf-filter-summary"><span>Знайдено: {entryLabel(transactions.length)}</span><button className="text-button" onClick={resetFilters}>Скинути фільтри <X size={13} /></button></div>}
      <div className="panel mf-transaction-list">{transactions.length ? Object.entries(groups).map(([date, items]) => <div className="mf-day-group" key={date}><div className="mf-day-heading"><span>{dayLabel(date)}</span><span>{entryLabel(items.length)}</span></div>{items.map(item => <article className={`mf-transaction-row ${confirmDelete === item.id ? 'is-deleting' : ''}`} key={item.id}>{confirmDelete === item.id ? <div className="mf-delete-confirm"><Trash size={20} weight="light" /><p>Видалити «{item.title}»?</p><div><button type="button" className="button mf-delete-yes" onClick={() => removeTransaction(item)}>Видалити</button><button type="button" className="button button-ghost" onClick={() => setConfirmDelete(null)}>Залишити</button></div></div> : <><button className="mf-transaction-open" onClick={() => setModal({ kind: 'edit', transaction: item })} aria-label={`Редагувати: ${item.title}`}><CategoryIcon category={item.category} /><span className="mf-transaction-copy"><strong>{item.title}</strong><span>{item.category}<i />{accountLabel(item.account)}</span>{item.note && <small>{item.note}</small>}</span><span className={`mf-transaction-amount ${transactionType(item) === 'income' ? 'is-income' : ''}`}>{transactionType(item) === 'income' ? '+' : '−'}{money(item.amount)}<small><PencilSimple size={11} /> редагувати</small></span></button><button className="icon-button mf-delete-button" aria-label={`Видалити: ${item.title}`} onClick={() => setConfirmDelete(item.id)}><Trash size={17} weight="light" /></button></>}</article>)}</div>) : <div className="mf-transactions-empty"><Receipt size={38} weight="light" /><h3>{hasFilters ? 'Нічого не знайшли' : 'Поки що чистий аркуш'}</h3><p>{hasFilters ? 'Спробуй іншу назву, категорію або тип операції.' : `За ${monthLabel(month)} ще немає записів. Почни з однієї витрати або надходження.`}</p><button className="button button-ghost" onClick={hasFilters ? resetFilters : () => setModal({ kind: 'add' })}>{hasFilters ? 'Скинути фільтри' : 'Додати операцію'}{hasFilters ? <ArrowCounterClockwise size={16} /> : <Plus size={16} />}</button></div>}</div>
    </section>
    <div className="mf-notice" role="status" aria-live="polite">{notice && <><Check size={16} /><span>{notice}</span>{deleted && <button className="text-button" onClick={() => { dispatch({ type: 'ADD_EXPENSE', expense: deleted }); setMonth(deleted.date.slice(0, 7)); resetFilters(); setDeleted(null); setNotice('Операцію повернуто.'); }}>Повернути <ArrowCounterClockwise size={14} /></button>}<button className="icon-button" aria-label="Закрити повідомлення" onClick={() => { setNotice(''); setDeleted(null); }}><X size={15} /></button></>}</div>
    <p className="mf-footnote"><Wallet size={14} weight="light" />Тут лише твої записи. Банківські рахунки не підключені; баланс місяця не є залишком на картці.</p>
    {modal && <MoneyDialog title={modal.kind === 'budget' ? 'Бюджет у твоєму темпі.' : modal.kind === 'edit' ? 'Уточни деталі.' : 'Один запис. Більше ясності.'} description={modal.kind === 'budget' ? 'Власні ліміти допомагають бачити план і факт.' : 'Запиши операцію так, щоб потім легко її впізнати.'} onClose={() => setModal(null)} wide={modal.kind === 'budget'}>{modal.kind === 'budget' ? <BudgetForm budgets={state.budgets} categories={categories} onSave={budget => { dispatch({ type: 'UPDATE_BUDGET', budget }); setModal(null); setDeleted(null); setNotice('Бюджет оновлено.'); }} /> : <TransactionForm key={modal.transaction?.id || 'new'} transaction={modal.transaction} state={state} month={month} onSave={saveTransaction} />}</MoneyDialog>}
  </div>;
}
