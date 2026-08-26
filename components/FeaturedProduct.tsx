import { ProductLogo } from "./ProductLogo";
import { TakeSpotButton } from "./TakeSpotButton";

export type DisplayListing = { id: string; url: string; productName: string; pitch: string | null; iconUrl: string | null; bidCents: number; verifiedClicks: number; rank: number };

export function FeaturedProduct({ listing }: { listing: DisplayListing }) {
  return (
    <article className="featured-card">
      <div className="featured-watermark"><ProductLogo imageUrl={listing.iconUrl} productUrl={listing.url} productName={listing.productName} className="h-full w-full border-0" /></div>
      <div className="featured-product"><ProductLogo eager imageUrl={listing.iconUrl} productUrl={listing.url} productName={listing.productName} className="featured-logo" /><div className="featured-copy"><span className="featured-kicker">CURRENT #1</span><h1><a href={`/r/${listing.id}`} target="_blank" rel="noopener">{listing.productName}</a></h1>{listing.pitch ? <p>{listing.pitch}</p> : null}</div></div>
      <dl className="featured-stats"><div><dd>${listing.bidCents / 100}</dd><dt>paid</dt></div><div><dd>{listing.verifiedClicks.toLocaleString()}</dd><dt>verified clicks</dt></div></dl>
      <div className="featured-action">
        <a className="visit-link" href={`/r/${listing.id}`} target="_blank" rel="noopener" aria-label={`Visit ${listing.productName} (opens in a new tab)`}>Visit <span aria-hidden="true">→</span></a>
        <TakeSpotButton className="mobile-take-inline" />
        <p>Featured until another product pays more.</p>
      </div>
    </article>
  );
}
