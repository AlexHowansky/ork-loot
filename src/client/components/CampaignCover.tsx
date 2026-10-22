import { Icon, faDragon } from "./Icon.tsx";

/** A campaign's background image cropped to a square, for the top of a card. */
export function CampaignCover({ image }: { image: string | null }) {
  return (
    <figure className="aspect-square bg-base-300">
      {image ? (
        <img src={`/uploads/${image}`} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon icon={faDragon} className="text-5xl text-base-content/20" />
      )}
    </figure>
  );
}
