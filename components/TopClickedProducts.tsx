import { ArrowIcon } from "@/components/ArrowIcon";
import { ProductLogo } from "@/components/ProductLogo";
import type { TopClickedProduct } from "@/lib/wall";

export function TopClickedProducts({ products }: { products: TopClickedProduct[] }) {
  if (products.length === 0) return null;

  return (
    <section className="landing-shell pb-28" aria-labelledby="click-proof-heading">
      <div className="mb-8 grid items-end gap-4 lg:grid-cols-[1.25fr_.75fr] lg:gap-14">
        <div>
          <span className="landing-eyebrow">Proof from the Wall</span>
          <h2
            id="click-proof-heading"
            className="mt-3 text-[clamp(34px,4.5vw,52px)] font-normal leading-none tracking-[-.055em]"
          >
            Products people clicked most
          </h2>
        </div>
        <p className="max-w-md leading-relaxed text-muted">
          Real products and the outbound clicks they received through YourHour.
        </p>
      </div>

      <div
        role="region"
        aria-label="Most-clicked products"
        tabIndex={0}
        className="landing-proof-scroll grid snap-x snap-mandatory auto-cols-[85vw] grid-flow-col gap-3.5 overflow-x-auto pb-2 pr-[15%] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet md:auto-cols-auto md:grid-flow-row md:grid-cols-2 md:overflow-visible md:pb-0 md:pr-0 lg:grid-cols-3"
      >
        {products.map((product, index) => (
          <ProofCard key={product.id} product={product} position={index + 1} />
        ))}
      </div>
    </section>
  );
}

function ProofCard({
  product,
  position,
}: {
  product: TopClickedProduct;
  position: number;
}) {
  const name = product.display_name ?? "Unnamed product";
  const clicks = product.total_clicks;

  return (
    <article className="flex min-h-[230px] min-w-0 snap-start flex-col rounded-[22px] border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-4 text-xs font-extrabold tabular">
        <span className={position === 1 ? "text-accent" : "text-faint"}>#{position}</span>
        <span className="font-normal text-faint">Wall #{product.rank}</span>
      </div>

      <div className="mt-5 flex min-w-0 items-start gap-4">
        <ProductLogo
          imageUrl={product.image_url}
          productUrl={product.url}
          productName={name}
          className="h-12 w-12 rounded-[14px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xl font-normal tracking-tight">{name}</h3>
          <div className="min-h-[44px]">
            {product.pitch ? (
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
                {product.pitch}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-end justify-between gap-5 pt-6">
        <strong className="text-[30px] font-semibold leading-none tracking-[-.04em] tabular">
          {clicks.toLocaleString()} <span className="text-base font-normal text-muted">clicks</span>
        </strong>
        <a
          href={`/w/${product.id}`}
          target="_blank"
          rel="noopener"
          aria-label={`Visit ${name} (opens in a new tab)`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-xs font-bold text-muted transition hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Visit <ArrowIcon className="h-3.5 w-3.5" />
        </a>
      </div>
    </article>
  );
}
