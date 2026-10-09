import { Route, Routes } from 'react-router';
import Shell from './layout/Shell';
import DashboardPage from './pages/DashboardPage';
import MachinesPage from './pages/MachinesPage';
import ProductsPage from './pages/ProductsPage';
import ChangeoversPage from './pages/ChangeoversPage';
import ExecutionPage from './pages/ExecutionPage';
import AnalyticsPage from './pages/AnalyticsPage';
import HistoryPage from './pages/HistoryPage';
import AssistantPage from './pages/AssistantPage';
import DocumentsPage from './pages/DocumentsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} handle={{ crumb: 'Dashboard' }} />
        <Route path="machines" element={<MachinesPage />} handle={{ crumb: 'Machines' }} />
        <Route path="products" element={<ProductsPage />} handle={{ crumb: 'Products' }} />
        <Route path="changeovers" element={<ChangeoversPage />} handle={{ crumb: 'Changeovers' }} />
        <Route path="changeovers/:id" element={<ExecutionPage />} handle={{ crumb: 'Execution workspace' }} />
        <Route path="analytics" element={<AnalyticsPage />} handle={{ crumb: 'Analytics' }} />
        <Route path="history" element={<HistoryPage />} handle={{ crumb: 'History' }} />
        <Route path="assistant" element={<AssistantPage />} handle={{ crumb: 'AI Assistant' }} />
        <Route path="documents" element={<DocumentsPage />} handle={{ crumb: 'Documents' }} />
        <Route path="settings" element={<SettingsPage />} handle={{ crumb: 'Settings' }} />
        <Route path="*" element={<DashboardPage />} handle={{ crumb: 'Dashboard' }} />
      </Route>
    </Routes>
  );
}
