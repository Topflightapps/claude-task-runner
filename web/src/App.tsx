import { Dashboard } from "./components/Dashboard.tsx";
import { LoginForm } from "./components/LoginForm.tsx";
import { useAuth } from "./hooks/useAuth.ts";

export function App() {
  const { token, login, logout, isAuthenticated } = useAuth();

  if (!isAuthenticated || !token) {
    return <LoginForm onLogin={login} />;
  }

  return <Dashboard token={token} onLogout={logout} />;
}
