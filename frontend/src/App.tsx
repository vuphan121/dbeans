import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Login from "@/pages/Login";
import Connections from "@/pages/Connections";
import AddConnection from "@/pages/AddConnection";
import Workbench from "@/pages/Workbench";
import Settings from "@/pages/Settings";
import { useAuthStore } from "@/state/auth";
import { useConnectionsStore } from "@/state/connections";
import { applyThemeToDocument, useSettingsStore, watchSystemTheme } from "@/state/settings";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isUnlocked, checking } = useAuthStore();
  if (checking) return null;
  if (!isUnlocked) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const { restoreSession, isUnlocked, token } = useAuthStore();
  const loadConnections = useConnectionsStore((s) => s.loadConnections);

  useEffect(() => {
    watchSystemTheme();
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (isUnlocked && token) loadConnections();
  }, [isUnlocked, token, loadConnections]);

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
        <Route path="*" element={<Navigate to="/connections" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
