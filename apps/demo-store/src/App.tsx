import {
  addCartItem,
  clearCart,
  createCart,
  formatMoney,
  removeCartItem,
  setCartItemQuantity,
  summarizeCart,
  toOrderItems,
  type Catalog,
  type CatalogProduct,
  type CommerceOrder,
  type CustomerInput,
  type OrderPreview,
} from "@cml-marketplace/core";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  DemoApiError,
  DemoCommerceGateway,
  type DemoConfig,
} from "./demo-api";

const gateway = new DemoCommerceGateway();
const emptyCatalog: Catalog = {
  channel: {
    id: "channel_unavailable",
    slug: "northstar",
    displayName: "Marketplace",
  },
  available: false,
  products: [],
  fetchedAt: new Date(0).toISOString(),
};
type CatalogStatus =
  | "loading"
  | "live"
  | "restricted"
  | "not_found"
  | "error"
  | "unconfigured";

const initialCustomer: CustomerInput = {
  email: "",
  firstName: "",
  lastName: "",
  countryCode: "FR",
};

export function App() {
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [catalogStatus, setCatalogStatus] =
    useState<CatalogStatus>("loading");
  const [config, setConfig] = useState<DemoConfig>();
  const [catalogNotice, setCatalogNotice] = useState(
    "Connecting to the northstar catalogue…",
  );
  const [cart, setCart] = useState(() => createCart("northstar"));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customer, setCustomer] =
    useState<CustomerInput>(initialCustomer);
  const [referralCode, setReferralCode] = useState("");
  const [preview, setPreview] = useState<OrderPreview>();
  const [order, setOrder] = useState<CommerceOrder>();
  const [paymentSimulated, setPaymentSimulated] = useState(false);
  const [liveOrderStatus, setLiveOrderStatus] =
    useState<CommerceOrder["status"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    void gateway
      .getConfig()
      .then(async (nextConfig) => {
        if (!active) return;
        setConfig(nextConfig);

        if (!nextConfig.cmlConfigured) {
          setCatalog(emptyCatalog);
          setCatalogStatus("unconfigured");
          setCatalogNotice(
            "CML credentials are required before the northstar catalogue can be loaded.",
          );
          return;
        }

        const liveCatalog = await gateway.getCatalog(
          nextConfig.defaultCountry,
        );
        if (!active) return;
        setCatalog(liveCatalog);
        setCart(createCart(liveCatalog.channel.slug));
        setCatalogStatus(liveCatalog.available ? "live" : "restricted");
        setCatalogNotice(
          liveCatalog.available
            ? `Live CML catalogue · ${liveCatalog.countryCode ?? nextConfig.defaultCountry}`
            : `CML restricted this catalogue for ${liveCatalog.countryCode ?? nextConfig.defaultCountry}`,
        );
      })
      .catch((caughtError) => {
        if (!active) return;
        setCatalog(emptyCatalog);
        setCatalogStatus(
          caughtError instanceof DemoApiError &&
            caughtError.status === 404
            ? "not_found"
            : "error",
        );
        setCatalogNotice(
          `Catalogue unavailable · ${getErrorMessage(caughtError)}`,
        );
      });

    return () => {
      active = false;
    };
  }, []);

  const cartSummary = useMemo(
    () => summarizeCart(cart, catalog),
    [cart, catalog],
  );
  const categories = useMemo(
    () => [
      "All",
      ...new Set(
        catalog.products
          .map((product) => product.category)
          .filter((value): value is string => Boolean(value)),
      ),
    ],
    [catalog],
  );
  const products = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return [...catalog.products]
      .sort((left, right) => left.position - right.position)
      .filter((product) => {
        const matchesCategory =
          category === "All" || product.category === category;
        const matchesSearch =
          !normalizedSearch ||
          `${product.title} ${product.description} ${product.code}`
            .toLowerCase()
            .includes(normalizedSearch);
        return matchesCategory && matchesSearch;
      });
  }, [catalog, category, search]);

  useEffect(() => {
    if (!categories.includes(category)) {
      setCategory("All");
    }
  }, [categories, category]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && checkoutOpen && !busy) {
        setCheckoutOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, checkoutOpen]);

  const changeCart = (nextCart: typeof cart) => {
    setCart(nextCart);
    setPreview(undefined);
    setOrder(undefined);
    setPaymentSimulated(false);
    setError(undefined);
  };

  const handlePreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const nextPreview = await gateway.previewOrder({
        channelSlug: cart.channelSlug,
        customer,
        items: toOrderItems(cart),
        ...(referralCode.trim()
          ? { referralCode: referralCode.trim() }
          : {}),
      });
      setPreview(nextPreview);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(undefined);

    try {
      setOrder(await gateway.confirmOrder(preview.id));
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBusy(false);
    }
  };

  const handlePayment = async () => {
    if (!order) return;
    setBusy(true);
    setError(undefined);

    try {
      const result = await gateway.simulatePayment(order.id);
      setOrder(result.order);
      setPaymentSimulated(result.simulated);
      setLiveOrderStatus(result.liveOrderStatus);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBusy(false);
    }
  };

  const startNewOrder = () => {
    setCart(clearCart(cart));
    setCustomer(initialCustomer);
    setReferralCode("");
    setPreview(undefined);
    setOrder(undefined);
    setPaymentSimulated(false);
    setLiveOrderStatus(undefined);
    setError(undefined);
    setCheckoutOpen(false);
  };

  const liveReady = Boolean(config?.cmlConfigured && catalog.available);
  const marketplaceName = "CML Marketplace";
  const marketplaceMark = marketplaceName.slice(0, 1).toUpperCase() || "M";
  const catalogueProblem = getCatalogueProblem(catalogStatus, catalog);

  return (
    <div className="site-shell">
      <header className="site-header">
        <a
          className="brand"
          href="#catalog"
          aria-label={`${marketplaceName} home`}
        >
          <span className="brand-mark">{marketplaceMark}</span>
          <span>{marketplaceName}</span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#catalog">Marketplace</a>
          <a href="#how-it-works">How it works</a>
          <a href="#developers">For developers</a>
        </nav>
        <div className="header-actions">
          <span
            className={`environment-badge ${liveReady ? "live" : "fallback"}`}
          >
            <span className="status-dot" />
            {getCatalogueBadge(catalogStatus)}
          </span>
          <button
            className="cart-button"
            type="button"
            onClick={() =>
              document
                .getElementById("cart")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            Cart <span>{cartSummary.itemCount}</span>
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              Build your CML marketplace in 5 minutes
            </p>
            <h1>A marketplace, ready to explore.</h1>
            <p>
              Use the free, open-source CML SDK to connect your sales channel
              and launch a marketplace in minutes, without starting from
              scratch.
            </p>
            <div className="hero-actions">
              <a
                className="primary-link"
                href="https://github.com/MitalioHQ/cmlmarketplace"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download from GitHub <span aria-hidden="true">↗</span>
              </a>
              <a className="secondary-link" href="#how-it-works">
                See the integration flow
              </a>
            </div>
            <p className="catalog-source">
              <span className={liveReady ? "source-live" : ""} />
              {catalogNotice}
            </p>
          </div>
          <div className="hero-art" aria-label="Marketplace preview">
            <div className="hero-window">
              <div className="window-bar">
                <i />
                <i />
                <i />
                <span>northstar / catalogue</span>
              </div>
              <div className="window-body">
                <div className="window-heading">
                  <span>{marketplaceName}</span>
                  <strong>{catalog.products.length} products</strong>
                </div>
                {catalog.products.length ? (
                  catalog.products.slice(0, 3).map((product) => (
                    <div className="mini-product" key={product.id}>
                      <ProductMark product={product} small />
                      <div>
                        <strong>{product.title}</strong>
                        <span>{product.category || "Software"}</span>
                      </div>
                      <b>{formatMoney(product.price)}</b>
                    </div>
                  ))
                ) : (
                  <div className="window-empty">
                    <strong>{getEmptyCatalogueTitle(catalogStatus)}</strong>
                    <span>No local products are substituted.</span>
                  </div>
                )}
              </div>
            </div>
            <span className="hero-chip hero-chip-one">CML catalogue</span>
            <span className="hero-chip hero-chip-two">Any payment provider</span>
          </div>
        </section>

        <section className="catalog-section" id="catalog">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{catalog.channel.slug} catalogue</p>
              <h2>{marketplaceName}</h2>
              <p>
                This grid is constructed only from the response returned by
                the CML sales channel.
              </p>
            </div>
            <label className="search-box">
              <span className="visually-hidden">Search products</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />
              </svg>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search products"
              />
            </label>
          </div>

          <div className="category-tabs" aria-label="Product categories">
            {categories.map((item) => (
              <button
                key={item}
                className={category === item ? "active" : ""}
                type="button"
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>

          {catalogueProblem && (
            <div className="catalog-warning">
              <strong>{catalogueProblem.title}</strong>
              <span>{catalogueProblem.message}</span>
            </div>
          )}

          <div className="commerce-layout">
            <div>
              {products.length ? (
                <div className="product-grid">
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      quantity={
                        cart.lines.find(
                          (line) => line.productId === product.id,
                        )?.quantity ?? 0
                      }
                      onAdd={() =>
                        changeCart(addCartItem(cart, product, 1))
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-results">
                  <span>⌕</span>
                  <h3>{getEmptyCatalogueTitle(catalogStatus, search)}</h3>
                  <p>
                    {getEmptyCatalogueMessage(
                      catalogStatus,
                      catalog,
                      search,
                    )}
                  </p>
                </div>
              )}
            </div>

            <aside className="cart-panel" id="cart" aria-label="Shopping cart">
              <div className="cart-heading">
                <div>
                  <p className="eyebrow">Your selection</p>
                  <h2>Cart</h2>
                </div>
                {cart.lines.length > 0 && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => changeCart(clearCart(cart))}
                  >
                    Clear
                  </button>
                )}
              </div>

              {cartSummary.lines.length ? (
                <>
                  <div className="cart-lines">
                    {cartSummary.lines.map(
                      ({ line, product, lineTotal }) => (
                        <div className="cart-line" key={product.id}>
                          <ProductMark product={product} small />
                          <div className="cart-line-copy">
                            <strong>{product.title}</strong>
                            <span>{formatMoney(lineTotal)}</span>
                            <div
                              className="quantity-control"
                              aria-label={`Quantity for ${product.title}`}
                            >
                              <button
                                type="button"
                                aria-label="Decrease quantity"
                                onClick={() =>
                                  changeCart(
                                    setCartItemQuantity(
                                      cart,
                                      product.id,
                                      line.quantity - 1,
                                    ),
                                  )
                                }
                              >
                                −
                              </button>
                              <span>{line.quantity}</span>
                              <button
                                type="button"
                                aria-label="Increase quantity"
                                onClick={() =>
                                  changeCart(
                                    setCartItemQuantity(
                                      cart,
                                      product.id,
                                      line.quantity + 1,
                                    ),
                                  )
                                }
                              >
                                +
                              </button>
                              <button
                                className="remove-button"
                                type="button"
                                onClick={() =>
                                  changeCart(
                                    removeCartItem(cart, product.id),
                                  )
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  <div className="cart-total">
                    <span>Estimated total</span>
                    <strong>
                      {cartSummary.total
                        ? formatMoney(cartSummary.total)
                        : "—"}
                    </strong>
                  </div>
                  <p className="cart-note">
                    CML recalculates the final amount during order preview.
                  </p>
                  <button
                    className="primary-button full-width"
                    type="button"
                    disabled={!liveReady}
                    onClick={() => setCheckoutOpen(true)}
                  >
                    {liveReady
                      ? "Review with CML"
                      : "Live CML configuration required"}
                    <span aria-hidden="true">→</span>
                  </button>
                </>
              ) : (
                <div className="empty-cart">
                  <span className="empty-cart-icon">＋</span>
                  <h3>Your cart is empty</h3>
                  <p>Add a catalogue product to begin the checkout flow.</p>
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className="flow-section" id="how-it-works">
          <div className="flow-intro">
            <p className="eyebrow">How it works</p>
            <h2>CML is the commerce reference. You own checkout.</h2>
            <p>
              The SDK coordinates catalogue, customer, order, and payment
              records. Your storefront can use Stripe, PayPal, bank transfer,
              or any provider without CML owning the hosted checkout.
            </p>
          </div>
          <CommerceFlow />
          <div className="flow-legend">
            <div>
              <span className="legend-number">01</span>
              <strong>Storefront</strong>
              <p>Displays products and keeps the shopping cart.</p>
            </div>
            <div>
              <span className="legend-number">02</span>
              <strong>CML</strong>
              <p>Creates the customer, previews totals, then stores and confirms the order.</p>
            </div>
            <div>
              <span className="legend-number">03</span>
              <strong>Merchant checkout</strong>
              <p>Collects payment and handles the provider webhook.</p>
            </div>
            <div>
              <span className="legend-number">04</span>
              <strong>Payment record</strong>
              <p>The verified webhook calls CML once with the provider transaction ID.</p>
            </div>
          </div>
        </section>

        <section className="developer-section" id="developers">
          <div className="developer-intro">
            <p className="eyebrow">For developers</p>
            <h2>Everything you need to launch in 5 minutes.</h2>
            <p className="developer-copy">
              Download the ready-to-use SDK from GitHub, then use the CML user
              guide for setup instructions, API details, and integration
              guidance.
            </p>
            <div className="developer-actions">
              <a
                className="primary-link"
                href="https://github.com/MitalioHQ/cmlmarketplace"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download the SDK <span aria-hidden="true">↗</span>
              </a>
              <a
                className="secondary-link"
                href="https://checkmylicense.dev/docs"
                target="_blank"
                rel="noopener noreferrer"
              >
                Read the CML user guide <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
          <div className="contract-list">
            <p><code>POST /sales-channel/catalog</code><span>Read northstar products</span></p>
            <p><code>POST /order/customer</code><span>Create the CML customer</span></p>
            <p><code>POST /order/submit</code><span>Preview, then create Draft</span></p>
            <p><code>POST /order/confirm</code><span>Move to Pending Payment</span></p>
            <p><code>POST /order/payment</code><span>Called by the merchant webhook</span></p>
          </div>
        </section>
      </main>

      <footer id="support">
        <a className="brand footer-brand" href="#catalog">
          <span className="brand-mark">{marketplaceMark}</span>
          <span>{marketplaceName}</span>
        </a>
        <p>Reference marketplace powered by the CML commerce APIs.</p>
        <div>
          <a href={catalog.channel.termsUrl ?? "#support"}>Terms</a>
          <a href={catalog.channel.privacyUrl ?? "#support"}>Privacy</a>
          <a href={catalog.channel.supportUrl ?? "#support"}>Support</a>
        </div>
      </footer>

      {checkoutOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setCheckoutOpen(false);
            }
          }}
        >
          <section
            className="checkout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
          >
            <header className="modal-header">
              <div>
                <p className="eyebrow">Live CML order demo</p>
                <h2 id="checkout-title">
                  {getCheckoutTitle(preview, order, paymentSimulated)}
                </h2>
              </div>
              <button
                className="close-button"
                type="button"
                aria-label="Close checkout"
                disabled={busy}
                onClick={() => setCheckoutOpen(false)}
              >
                ×
              </button>
            </header>

            <CheckoutProgress
              preview={preview}
              order={order}
              paymentSimulated={paymentSimulated}
            />

            <div className="modal-content">
              {error && (
                <div className="error-banner" role="alert">
                  <strong>Something needs attention</strong>
                  <span>{error}</span>
                </div>
              )}

              {!preview && !order && (
                <CustomerForm
                  customer={customer}
                  referralCode={referralCode}
                  busy={busy}
                  onCustomerChange={setCustomer}
                  onReferralChange={setReferralCode}
                  onSubmit={handlePreview}
                />
              )}

              {preview && !order && (
                <PreviewStep
                  preview={preview}
                  busy={busy}
                  onBack={() => setPreview(undefined)}
                  onConfirm={handleConfirm}
                />
              )}

              {order && !paymentSimulated && (
                <PaymentStep
                  order={order}
                  busy={busy}
                  onPay={handlePayment}
                />
              )}

              {order && paymentSimulated && (
                <SuccessStep
                  order={order}
                  liveOrderStatus={liveOrderStatus}
                  onStartNew={startNewOrder}
                />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  quantity,
  onAdd,
}: {
  product: CatalogProduct;
  quantity: number;
  onAdd: () => void;
}) {
  return (
    <article className="product-card">
      <div className="product-visual">
        <ProductMark product={product} />
        {product.badge && (
          <span className="product-badge">{product.badge}</span>
        )}
      </div>
      <div className="product-copy">
        <span>{product.category || "Software"}</span>
        <h3>{product.title}</h3>
        <p>{product.description}</p>
      </div>
      <div className="product-footer">
        <div>
          <strong>{formatMoney(product.price)}</strong>
          <span>licence</span>
        </div>
        <button type="button" disabled={!product.purchasable} onClick={onAdd}>
          {quantity ? `Add another · ${quantity}` : "Add to cart"}
        </button>
      </div>
    </article>
  );
}

function ProductMark({
  product,
  small = false,
}: {
  product: CatalogProduct;
  small?: boolean;
}) {
  const logo =
    typeof product.metadata?.logo === "string"
      ? product.metadata.logo
      : undefined;
  const mark =
    typeof product.metadata?.mark === "string"
      ? product.metadata.mark
      : product.title.slice(0, 1);
  const accent =
    typeof product.metadata?.accent === "string"
      ? product.metadata.accent
      : "violet";

  return (
    <span className={`product-mark ${accent} ${small ? "small" : ""}`}>
      {logo ? <img src={logo} alt="" /> : mark}
    </span>
  );
}

function CustomerForm({
  customer,
  referralCode,
  busy,
  onCustomerChange,
  onReferralChange,
  onSubmit,
}: {
  customer: CustomerInput;
  referralCode: string;
  busy: boolean;
  onCustomerChange: (customer: CustomerInput) => void;
  onReferralChange: (code: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const update = (field: keyof CustomerInput, value: string) =>
    onCustomerChange({ ...customer, [field]: value });

  return (
    <form className="customer-form" onSubmit={onSubmit}>
      <div className="step-explainer">
        <span>1</span>
        <div>
          <strong>Create the CML customer and preview the order</strong>
          <p>
            This step creates the customer in CML, then asks CML to calculate
            an authoritative preview. It does not create the order yet.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <label>
          <span>First name</span>
          <input
            required
            value={customer.firstName}
            onChange={(event) => update("firstName", event.target.value)}
          />
        </label>
        <label>
          <span>Last name</span>
          <input
            required
            value={customer.lastName}
            onChange={(event) => update("lastName", event.target.value)}
          />
        </label>
        <label className="wide-field">
          <span>Email address</span>
          <input
            required
            type="email"
            value={customer.email}
            onChange={(event) => update("email", event.target.value)}
            placeholder="customer@example.com"
          />
        </label>
        <label>
          <span>Country code</span>
          <input
            required
            maxLength={2}
            value={customer.countryCode ?? ""}
            onChange={(event) =>
              update("countryCode", event.target.value.toUpperCase())
            }
          />
        </label>
        <label>
          <span>Referral code <small>optional</small></span>
          <input
            value={referralCode}
            onChange={(event) => onReferralChange(event.target.value)}
          />
        </label>
      </div>
      <button className="primary-button full-width" disabled={busy}>
        {busy && <span className="spinner" />}
        {busy ? "Creating customer and preview…" : "Preview with CML"}
      </button>
    </form>
  );
}

function PreviewStep({
  preview,
  busy,
  onBack,
  onConfirm,
}: {
  preview: OrderPreview;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="preview-step">
      <div className="step-explainer success">
        <span>✓</span>
        <div>
          <strong>CML returned the authoritative preview</strong>
          <p>
            Confirming next submits a Draft order and immediately confirms it
            to Pending Payment.
          </p>
        </div>
      </div>
      <div className="order-lines">
        {preview.items.map((item) => (
          <div key={item.productId}>
            <span>
              <strong>{item.title}</strong>
              <small>Qty {item.quantity}</small>
            </span>
            <strong>{formatMoney(item.lineTotal)}</strong>
          </div>
        ))}
      </div>
      <div className="totals-card">
        <p><span>Subtotal</span><strong>{formatMoney(preview.totals.subtotal)}</strong></p>
        <p><span>Discount</span><strong>− {formatMoney(preview.totals.discount)}</strong></p>
        <p className="grand-total"><span>CML total</span><strong>{formatMoney(preview.totals.total)}</strong></p>
      </div>
      <div className="modal-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={onBack}>Back</button>
        <button className="primary-button" type="button" disabled={busy} onClick={onConfirm}>
          {busy && <span className="spinner" />}
          {busy ? "Creating and confirming…" : "Create & confirm CML order"}
        </button>
      </div>
    </div>
  );
}

function PaymentStep({
  order,
  busy,
  onPay,
}: {
  order: CommerceOrder;
  busy: boolean;
  onPay: () => void;
}) {
  return (
    <div className="payment-step">
      <div className="order-created-banner">
        <span>✓</span>
        <div>
          <strong>Live CML order {order.code}</strong>
          <p>Status: Pending Payment · The order was created as Draft, then confirmed.</p>
        </div>
      </div>
      <div className="demo-payment-card">
        <div>
          <span className="demo-provider-mark">DEMO</span>
          <div>
            <strong>Simulated provider, live CML payment</strong>
            <small>
              The provider success is simulated; the captured payment is
              recorded in CML.
            </small>
          </div>
        </div>
        <strong>{formatMoney(order.amountDue)}</strong>
      </div>
      <p className="security-note">
        This calls CML <code>/order/payment</code> with the full amount. It can
        mark the live order Paid and enqueue real licence creation jobs. No
        external money is collected.
      </p>
      <button className="primary-button pay-button" type="button" disabled={busy} onClick={onPay}>
        <span>
          {busy
            ? "Recording captured payment in CML…"
            : "Simulate provider + record CML payment"}
        </span>
        <strong>{formatMoney(order.amountDue)}</strong>
      </button>
    </div>
  );
}

function SuccessStep({
  order,
  liveOrderStatus,
  onStartNew,
}: {
  order: CommerceOrder;
  liveOrderStatus?: CommerceOrder["status"];
  onStartNew: () => void;
}) {
  return (
    <div className="success-step">
      <span className="success-icon">✓</span>
      <p className="eyebrow">Live CML payment recorded</p>
      <h3>The order is paid.</h3>
      <p>
        The external provider and webhook were simulated, then the captured
        payment was recorded in CML. Order <strong>{order.code}</strong> is{" "}
        <strong>{formatStatus(liveOrderStatus ?? order.status)}</strong>.
        Licence fulfilment continues asynchronously in CML.
      </p>
      <div className="status-timeline">
        <div className="complete"><span>✓</span><strong>Customer + preview</strong></div>
        <div className="complete"><span>✓</span><strong>Order confirmed</strong></div>
        <div className="complete"><span>✓</span><strong>CML payment recorded</strong></div>
      </div>
      <button className="primary-button" type="button" onClick={onStartNew}>Start another order</button>
    </div>
  );
}

function CheckoutProgress({
  preview,
  order,
  paymentSimulated,
}: {
  preview?: OrderPreview;
  order?: CommerceOrder;
  paymentSimulated: boolean;
}) {
  return (
    <div className="checkout-progress" aria-label="Checkout progress">
      <div className="active"><span>{preview || order ? "✓" : "1"}</span><strong>Customer + preview</strong></div>
      <i className={preview || order ? "active" : ""} />
      <div className={order ? "active" : ""}><span>{order ? "✓" : "2"}</span><strong>Confirm order</strong></div>
      <i className={order ? "active" : ""} />
      <div className={paymentSimulated ? "active" : ""}><span>{paymentSimulated ? "✓" : "3"}</span><strong>CML payment</strong></div>
    </div>
  );
}

function CommerceFlow() {
  type ParticipantId = "B" | "M" | "C" | "P" | "J";
  const positions: Record<ParticipantId, number> = {
    B: 115,
    M: 350,
    C: 585,
    P: 820,
    J: 1055,
  };
  const participants = [
    { id: "B", label: "Customer Browser", x: positions.B },
    { id: "M", label: "Merchant Backend", x: positions.M },
    { id: "C", label: "CML APIs", x: positions.C },
    { id: "P", label: "Payment Provider", x: positions.P },
    { id: "J", label: "CML License Jobs", x: positions.J },
  ];
  const messages: Array<{
    from: ParticipantId;
    to: ParticipantId;
    y: number;
    label: string;
    response?: boolean;
  }> = [
    { from: "B", to: "C", y: 145, label: "Load channel catalogue" },
    {
      from: "C",
      to: "B",
      y: 190,
      label: "Visible products, prices, availability",
      response: true,
    },
    {
      from: "B",
      to: "M",
      y: 280,
      label: "Customer details and cart",
    },
    {
      from: "M",
      to: "C",
      y: 325,
      label: "Create authoritative order preview",
    },
    {
      from: "C",
      to: "M",
      y: 370,
      label: "Preview ID, totals, expiry, warnings",
      response: true,
    },
    {
      from: "M",
      to: "B",
      y: 415,
      label: "Show order preview",
      response: true,
    },
    { from: "B", to: "M", y: 460, label: "Confirm order" },
    {
      from: "M",
      to: "C",
      y: 505,
      label: "Upsert customer + create and confirm order",
    },
    {
      from: "C",
      to: "M",
      y: 550,
      label: "Pending-payment order",
      response: true,
    },
    {
      from: "M",
      to: "P",
      y: 595,
      label: "Create merchant-owned checkout",
    },
    {
      from: "P",
      to: "M",
      y: 640,
      label: "Verified payment webhook",
      response: true,
    },
    {
      from: "M",
      to: "C",
      y: 685,
      label: "Record payment with idempotency key",
    },
    {
      from: "C",
      to: "J",
      y: 730,
      label: "Enqueue license creation when fully paid",
    },
    {
      from: "C",
      to: "M",
      y: 775,
      label: "Payment and order status",
      response: true,
    },
  ];

  return (
    <div>
      <div
        className="flow-diagram sequence-diagram"
        role="img"
        aria-label="Technical CML marketplace sequence diagram"
      >
        <svg viewBox="0 0 1170 830">
          <desc>
            Sequence from the customer browser through the merchant backend,
            CML APIs, payment provider, and CML license jobs.
          </desc>
          <defs>
            <marker
              id="sequence-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>

          {participants.map((participant) => (
            <g className="sequence-participant" key={participant.id}>
              <rect
                x={participant.x - 88}
                y="22"
                width="176"
                height="56"
                rx="10"
              />
              <text x={participant.x} y="55">
                {participant.label}
              </text>
              <line
                className="sequence-lifeline"
                x1={participant.x}
                x2={participant.x}
                y1="78"
                y2="808"
              />
            </g>
          ))}

          <g className="sequence-message sequence-self">
            <path
              d="M127 228 H183 V258 H127"
              markerEnd="url(#sequence-arrow)"
            />
            <text x="192" y="249">Build local cart</text>
          </g>

          {messages.map((message) => {
            const fromX = positions[message.from];
            const toX = positions[message.to];
            const direction = toX > fromX ? 1 : -1;

            return (
              <g
                className={`sequence-message ${
                  message.response ? "response" : ""
                }`}
                key={`${message.y}-${message.label}`}
              >
                <line
                  x1={fromX + direction * 12}
                  x2={toX - direction * 12}
                  y1={message.y}
                  y2={message.y}
                  markerEnd="url(#sequence-arrow)"
                />
                <text
                  x={(fromX + toX) / 2}
                  y={message.y - 9}
                >
                  {message.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function getCatalogueBadge(status: CatalogStatus): string {
  switch (status) {
    case "live":
      return "Live CML catalogue";
    case "restricted":
      return "Catalogue restricted";
    case "not_found":
      return "Catalogue unavailable";
    case "error":
      return "CML connection error";
    case "unconfigured":
      return "CML configuration required";
    default:
      return "Loading catalogue";
  }
}

function getCatalogueProblem(
  status: CatalogStatus,
  catalog: Catalog,
): { title: string; message: string } | undefined {
  if (status === "restricted") {
    return (
      catalog.fallback ?? {
        title: "Catalogue unavailable in this country",
        message:
          "CML returned available: false, so no products are displayed.",
      }
    );
  }

  if (status === "not_found") {
    return {
      title: "Catalogue not found",
      message:
        "The sales-channel slug is unknown, inactive, or could not be loaded. The marketplace remains empty.",
    };
  }

  if (status === "unconfigured") {
    return {
      title: "CML connection required",
      message:
        "Configure the server API key and secret to request the northstar catalogue. No local sample products are used.",
    };
  }

  if (status === "error") {
    return {
      title: "Catalogue could not be loaded",
      message:
        "CML returned an authentication, permission, or server error. The marketplace remains empty.",
    };
  }

  return undefined;
}

function getEmptyCatalogueTitle(
  status: CatalogStatus,
  search = "",
): string {
  if (search.trim()) return "No matching products";

  switch (status) {
    case "loading":
      return "Loading the CML catalogue";
    case "restricted":
      return "Catalogue unavailable here";
    case "not_found":
      return "Catalogue not found";
    case "error":
      return "Catalogue could not be loaded";
    case "unconfigured":
      return "Connect CML to load products";
    default:
      return "This catalogue is empty";
  }
}

function getEmptyCatalogueMessage(
  status: CatalogStatus,
  catalog: Catalog,
  search: string,
): string {
  if (search.trim()) return "Try another search or category.";
  if (status === "restricted" && catalog.fallback) {
    return catalog.fallback.message;
  }
  if (status === "live") {
    return "CML returned a valid catalogue with no visible products.";
  }
  return "No products are substituted from local demo data.";
}

function getCheckoutTitle(
  preview?: OrderPreview,
  order?: CommerceOrder,
  paymentSimulated?: boolean,
) {
  if (paymentSimulated) return "Simulation complete";
  if (order) return "Try the merchant checkout";
  if (preview) return "Review CML pricing";
  return "Customer details";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function formatStatus(status: CommerceOrder["status"]): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
