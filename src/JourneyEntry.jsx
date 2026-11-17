import { ArrowUpRight, CheckCircle, Compass } from '@phosphor-icons/react';
import { localDate } from './model.js';
import './journey-entry.css';

export default function JourneyEntry({ state, onOpen, compact = false }) {
  const today = localDate();
  const plans = (state.dailyPlans || []).filter(plan => plan.date === today);
  const plan = plans.find(item => item.appliedQuestIds.length) || plans.at(-1);
  const applied = Boolean(plan?.appliedQuestIds.length);
  const done = state.completions[today] || [];
  const completed = plan?.appliedQuestIds.filter(id => done.includes(id)).length || 0;
  const ready = state.profile.lifeProfile?.status === 'completed';
  return <section className={`journey-entry${compact ? ' journey-entry-compact' : ''}`} aria-label="Персональний маршрут">
    <span className="journey-entry-icon">{applied ? <CheckCircle size={25} /> : <Compass size={25} />}</span>
    <div><span className="eyebrow">ТВІЙ ОСОБИСТИЙ МАРШРУТ</span>
      <h2>{applied ? `Твій план на день · ${completed}/${plan.appliedQuestIds.length}` : plan ? 'Пропозиція тренера готова' : ready ? 'Яким буде твій наступний крок?' : 'Почнімо з того, що важливо тобі.'}</h2>
      <p>{applied ? 'Квести вже серед сьогоднішніх справ. Виконуй їх у своєму темпі.' : plan ? 'Переглянь поради, зміни квести за потреби й додай їх до свого дня.' : ready ? 'Онови відповіді або склади з ШІ план на сьогодні з урахуванням свого прогресу.' : 'Розкажи про свої сфери життя, бажані зміни й можливості. Так тренер зможе запропонувати план саме для тебе.'}</p>
    </div>
    <button type="button" className="button button-ghost" onClick={onOpen}>{plan ? 'Переглянути план' : ready ? 'Мій план на сьогодні' : 'Познайомитися'} <ArrowUpRight size={17} /></button>
  </section>;
}
