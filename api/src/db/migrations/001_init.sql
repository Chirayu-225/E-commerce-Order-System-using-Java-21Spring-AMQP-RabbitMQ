-- =====================================================================
-- FlashCart schema v1.  Applied once, in order, by src/db/migrate.ts and
-- recorded in schema_migrations.  Never edit an applied migration: add 002_...
--
-- Design rule: every business invariant that must NEVER break (stock never
-- negative, units conserved, a sale never oversold, one order per idempotency
-- key) is enforced by the DATABASE, not only by application code.
-- =====================================================================

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    password_hash text        NOT NULL,
    name          text        NOT NULL,
    role          text        NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER', 'ADMIN')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));

CREATE TABLE products (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku          text        NOT NULL UNIQUE,
    name         text        NOT NULL,
    brand        text        NOT NULL,
    category     text        NOT NULL,
    description  text        NOT NULL,
    price_minor  integer     NOT NULL CHECK (price_minor > 0),          -- paise
    mrp_minor    integer     NOT NULL,
    rating       numeric(2,1) NOT NULL DEFAULT 4.0,
    rating_count integer     NOT NULL DEFAULT 0,
    hue          smallint    NOT NULL DEFAULT 220,                      -- tint for generated product art
    is_active    boolean     NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english'::regconfig, coalesce(brand, '')), 'B') ||
        setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'C')
    ) STORED,
    CONSTRAINT ck_mrp_ge_price CHECK (mrp_minor >= price_minor)
);
CREATE INDEX ix_products_category ON products (category) WHERE is_active;
CREATE INDEX ix_products_search   ON products USING GIN (search_vector);

-- Stock.  on_hand = physically in the warehouse and unsold (includes reserved units).
--         reserved = held by unpaid/in-flight orders.   sold = paid and committed.
CREATE TABLE inventory (
    product_id    uuid PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
    initial_stock integer     NOT NULL CHECK (initial_stock >= 0),
    on_hand       integer     NOT NULL CHECK (on_hand >= 0),
    reserved      integer     NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    sold          integer     NOT NULL DEFAULT 0 CHECK (sold >= 0),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_reserved_le_on_hand CHECK (reserved <= on_hand),     -- can never reserve what we do not have
    CONSTRAINT ck_conservation        CHECK (on_hand + sold = initial_stock) -- units are never created or lost
);

-- Append-only ledger of every stock change; lets the integrity check prove inventory == sum(movements).
CREATE TABLE stock_movements (
    id          bigserial PRIMARY KEY,
    product_id  uuid        NOT NULL,
    order_id    uuid,
    sale_id     uuid,
    reason      text        NOT NULL,
    d_on_hand   integer     NOT NULL DEFAULT 0,
    d_reserved  integer     NOT NULL DEFAULT 0,
    d_sold      integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_movements_product ON stock_movements (product_id);

CREATE TABLE flash_sales (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       uuid        NOT NULL REFERENCES products (id),
    sale_price_minor integer     NOT NULL CHECK (sale_price_minor > 0),
    quantity         integer     NOT NULL CHECK (quantity > 0),          -- units allocated to this sale
    claimed          integer     NOT NULL DEFAULT 0 CHECK (claimed >= 0), -- reserved + sold units
    per_user_limit   integer     NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
    starts_at        timestamptz NOT NULL,
    ends_at          timestamptz NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_sale_window  CHECK (ends_at > starts_at),
    CONSTRAINT ck_sale_claimed CHECK (claimed <= quantity)               -- a sale can never be oversold
);
CREATE INDEX ix_sales_window  ON flash_sales (starts_at, ends_at);
CREATE INDEX ix_sales_product ON flash_sales (product_id);

CREATE TABLE sale_user_claims (
    sale_id uuid    NOT NULL REFERENCES flash_sales (id) ON DELETE CASCADE,
    user_id uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    qty     integer NOT NULL CHECK (qty >= 0),
    PRIMARY KEY (sale_id, user_id)
);

CREATE SEQUENCE order_number_seq START 100001;

CREATE TABLE orders (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number           text        NOT NULL UNIQUE DEFAULT ('FC-' || nextval('order_number_seq')),
    user_id          uuid        NOT NULL REFERENCES users (id),
    status           text        NOT NULL CHECK (status IN
                       ('PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED')),
    subtotal_minor   integer     NOT NULL CHECK (subtotal_minor >= 0),
    shipping_minor   integer     NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
    total_minor      integer     NOT NULL CHECK (total_minor >= 0),
    shipping_address jsonb       NOT NULL,
    idempotency_key  text        NOT NULL,
    request_hash     text        NOT NULL,
    expires_at       timestamptz NOT NULL,
    paid_at          timestamptz,
    cancel_reason    text,
    version          integer     NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    -- A retried checkout request (same key) can never create a second order.
    CONSTRAINT ux_orders_idempotency UNIQUE (user_id, idempotency_key)
);
CREATE INDEX ix_orders_user    ON orders (user_id, created_at DESC);
CREATE INDEX ix_orders_expiry  ON orders (expires_at) WHERE status = 'PENDING_PAYMENT';
CREATE INDEX ix_orders_created ON orders (created_at DESC);

CREATE TABLE order_items (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id         uuid    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id       uuid    NOT NULL REFERENCES products (id),
    flash_sale_id    uuid    REFERENCES flash_sales (id),
    name             text    NOT NULL,       -- snapshot: later catalog edits never rewrite history
    category         text    NOT NULL,
    hue              smallint NOT NULL,
    qty              integer NOT NULL CHECK (qty > 0 AND qty <= 10),
    unit_price_minor integer NOT NULL CHECK (unit_price_minor > 0)
);
CREATE INDEX ix_items_order ON order_items (order_id);
CREATE INDEX ix_items_sale  ON order_items (flash_sale_id) WHERE flash_sale_id IS NOT NULL;

CREATE TABLE order_events (
    id          bigserial PRIMARY KEY,
    order_id    uuid        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    from_status text,
    to_status   text        NOT NULL,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_order_events_order ON order_events (order_id, id);

CREATE TABLE payments (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       uuid        NOT NULL REFERENCES orders (id),
    provider       text        NOT NULL DEFAULT 'mockpay',
    provider_ref   text        NOT NULL UNIQUE,
    status         text        NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED')),
    amount_minor   integer     NOT NULL CHECK (amount_minor >= 0),
    failure_reason text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_payments_order ON payments (order_id);

-- Webhook de-duplication: gateways deliver at-least-once, so we must process each event id once.
CREATE TABLE payment_webhook_events (
    event_id    text        PRIMARY KEY,
    received_at timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox: events are written in the SAME transaction as the state change,
-- then relayed to RabbitMQ.  No "saved but never announced" and no "announced but rolled back".
CREATE TABLE outbox (
    id             bigserial   PRIMARY KEY,
    event_id       uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    aggregate_type text        NOT NULL,
    aggregate_id   text        NOT NULL,
    type           text        NOT NULL,        -- also the RabbitMQ routing key
    payload        jsonb       NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    published_at   timestamptz,
    attempts       integer     NOT NULL DEFAULT 0
);
CREATE INDEX ix_outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

-- Consumer-side de-duplication: RabbitMQ delivers at-least-once, so each consumer records what it handled.
CREATE TABLE inbox (
    consumer     text        NOT NULL,
    event_id     uuid        NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);

CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    order_id   uuid        REFERENCES orders (id) ON DELETE CASCADE,
    title      text        NOT NULL,
    body       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at    timestamptz
);
CREATE INDEX ix_notifications_user ON notifications (user_id, created_at DESC);
