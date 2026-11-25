import { Link } from "react-router";

export function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-fd-background p-8 text-fd-foreground">
      <div className="max-w-md space-y-3 text-center">
        <p className="text-xs uppercase tracking-widest text-fd-muted-foreground">Suite Help</p>
        <h1 className="text-2xl font-semibold">That page is not in the handbook</h1>
        <p className="text-sm text-fd-muted-foreground">
          The explorer indexes code, modules and tours; the handbook renders the pages under{" "}
          <code>docs/</code>.
        </p>
        <Link
          to="/explore"
          className="inline-block rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Open the explorer
        </Link>
      </div>
    </div>
  );
}
