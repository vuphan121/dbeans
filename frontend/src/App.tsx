import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Login from "@/pages/Login";
import Connections from "@/pages/Connections";
import AddConnection from "@/pages/AddConnection";
import Workbench from "@/pages/Workbench";
import Settings from "@/pages/Settings";
import Jobs from "@/pages/Jobs";
import AddJob from "@/pages/AddJob";
import Secrets from "@/pages/Secrets";
import { AppNavRail } from "@/components/AppNavRail";
import { useAuthStore } from "@/state/auth";
import { useConnectionsStore } from "@/state/connections";
import { useJobsStore } from "@/state/jobs";
import { useSecretsStore } from "@/state/secrets";
import { applyThemeToDocument, useSettingsStore, watchSystemTheme } from "@/state/settings";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isUnlocked, checking } = useAuthStore();
  if (checking) return null;
  if (!isUnlocked) return <Navigate to="/login" replace />;
  return (
    <div className="flex h-full">
      <AppNavRail />
      <div className="h-full min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const { restoreSession, isUnlocked, token } = useAuthStore();
  const loadConnections = useConnectionsStore((s) => s.loadConnections);
  const loadJobs = useJobsStore((s) => s.loadJobs);
  const loadSecrets = useSecretsStore((s) => s.loadSecrets);

  useEffect(() => {
    watchSystemTheme();
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (isUnlocked && token) {
      loadConnections();
      loadJobs();
      loadSecrets();
    }
  }, [isUnlocked, token, loadConnections, loadJobs, loadSecrets]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/connections"
          element={
            <RequireAuth>
              <Connections />
            </RequireAuth>
          }
        />
        <Route
          path="/connections/new"
          element={
            <RequireAuth>
              <AddConnection />
            </RequireAuth>
          }
        />
        <Route
          path="/workbench"
          element={
            <RequireAuth>
              <Workbench />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <Settings />
            </RequireAuth>
          }
        />
        <Route
          path="/jobs"
          element={
            <RequireAuth>
              <Jobs />
            </RequireAuth>
          }
        />
        <Route
          path="/jobs/new"
          element={
            <RequireAuth>
              <AddJob />
            </RequireAuth>
          }
        />
        <Route
          path="/jobs/:id/edit"
          element={
            <RequireAuth>
              <AddJob />
            </RequireAuth>
          }
        />
        <Route
          path="/secrets"
          element={
            <RequireAuth>
              <Secrets />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/connections" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
