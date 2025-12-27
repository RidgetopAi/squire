export default function GraphPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="text-center space-y-4 animate-fade-in">
        <div className="w-16 h-16 mx-auto rounded-full bg-accent-magenta/10 border border-accent-magenta/30 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-accent-magenta"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Graph</h1>
        <p className="text-foreground-muted max-w-md">
          Explore your memory network visually. Connections, entities, and relationships. Coming in P5.
        </p>
      </div>
    </div>
  );
}
