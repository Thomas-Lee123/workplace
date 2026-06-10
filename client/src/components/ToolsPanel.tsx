import { useLocation } from 'react-router-dom';
import { useT } from '../i18n';

export default function ToolsPanel() {
  const { t } = useT();
  const location = useLocation();

  const match = location.pathname.match(/^\/trip\/([^/]+)$/);
  const tripId = match ? match[1] : null;

  if (!tripId) return null;

  return (
    <div className="sidebar-right">
      <div className="sidebar-section-label">{t('sidebar.tools')}</div>
      <button className="sidebar-link" onClick={() => window.dispatchEvent(new CustomEvent('trip:export', { detail: 'xlsx' }))}>{t('tripDetail.exportXlsx')}</button>
      <button className="sidebar-link" onClick={() => window.dispatchEvent(new CustomEvent('trip:export', { detail: 'doc' }))}>{t('tripDetail.exportDoc')}</button>
    </div>
  );
}
