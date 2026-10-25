import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@fortawesome/fontawesome-svg-core";
import { ApiError } from "./api.ts";
import { ConfirmProvider } from "./components/Confirm.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { Layout } from "./components/Layout.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.tsx";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { CampaignPage } from "./pages/CampaignPage.tsx";
import { PlayPage } from "./pages/PlayPage.tsx";
import { WatchPage } from "./pages/WatchPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";

// Styles come from app.css; injecting a <style> tag would need a looser CSP.
config.autoAddCss = false;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path="login" element={<LoginPage />} />
                <Route path="forgot" element={<ForgotPasswordPage />} />
                <Route path="reset" element={<ResetPasswordPage />} />
                <Route path="join" element={<JoinPage />} />
                <Route path="campaigns/:id" element={<CampaignPage />} />
                <Route path="play/:id" element={<PlayPage />} />
                <Route path="watch/:id" element={<WatchPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
