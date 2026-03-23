import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/context/AppContext";
import NotFound from "@/pages/not-found";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import WorkoutNew from "@/pages/WorkoutNew";
import WorkoutActive from "@/pages/WorkoutActive";
import History from "@/pages/History";
import Friends from "@/pages/Friends";
import Profile from "@/pages/Profile";
import BottomNav from "@/components/BottomNav";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { useEffect } from "react";

// Set dark class on initial load
if (typeof document !== "undefined") {
  document.documentElement.classList.add("dark");
}

const MAIN_TABS = ["/dashboard", "/history", "/friends", "/profile"];

function AppRouter() {
  const { currentUser } = useApp();
  const [location] = useLocation();

  // Determine if bottom nav should show
  const showNav = MAIN_TABS.some(tab => location === tab || location.startsWith(tab + "/"));
  const isWorkoutActive = location === "/workout/active";

  return (
    <>
      <Switch>
        <Route path="/" component={() => {
          // If user exists, redirect to dashboard
          if (currentUser) {
            window.location.hash = "#/dashboard";
            return null;
          }
          return <Onboarding />;
        }} />
        <Route path="/dashboard" component={() => {
          if (!currentUser) { window.location.hash = "#/"; return null; }
          return <Dashboard />;
        }} />
        <Route path="/workout/new" component={() => {
          if (!currentUser) { window.location.hash = "#/"; return null; }
          return <WorkoutNew />;
        }} />
        <Route path="/workout/active" component={() => {
          if (!currentUser) { window.location.hash = "#/"; return null; }
          return <WorkoutActive />;
        }} />
        <Route path="/history" component={() => {
          if (!currentUser) { window.location.hash = "#/"; return null; }
          return <History />;
        }} />
        <Route path="/friends" component={() => {
          if (!currentUser) { window.location.hash = "#/"; return null; }
          return <Friends />;
        }} />
        <Route path="/profile" component={() => {
          if (!currentUser) { window.location.hash = "#/"; return null; }
          return <Profile />;
        }} />
        <Route component={NotFound} />
      </Switch>
      {showNav && !isWorkoutActive && <BottomNav />}
      <PerplexityAttribution />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </AppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
