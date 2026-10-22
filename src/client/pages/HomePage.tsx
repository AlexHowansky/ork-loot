import { Link } from "react-router";
import { useMe } from "../queries.ts";
import { LoadError, Loading } from "../components/Layout.tsx";
import { Icon, faDragon, faKey } from "../components/Icon.tsx";
import { CampaignsPage } from "./CampaignsPage.tsx";

export function HomePage() {
  const { data: me, error, isPending } = useMe();
  if (isPending) return <Loading />;
  if (error) return <LoadError error={error} />;
  if (me.gm) return <CampaignsPage />;

  return (
    <div className="card bg-base-100 shadow mx-auto mt-8 w-full max-w-md">
      <div className="card-body">
        <h1 className="card-title">
          <Icon icon={faDragon} className="text-primary" /> Welcome, adventurer
        </h1>
        {me.characters.length > 0 ? (
          <>
            <p className="text-base-content/70">Choose a character to see their loot.</p>
            <ul className="menu bg-base-200 rounded-box w-full">
              {me.characters.map((c) => (
                <li key={c.id}>
                  <Link to={`/play/${c.id}`} className="flex justify-between">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-base-content/60 text-sm">{c.campaignName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-base-content/70">
            Track your party's loot. Players join with a code from their GM.
          </p>
        )}
        <div className="card-actions justify-end mt-2">
          <Link to="/join" className="btn btn-primary">
            <Icon icon={faKey} /> Enter a join code
          </Link>
        </div>
      </div>
    </div>
  );
}
