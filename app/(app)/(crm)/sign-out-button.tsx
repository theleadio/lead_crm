// A plain form post (top-level navigation, not fetch): the route clears the
// session and sends the browser on to AI365 to sign out there too.
export function SignOutButton() {
  return (
    <form action="/auth/sign-out" method="post">
      <button className="cursor-pointer text-sm text-[var(--ink-muted)] underline hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
        Sign out
      </button>
    </form>
  );
}
