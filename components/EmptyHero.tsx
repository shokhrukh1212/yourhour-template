import { ClaimPanel } from "./ClaimPanel";

export function EmptyHero() {
  return (
    <section className="empty-hero">
      <div className="empty-swoop" aria-hidden="true">↗</div>
      <h1>Be the first product to own YourHour.</h1>
      <p>Your product gets the homepage and starts the permanent leaderboard.</p>
      <span className="starting-price">STARTING PRICE <b>$3</b></span>
      <ClaimPanel empty />
      <p className="empty-note">Every buyer stays permanently on the leaderboard.</p>
    </section>
  );
}
