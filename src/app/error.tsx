"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <h1>This page could not be opened.</h1>
      <p>Your work is stored locally. Try loading the page again.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
