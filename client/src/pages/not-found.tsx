import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-full max-w-md mx-4 bg-card border border-border rounded-2xl p-6">
        <div className="flex mb-4 gap-2 items-center">
          <AlertCircle className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">404 Page Not Found</h1>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          The page you're looking for doesn't exist. Head back to the dashboard.
        </p>
        <a
          href="#/dashboard"
          className="inline-block mt-4 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}
