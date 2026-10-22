import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="card bg-base-100 shadow mx-auto mt-8 max-w-sm">
      <div className="card-body items-center text-center">
        <h1 className="card-title">Nothing here</h1>
        <p>That page couldn't be found.</p>
        <Link to="/" className="btn mt-2">
          Go home
        </Link>
      </div>
    </div>
  );
}
