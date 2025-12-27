export default function TimelinePage() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="text-center space-y-4 animate-fade-in">
        <div className="w-16 h-16 mx-auto rounded-full bg-accent-gold/10 border border-accent-gold/30 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-accent-gold"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Timeline</h1>
        <p className="text-foreground-muted max-w-md">
          Scroll through your memories over time. Beautiful animations and filtering. Coming in P4.
        </p>
      </div>
    </div>
  );
}
