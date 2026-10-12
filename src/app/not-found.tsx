import Link from "next/link";
export default function Page() {
  return (
    <div className="empty">
      <h1>Nothing at this address.</h1>
      <p>The conversation or project could not be found.</p>
      <Link className="button" href="/">
        Back to workspace
      </Link>
    </div>
  );
}
