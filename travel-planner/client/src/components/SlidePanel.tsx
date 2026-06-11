import type { Trip } from '../api';
import { useT } from '../i18n';
import AIGenerate from '../pages/AIGenerate';
import ImportTrip from '../pages/ImportTrip';

export default function SlidePanel({ mode, onClose, trips, onTripsChange }: {
  mode: 'ai' | 'import';
  onClose: () => void;
  trips: Trip[];
  onTripsChange: () => Promise<void>;
}) {
  const { t } = useT();
  return (
    <div className="slide-panel">
      <div className="slide-panel-header">
        <span>{mode === 'ai' ? t('sidebar.aiGenerate') : t('sidebar.importTrip')}</span>
        <button className="chat-panel-close" onClick={onClose}>x</button>
      </div>
      <div className="slide-panel-body">
        {mode === 'ai' ? (
          <AIGenerate onClose={onClose} onTripsChange={onTripsChange} />
        ) : (
          <ImportTrip trips={trips} onTripsChange={onTripsChange} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
