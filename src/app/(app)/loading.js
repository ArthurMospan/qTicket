// src/app/(app)/loading.js — the workspace's route-transition loader.
//
// This used to be a per-screen skeleton: nine `loading.js` files, each naming
// the shape of the screen that was arriving. The idea was that a placeholder
// standing in the right regions would keep content from appearing to jump.
// In practice it did the opposite — the skeleton's padding and rhythm never
// matched the real screen closely enough, so the swap read as everything
// shifting a few pixels at once, which is worse than a blank frame. A wait
// this short does not need a portrait of the screen; it needs a sign that
// something is happening.
//
// So there is one loader for the whole workspace, and the per-route files are
// gone: `loading.js` resolves to the nearest ancestor, and this is it. The
// sidebar keeps its own skeleton — that one waits on organisation data, not on
// a route, and it sits in a fixed frame where the shapes really do line up.
//
// Imported from its own file, not the kit barrel: a `loading.js` is a Server
// Component, and the barrel pulls in every client module the kit has.
import LoadingSpinner from '@/components/ui/Feedback/LoadingSpinner';

export default function WorkspaceLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex h-full min-h-0 flex-1 items-center justify-center"
    >
      <LoadingSpinner size="md" />
      <span className="sr-only">Завантаження…</span>
    </div>
  );
}
