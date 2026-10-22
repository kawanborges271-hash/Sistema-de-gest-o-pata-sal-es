import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAuth, RequireFeature, RequireSalon } from "@/components/auth/guards";
import AppLayout from "@/components/layout/AppLayout";
import { FullPageLoader } from "@/components/common/FullPageLoader";
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Convite = lazy(() => import("@/pages/Convite"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const Agenda = lazy(() => import("@/pages/Agenda"));
const Clientes = lazy(() => import("@/pages/Clientes"));
const ClienteDetalhe = lazy(() => import("@/pages/ClienteDetalhe"));
const Servicos = lazy(() => import("@/pages/Servicos"));
const Profissionais = lazy(() => import("@/pages/Profissionais"));
const Equipe = lazy(() => import("@/pages/Equipe"));
const Configuracoes = lazy(() => import("@/pages/Configuracoes"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster richColors position="top-right" />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<FullPageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/cadastro" element={<Signup />} />
              <Route path="/redefinir-senha" element={<ResetPassword />} />
              <Route path="/convite/:token" element={<Convite />} />
              <Route element={<RequireAuth />}>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route element={<RequireSalon />}>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<Navigate to="/agenda" replace />} />
                    <Route path="/agenda" element={<Agenda />} />
                    <Route path="/clientes" element={<Clientes />} />
                    <Route path="/clientes/:id" element={<ClienteDetalhe />} />
                    <Route element={<RequireFeature feature="servicos" />}>
                      <Route path="/servicos" element={<Servicos />} />
                    </Route>
                    <Route element={<RequireFeature feature="profissionais" />}>
                      <Route path="/profissionais" element={<Profissionais />} />
                    </Route>
                    <Route element={<RequireFeature feature="equipe" />}>
                      <Route path="/equipe" element={<Equipe />} />
                    </Route>
                    <Route element={<RequireFeature feature="configuracoes" />}>
                      <Route path="/configuracoes" element={<Configuracoes />} />
                    </Route>
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
