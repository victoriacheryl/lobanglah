import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { Header } from "@/components/header";
import { BottomToolbar } from "@/components/bottom-toolbar";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import ForgotPassword from "@/pages/forgot-password";
import PostListing from "@/pages/post-listing";
import ListingDetail from "@/pages/listing-detail";
import MyListings from "@/pages/my-listings";
import Wallet from "@/pages/wallet";
import Profile from "@/pages/profile";
import Admin from "@/pages/admin";
import Users from "@/pages/users";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/post" component={PostListing} />
      <Route path="/listings/:id" component={ListingDetail} />
      <Route path="/my-listings" component={MyListings} />
      <Route path="/wallet" component={Wallet} />
      <Route path="/profile" component={Profile} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/users" component={Users} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <div className="min-h-dvh flex flex-col">
                <Header />
                <main className="flex-1 pb-16 md:pb-0">
                  <AppRouter />
                </main>
                <BottomToolbar />
              </div>
            </Router>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
