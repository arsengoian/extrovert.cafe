\restrict dbmate

-- Dumped from database version 16.14
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    role text NOT NULL,
    password_hash text,
    password_set_at timestamp with time zone,
    disabled_at timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'ops'::text])))
);


--
-- Name: bonus_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonus_grants (
    id bigint NOT NULL,
    receipt_id bigint NOT NULL,
    point_id text NOT NULL,
    coins_yellow integer DEFAULT 0 NOT NULL,
    items jsonb,
    claim_token text NOT NULL,
    show_until timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone,
    redeemed_by uuid,
    redeemed_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT bonus_grants_coins_yellow_check CHECK ((coins_yellow >= 0)),
    CONSTRAINT bonus_grants_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'redeemed'::text])))
);


--
-- Name: bonus_grants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bonus_grants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bonus_grants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bonus_grants_id_seq OWNED BY public.bonus_grants.id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id bigint NOT NULL,
    plant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    body text NOT NULL,
    coins_charged integer DEFAULT 0 NOT NULL,
    tokens_in integer,
    tokens_out integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_coins_charged_check CHECK ((coins_charged >= 0)),
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'plant'::text, 'system'::text])))
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: coin_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coin_transfers (
    id bigint NOT NULL,
    from_user uuid NOT NULL,
    to_user uuid NOT NULL,
    amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coin_transfers_amount_check CHECK ((amount > 0)),
    CONSTRAINT coin_transfers_check CHECK ((from_user <> to_user))
);


--
-- Name: coin_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coin_transfers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coin_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coin_transfers_id_seq OWNED BY public.coin_transfers.id;


--
-- Name: crate_openings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crate_openings (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    source text NOT NULL,
    paid_currency text,
    paid_amount numeric(10,2),
    result_item_id bigint NOT NULL,
    result_coins integer NOT NULL,
    was_duplicate boolean DEFAULT false NOT NULL,
    rolled_tier text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crate_openings_paid_currency_check CHECK ((paid_currency = ANY (ARRAY['yellow'::text, 'uah'::text]))),
    CONSTRAINT crate_openings_result_coins_check CHECK ((result_coins >= 0)),
    CONSTRAINT crate_openings_rolled_tier_check CHECK ((rolled_tier = ANY (ARRAY['common'::text, 'uncommon'::text, 'rare'::text, 'epic'::text]))),
    CONSTRAINT crate_openings_source_check CHECK ((source = ANY (ARRAY['coins'::text, 'cash'::text, 'bonus_drink'::text, 'shadow_drop'::text])))
);


--
-- Name: crate_openings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crate_openings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crate_openings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crate_openings_id_seq OWNED BY public.crate_openings.id;


--
-- Name: device_telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_telemetry (
    id bigint NOT NULL,
    point_id text NOT NULL,
    source text NOT NULL,
    idem_key text NOT NULL,
    measured_at timestamp with time zone NOT NULL,
    metrics jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_telemetry_source_check CHECK ((source = ANY (ARRAY['pi'::text, 'jetinno'::text, 'camera'::text])))
);


--
-- Name: device_telemetry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_telemetry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_telemetry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_telemetry_id_seq OWNED BY public.device_telemetry.id;


--
-- Name: drinks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drinks (
    id bigint NOT NULL,
    system_code text NOT NULL,
    name text NOT NULL,
    vol text,
    price_uah numeric(10,2) NOT NULL,
    coins integer DEFAULT 0 NOT NULL,
    bonus_coins integer DEFAULT 0 NOT NULL,
    sprite text,
    cup text,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    color text,
    foam boolean DEFAULT false NOT NULL,
    CONSTRAINT drinks_bonus_coins_check CHECK ((bonus_coins >= 0)),
    CONSTRAINT drinks_coins_check CHECK ((coins >= 0)),
    CONSTRAINT drinks_price_uah_check CHECK ((price_uah >= (0)::numeric))
);


--
-- Name: COLUMN drinks.color; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.drinks.color IS 'Колір картки в меню кіоска, #rrggbb — картка малюється ним, а не картинкою';


--
-- Name: COLUMN drinks.foam; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.drinks.foam IS 'Напій із піною: кіоск малює шапку на стакані';


--
-- Name: drinks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.drinks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: drinks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.drinks_id_seq OWNED BY public.drinks.id;


--
-- Name: health_samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_samples (
    id bigint NOT NULL,
    target text NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    ok boolean NOT NULL,
    detail text,
    samples integer DEFAULT 1 NOT NULL,
    ms_total bigint DEFAULT 0 NOT NULL,
    ms_count integer DEFAULT 0 NOT NULL
);


--
-- Name: health_samples_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.health_samples_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: health_samples_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.health_samples_id_seq OWNED BY public.health_samples.id;


--
-- Name: item_defs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_defs (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    collection text,
    description_md text DEFAULT ''::text NOT NULL,
    slot text NOT NULL,
    tier text NOT NULL,
    sprite_id text NOT NULL,
    price_coins integer,
    season_id bigint,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT item_defs_check CHECK (((NOT active) OR (description_md <> ''::text))),
    CONSTRAINT item_defs_price_coins_check CHECK ((price_coins > 0)),
    CONSTRAINT item_defs_slot_check CHECK ((slot = ANY (ARRAY['head'::text, 'body'::text, 'pants'::text, 'feet'::text, 'acc_1'::text]))),
    CONSTRAINT item_defs_tier_check CHECK ((tier = ANY (ARRAY['common'::text, 'uncommon'::text, 'rare'::text, 'epic'::text])))
);


--
-- Name: item_defs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_defs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_defs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_defs_id_seq OWNED BY public.item_defs.id;


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    delta_yellow integer DEFAULT 0 NOT NULL,
    delta_silver integer DEFAULT 0 NOT NULL,
    delta_beans integer DEFAULT 0 NOT NULL,
    reason text NOT NULL,
    ref_type text,
    ref_id bigint,
    idem_key text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_entries_check CHECK (((delta_yellow <> 0) OR (delta_silver <> 0) OR (delta_beans <> 0))),
    CONSTRAINT ledger_entries_reason_check CHECK ((reason = ANY (ARRAY['purchase'::text, 'quiz'::text, 'repost'::text, 'crate'::text, 'care'::text, 'chat'::text, 'transfer'::text, 'market'::text, 'exchange'::text, 'pos_discount'::text, 'delivery'::text, 'sapling'::text, 'wardrobe_set'::text, 'harvest'::text, 'admin'::text]))),
    CONSTRAINT ledger_entries_ref_type_check CHECK ((ref_type = ANY (ARRAY['receipt'::text, 'crate_opening'::text, 'market_trade'::text, 'coin_transfer'::text, 'redemption'::text, 'user_crate'::text])))
);


--
-- Name: ledger_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ledger_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ledger_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ledger_entries_id_seq OWNED BY public.ledger_entries.id;


--
-- Name: login_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_links (
    token_hash bytea NOT NULL,
    email public.citext NOT NULL,
    next_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    ip inet,
    user_agent text
);


--
-- Name: TABLE login_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.login_links IS 'Одноразові посилання для входу поштою (хеш токена, 15 хвилин)';


--
-- Name: market_listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_listings (
    id bigint NOT NULL,
    seller_id uuid NOT NULL,
    kind text NOT NULL,
    user_item_id bigint,
    plant_id uuid,
    price_amount integer NOT NULL,
    price_currency text NOT NULL,
    commission_pct numeric(5,2) NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_listings_check CHECK ((((kind = 'item'::text) AND (user_item_id IS NOT NULL) AND (plant_id IS NULL)) OR ((kind = 'plant'::text) AND (plant_id IS NOT NULL) AND (user_item_id IS NULL)))),
    CONSTRAINT market_listings_impressions_check CHECK ((impressions >= 0)),
    CONSTRAINT market_listings_kind_check CHECK ((kind = ANY (ARRAY['item'::text, 'plant'::text]))),
    CONSTRAINT market_listings_price_amount_check CHECK ((price_amount > 0)),
    CONSTRAINT market_listings_price_currency_check CHECK ((price_currency = ANY (ARRAY['yellow'::text, 'beans'::text]))),
    CONSTRAINT market_listings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'sold'::text, 'cancelled'::text])))
);


--
-- Name: market_listings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.market_listings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_listings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.market_listings_id_seq OWNED BY public.market_listings.id;


--
-- Name: market_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_trades (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    gross integer NOT NULL,
    commission integer NOT NULL,
    net integer NOT NULL,
    currency text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_trades_check CHECK (((net + commission) = gross)),
    CONSTRAINT market_trades_check1 CHECK ((buyer_id <> seller_id)),
    CONSTRAINT market_trades_commission_check CHECK ((commission >= 0)),
    CONSTRAINT market_trades_currency_check CHECK ((currency = ANY (ARRAY['yellow'::text, 'beans'::text]))),
    CONSTRAINT market_trades_gross_check CHECK ((gross > 0)),
    CONSTRAINT market_trades_net_check CHECK ((net >= 0))
);


--
-- Name: market_trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.market_trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.market_trades_id_seq OWNED BY public.market_trades.id;


--
-- Name: menu_deployment_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_deployment_targets (
    id bigint NOT NULL,
    deployment_id bigint NOT NULL,
    kind text NOT NULL,
    point_id text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    done_at timestamp with time zone,
    acked_at timestamp with time zone,
    error text,
    CONSTRAINT menu_deployment_targets_kind_check CHECK ((kind = ANY (ARRAY['r2'::text, 'checkbox'::text, 'jetinno'::text]))),
    CONSTRAINT menu_deployment_targets_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'deploying'::text, 'done'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: menu_deployment_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.menu_deployment_targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: menu_deployment_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.menu_deployment_targets_id_seq OWNED BY public.menu_deployment_targets.id;


--
-- Name: menu_deployments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_deployments (
    id bigint NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    created_by uuid,
    scheduled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT menu_deployments_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'deploying'::text, 'done'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: menu_deployments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.menu_deployments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: menu_deployments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.menu_deployments_id_seq OWNED BY public.menu_deployments.id;


--
-- Name: news_broadcasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_broadcasts (
    id bigint NOT NULL,
    created_by uuid,
    title text NOT NULL,
    body text NOT NULL,
    audience text,
    sent_at timestamp with time zone
);


--
-- Name: news_broadcasts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_broadcasts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_broadcasts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_broadcasts_id_seq OWNED BY public.news_broadcasts.id;


--
-- Name: nickname_words; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nickname_words (
    id bigint NOT NULL,
    kind text NOT NULL,
    word text NOT NULL,
    forms jsonb,
    gender text,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT nickname_words_check CHECK ((((kind = 'adjective'::text) AND (forms IS NOT NULL)) OR ((kind = 'noun'::text) AND (gender IS NOT NULL)))),
    CONSTRAINT nickname_words_gender_check CHECK ((gender = ANY (ARRAY['m'::text, 'f'::text, 'n'::text]))),
    CONSTRAINT nickname_words_kind_check CHECK ((kind = ANY (ARRAY['adjective'::text, 'noun'::text])))
);


--
-- Name: nickname_words_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nickname_words_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nickname_words_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nickname_words_id_seq OWNED BY public.nickname_words.id;


--
-- Name: np_cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.np_cities (
    ref text NOT NULL,
    name text NOT NULL,
    area text,
    settlement_type text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: np_warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.np_warehouses (
    ref text NOT NULL,
    city_ref text NOT NULL,
    number integer,
    category text,
    type_ref text,
    description text,
    short_address text,
    place_max_weight_kg integer,
    dimension_limits jsonb,
    schedule jsonb,
    status text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT np_warehouses_category_check CHECK ((category = ANY (ARRAY['branch'::text, 'postomat'::text])))
);


--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox (
    id bigint NOT NULL,
    channel text NOT NULL,
    event text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    attempts smallint DEFAULT 0 NOT NULL
);


--
-- Name: outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outbox_id_seq OWNED BY public.outbox.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'mono'::text NOT NULL,
    invoice_id text NOT NULL,
    pack_code text NOT NULL,
    coins integer NOT NULL,
    amount_uah numeric(10,2) NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    ledger_entry_id bigint,
    credited_at timestamp with time zone,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    product text DEFAULT 'coins'::text NOT NULL,
    CONSTRAINT payments_amount_uah_check CHECK ((amount_uah > (0)::numeric)),
    CONSTRAINT payments_coins_check CHECK ((coins >= 0)),
    CONSTRAINT payments_product_check CHECK ((product = ANY (ARRAY['coins'::text, 'crate'::text]))),
    CONSTRAINT payments_provider_check CHECK ((provider = ANY (ARRAY['mono'::text, 'test'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['created'::text, 'processing'::text, 'success'::text, 'failure'::text, 'expired'::text, 'reversed'::text])))
);


--
-- Name: COLUMN payments.product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.product IS 'Що куплено: coins — набір монет (pack_code з coin_packs), crate — скринька на склад (coins = 0)';


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: plant_stage_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plant_stage_transitions (
    id bigint NOT NULL,
    plant_id uuid NOT NULL,
    from_stage smallint NOT NULL,
    to_stage smallint NOT NULL,
    consumed text NOT NULL,
    cost_coins integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plant_stage_transitions_consumed_check CHECK ((consumed = ANY (ARRAY['water'::text, 'compost'::text, 'fertilizer'::text, 'insecticide'::text])))
);


--
-- Name: plant_stage_transitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plant_stage_transitions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plant_stage_transitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plant_stage_transitions_id_seq OWNED BY public.plant_stage_transitions.id;


--
-- Name: plants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text,
    growth_stage smallint DEFAULT 0 NOT NULL,
    face_set_id integer NOT NULL,
    last_stage_transition_at timestamp with time zone,
    last_watered_at timestamp with time zone,
    cycle_phase text DEFAULT 'initial'::text NOT NULL,
    lifetime_beans_gifted integer DEFAULT 0 NOT NULL,
    worn_set_id bigint,
    listing_id bigint,
    appearance jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stage_progress smallint DEFAULT 0 NOT NULL,
    chat_seen_at timestamp with time zone,
    CONSTRAINT plants_cycle_phase_check CHECK ((cycle_phase = ANY (ARRAY['initial'::text, 'regrowth'::text]))),
    CONSTRAINT plants_growth_stage_check CHECK (((growth_stage >= 0) AND (growth_stage <= 10))),
    CONSTRAINT plants_lifetime_beans_gifted_check CHECK ((lifetime_beans_gifted >= 0)),
    CONSTRAINT plants_stage_progress_check CHECK ((stage_progress >= 0))
);


--
-- Name: COLUMN plants.chat_seen_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.plants.chat_seen_at IS 'Останнє відкриття чату гравцем; репліки кавенятка й системи після нього — непрочитані';


--
-- Name: points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.points (
    id text NOT NULL,
    name text NOT NULL,
    address text,
    timezone text DEFAULT 'Europe/Kyiv'::text NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    checkbox_branch_id text,
    key_hash text,
    next_key_hash text,
    key_rotated_at timestamp with time zone,
    key_revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    short_address text,
    CONSTRAINT points_id_check CHECK ((id ~ '^[a-z0-9][a-z0-9-]{1,30}$'::text)),
    CONSTRAINT points_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'live'::text, 'paused'::text])))
);


--
-- Name: COLUMN points.short_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.points.short_address IS 'Адреса для рядка вибору точки в застосунку: вулиця й будинок без міста';


--
-- Name: pos_discount_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_discount_codes (
    id bigint NOT NULL,
    ledger_entry_id bigint NOT NULL,
    user_id uuid NOT NULL,
    code text NOT NULL,
    amount_uah numeric(10,2) NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone,
    receipt_id bigint,
    CONSTRAINT pos_discount_codes_amount_uah_check CHECK ((amount_uah > (0)::numeric))
);


--
-- Name: pos_discount_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pos_discount_codes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pos_discount_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pos_discount_codes_id_seq OWNED BY public.pos_discount_codes.id;


--
-- Name: problem_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.problem_reports (
    id bigint NOT NULL,
    user_id uuid,
    point_id text,
    categories text[] DEFAULT '{}'::text[] NOT NULL,
    body text,
    image_r2_key text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT problem_reports_status_check CHECK ((status = ANY (ARRAY['new'::text, 'read'::text, 'closed'::text])))
);


--
-- Name: problem_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.problem_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: problem_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.problem_reports_id_seq OWNED BY public.problem_reports.id;


--
-- Name: promos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promos (
    id bigint NOT NULL,
    kind text DEFAULT 'promo'::text NOT NULL,
    head1 text NOT NULL,
    head2 text DEFAULT ''::text NOT NULL,
    sub text DEFAULT ''::text NOT NULL,
    fine text DEFAULT ''::text NOT NULL,
    drink_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone,
    archived_at timestamp with time zone,
    is_current boolean DEFAULT false NOT NULL,
    CONSTRAINT promos_kind_check CHECK ((kind = ANY (ARRAY['promo'::text, 'notice'::text, 'news'::text, 'none'::text])))
);


--
-- Name: promos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.promos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: promos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.promos_id_seq OWNED BY public.promos.id;


--
-- Name: quiz_drink_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_drink_responses (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    receipt_item_id bigint NOT NULL,
    answers jsonb NOT NULL,
    free_text text,
    coins_awarded integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quiz_drink_responses_coins_awarded_check CHECK ((coins_awarded >= 0))
);


--
-- Name: quiz_drink_responses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quiz_drink_responses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quiz_drink_responses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quiz_drink_responses_id_seq OWNED BY public.quiz_drink_responses.id;


--
-- Name: quiz_profile_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_profile_responses (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    answers jsonb NOT NULL,
    free_text text,
    coins_awarded integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quiz_profile_responses_coins_awarded_check CHECK ((coins_awarded >= 0))
);


--
-- Name: quiz_profile_responses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quiz_profile_responses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quiz_profile_responses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quiz_profile_responses_id_seq OWNED BY public.quiz_profile_responses.id;


--
-- Name: receipt_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipt_items (
    id bigint NOT NULL,
    receipt_id bigint NOT NULL,
    system_code text NOT NULL,
    name text NOT NULL,
    qty numeric(10,3) NOT NULL,
    price_uah numeric(10,2) NOT NULL,
    sum_uah numeric(12,2) NOT NULL,
    is_bonus_drink boolean DEFAULT false NOT NULL
);


--
-- Name: receipt_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.receipt_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: receipt_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.receipt_items_id_seq OWNED BY public.receipt_items.id;


--
-- Name: receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipts (
    id bigint NOT NULL,
    point_id text NOT NULL,
    checkbox_receipt_id uuid NOT NULL,
    checkbox_shift_id uuid,
    fiscal_code text,
    fiscal_date timestamp with time zone NOT NULL,
    total_sum numeric(12,2) NOT NULL,
    payments jsonb,
    tax_url text,
    source text NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT receipts_source_check CHECK ((source = ANY (ARRAY['webhook'::text, 'poll'::text])))
);


--
-- Name: receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.receipts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: receipts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.receipts_id_seq OWNED BY public.receipts.id;


--
-- Name: redemption_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redemption_events (
    id bigint NOT NULL,
    redemption_id bigint NOT NULL,
    status text NOT NULL,
    source text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT redemption_events_source_check CHECK ((source = ANY (ARRAY['admin'::text, 'np'::text, 'system'::text])))
);


--
-- Name: redemption_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.redemption_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: redemption_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.redemption_events_id_seq OWNED BY public.redemption_events.id;


--
-- Name: redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redemptions (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    ledger_entry_id bigint NOT NULL,
    product text NOT NULL,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    cost_uah_actual numeric(10,2),
    recipient_name text NOT NULL,
    recipient_phone text NOT NULL,
    np_warehouse_ref text,
    np_warehouse_kind text,
    np_address_snapshot text NOT NULL,
    np_ttn text,
    np_status_code text,
    status text DEFAULT 'new'::text NOT NULL,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    user_seen_at timestamp with time zone,
    evidence_event_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT redemptions_np_warehouse_kind_check CHECK ((np_warehouse_kind = ANY (ARRAY['branch'::text, 'postomat'::text]))),
    CONSTRAINT redemptions_status_check CHECK ((status = ANY (ARRAY['new'::text, 'printing'::text, 'packing'::text, 'shipped'::text, 'arrived'::text, 'received'::text, 'returned'::text, 'cancelled'::text])))
);


--
-- Name: redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: redemptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.redemptions_id_seq OWNED BY public.redemptions.id;


--
-- Name: repost_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repost_verifications (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    network text,
    redirect_token text NOT NULL,
    clicked_at timestamp with time zone,
    verified_at timestamp with time zone,
    coins_awarded integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT repost_verifications_coins_awarded_check CHECK ((coins_awarded >= 0))
);


--
-- Name: repost_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.repost_verifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: repost_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.repost_verifications_id_seq OWNED BY public.repost_verifications.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id bigint NOT NULL,
    thread_id bigint NOT NULL,
    direction text NOT NULL,
    telegram_update_id bigint,
    telegram_message_id bigint,
    body text,
    attachments jsonb,
    admin_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_messages_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text])))
);


--
-- Name: support_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_messages_id_seq OWNED BY public.support_messages.id;


--
-- Name: support_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_threads (
    id bigint NOT NULL,
    telegram_chat_id text NOT NULL,
    user_id uuid,
    telegram_username text,
    status text DEFAULT 'open'::text NOT NULL,
    last_user_at timestamp with time zone,
    last_admin_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_threads_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);


--
-- Name: support_threads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_threads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_threads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_threads_id_seq OWNED BY public.support_threads.id;


--
-- Name: sync_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_cursors (
    name text NOT NULL,
    cursor_at timestamp with time zone,
    run_at timestamp with time zone,
    last_error text
);


--
-- Name: user_crates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_crates (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    source text NOT NULL,
    paid_currency text,
    paid_amount numeric(10,2),
    payment_id bigint,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    opened_at timestamp with time zone,
    opening_id bigint,
    CONSTRAINT user_crates_check CHECK (((opened_at IS NULL) = (opening_id IS NULL))),
    CONSTRAINT user_crates_paid_currency_check CHECK ((paid_currency = ANY (ARRAY['yellow'::text, 'uah'::text]))),
    CONSTRAINT user_crates_source_check CHECK ((source = ANY (ARRAY['coins'::text, 'cash'::text, 'bonus_drink'::text])))
);


--
-- Name: TABLE user_crates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_crates IS 'Невідкриті й відкриті скриньки гравця; відкрита має opening_id';


--
-- Name: user_crates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_crates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_crates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_crates_id_seq OWNED BY public.user_crates.id;


--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    subject text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_identities_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'email'::text])))
);


--
-- Name: user_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_items (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    item_def_id bigint NOT NULL,
    acquired_from text NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    set_id bigint,
    listing_id bigint,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_items_acquired_from_check CHECK ((acquired_from = ANY (ARRAY['crate'::text, 'drop'::text, 'shop'::text, 'market'::text, 'gift'::text, 'bonus_drink'::text, 'admin'::text])))
);


--
-- Name: user_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_items_id_seq OWNED BY public.user_items.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nickname public.citext NOT NULL,
    email public.citext,
    coins_yellow integer DEFAULT 0 NOT NULL,
    coins_silver integer DEFAULT 0 NOT NULL,
    beans integer DEFAULT 0 NOT NULL,
    water_liters integer DEFAULT 0 NOT NULL,
    compost_kg integer DEFAULT 0 NOT NULL,
    fertilizer_kg integer DEFAULT 0 NOT NULL,
    insecticide_bottles integer DEFAULT 0 NOT NULL,
    consent_at timestamp with time zone,
    terms_version text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_nickname public.citext,
    nickname_changed_at timestamp with time zone,
    CONSTRAINT users_beans_check CHECK ((beans >= 0)),
    CONSTRAINT users_coins_silver_check CHECK ((coins_silver >= 0)),
    CONSTRAINT users_coins_yellow_check CHECK ((coins_yellow >= 0)),
    CONSTRAINT users_compost_kg_check CHECK ((compost_kg >= 0)),
    CONSTRAINT users_fertilizer_kg_check CHECK ((fertilizer_kg >= 0)),
    CONSTRAINT users_insecticide_bottles_check CHECK ((insecticide_bottles >= 0)),
    CONSTRAINT users_water_liters_check CHECK ((water_liters >= 0))
);


--
-- Name: COLUMN users.nickname_changed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.nickname_changed_at IS 'Остання зміна нікнейма з профілю; наступна — не раніше ніж за 30 днів';


--
-- Name: video_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_events (
    id bigint NOT NULL,
    point_id text NOT NULL,
    kind text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    segment_id bigint,
    likely_receipt_id bigint,
    evidence jsonb,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT video_events_kind_check CHECK ((kind = ANY (ARRAY['approach'::text, 'queue'::text, 'idle'::text])))
);


--
-- Name: video_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.video_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: video_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.video_events_id_seq OWNED BY public.video_events.id;


--
-- Name: video_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_segments (
    id bigint NOT NULL,
    point_id text NOT NULL,
    camera_id text NOT NULL,
    r2_key text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    duration_ms integer,
    bytes bigint,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    locked_at timestamp with time zone,
    processed_at timestamp with time zone,
    error text,
    CONSTRAINT video_segments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text, 'expired'::text])))
);


--
-- Name: video_segments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.video_segments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: video_segments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.video_segments_id_seq OWNED BY public.video_segments.id;


--
-- Name: wardrobe_set_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wardrobe_set_items (
    id bigint NOT NULL,
    set_id bigint NOT NULL,
    slot text NOT NULL,
    user_item_id bigint NOT NULL,
    CONSTRAINT wardrobe_set_items_slot_check CHECK ((slot = ANY (ARRAY['head'::text, 'body'::text, 'pants'::text, 'feet'::text, 'acc_1'::text])))
);


--
-- Name: wardrobe_set_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wardrobe_set_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wardrobe_set_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wardrobe_set_items_id_seq OWNED BY public.wardrobe_set_items.id;


--
-- Name: wardrobe_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wardrobe_sets (
    id bigint NOT NULL,
    plant_id uuid NOT NULL,
    tier text,
    complete boolean DEFAULT false NOT NULL,
    gifted boolean DEFAULT false NOT NULL,
    gifted_at timestamp with time zone,
    beans_awarded integer DEFAULT 0 NOT NULL,
    CONSTRAINT wardrobe_sets_beans_awarded_check CHECK ((beans_awarded >= 0)),
    CONSTRAINT wardrobe_sets_tier_check CHECK ((tier = ANY (ARRAY['common'::text, 'uncommon'::text, 'rare'::text, 'epic'::text])))
);


--
-- Name: wardrobe_sets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wardrobe_sets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wardrobe_sets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wardrobe_sets_id_seq OWNED BY public.wardrobe_sets.id;


--
-- Name: webhook_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_keys (
    provider text NOT NULL,
    key text NOT NULL,
    url text NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webhook_keys_provider_check CHECK ((provider = 'checkbox'::text))
);


--
-- Name: TABLE webhook_keys; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.webhook_keys IS 'Ключі підпису вебхуків, видані провайдером при реєстрації (не з .env)';


--
-- Name: bonus_grants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_grants ALTER COLUMN id SET DEFAULT nextval('public.bonus_grants_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: coin_transfers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transfers ALTER COLUMN id SET DEFAULT nextval('public.coin_transfers_id_seq'::regclass);


--
-- Name: crate_openings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crate_openings ALTER COLUMN id SET DEFAULT nextval('public.crate_openings_id_seq'::regclass);


--
-- Name: device_telemetry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_telemetry ALTER COLUMN id SET DEFAULT nextval('public.device_telemetry_id_seq'::regclass);


--
-- Name: drinks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drinks ALTER COLUMN id SET DEFAULT nextval('public.drinks_id_seq'::regclass);


--
-- Name: health_samples id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_samples ALTER COLUMN id SET DEFAULT nextval('public.health_samples_id_seq'::regclass);


--
-- Name: item_defs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_defs ALTER COLUMN id SET DEFAULT nextval('public.item_defs_id_seq'::regclass);


--
-- Name: ledger_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries ALTER COLUMN id SET DEFAULT nextval('public.ledger_entries_id_seq'::regclass);


--
-- Name: market_listings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_listings ALTER COLUMN id SET DEFAULT nextval('public.market_listings_id_seq'::regclass);


--
-- Name: market_trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_trades ALTER COLUMN id SET DEFAULT nextval('public.market_trades_id_seq'::regclass);


--
-- Name: menu_deployment_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_deployment_targets ALTER COLUMN id SET DEFAULT nextval('public.menu_deployment_targets_id_seq'::regclass);


--
-- Name: menu_deployments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_deployments ALTER COLUMN id SET DEFAULT nextval('public.menu_deployments_id_seq'::regclass);


--
-- Name: news_broadcasts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_broadcasts ALTER COLUMN id SET DEFAULT nextval('public.news_broadcasts_id_seq'::regclass);


--
-- Name: nickname_words id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nickname_words ALTER COLUMN id SET DEFAULT nextval('public.nickname_words_id_seq'::regclass);


--
-- Name: outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox ALTER COLUMN id SET DEFAULT nextval('public.outbox_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: plant_stage_transitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_stage_transitions ALTER COLUMN id SET DEFAULT nextval('public.plant_stage_transitions_id_seq'::regclass);


--
-- Name: pos_discount_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_discount_codes ALTER COLUMN id SET DEFAULT nextval('public.pos_discount_codes_id_seq'::regclass);


--
-- Name: problem_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.problem_reports ALTER COLUMN id SET DEFAULT nextval('public.problem_reports_id_seq'::regclass);


--
-- Name: promos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promos ALTER COLUMN id SET DEFAULT nextval('public.promos_id_seq'::regclass);


--
-- Name: quiz_drink_responses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_drink_responses ALTER COLUMN id SET DEFAULT nextval('public.quiz_drink_responses_id_seq'::regclass);


--
-- Name: quiz_profile_responses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_profile_responses ALTER COLUMN id SET DEFAULT nextval('public.quiz_profile_responses_id_seq'::regclass);


--
-- Name: receipt_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_items ALTER COLUMN id SET DEFAULT nextval('public.receipt_items_id_seq'::regclass);


--
-- Name: receipts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipts ALTER COLUMN id SET DEFAULT nextval('public.receipts_id_seq'::regclass);


--
-- Name: redemption_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_events ALTER COLUMN id SET DEFAULT nextval('public.redemption_events_id_seq'::regclass);


--
-- Name: redemptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemptions ALTER COLUMN id SET DEFAULT nextval('public.redemptions_id_seq'::regclass);


--
-- Name: repost_verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repost_verifications ALTER COLUMN id SET DEFAULT nextval('public.repost_verifications_id_seq'::regclass);


--
-- Name: support_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages ALTER COLUMN id SET DEFAULT nextval('public.support_messages_id_seq'::regclass);


--
-- Name: support_threads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_threads ALTER COLUMN id SET DEFAULT nextval('public.support_threads_id_seq'::regclass);


--
-- Name: user_crates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crates ALTER COLUMN id SET DEFAULT nextval('public.user_crates_id_seq'::regclass);


--
-- Name: user_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items ALTER COLUMN id SET DEFAULT nextval('public.user_items_id_seq'::regclass);


--
-- Name: video_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_events ALTER COLUMN id SET DEFAULT nextval('public.video_events_id_seq'::regclass);


--
-- Name: video_segments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_segments ALTER COLUMN id SET DEFAULT nextval('public.video_segments_id_seq'::regclass);


--
-- Name: wardrobe_set_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_set_items ALTER COLUMN id SET DEFAULT nextval('public.wardrobe_set_items_id_seq'::regclass);


--
-- Name: wardrobe_sets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_sets ALTER COLUMN id SET DEFAULT nextval('public.wardrobe_sets_id_seq'::regclass);


--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: bonus_grants bonus_grants_claim_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_grants
    ADD CONSTRAINT bonus_grants_claim_token_key UNIQUE (claim_token);


--
-- Name: bonus_grants bonus_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_grants
    ADD CONSTRAINT bonus_grants_pkey PRIMARY KEY (id);


--
-- Name: bonus_grants bonus_grants_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_grants
    ADD CONSTRAINT bonus_grants_receipt_id_key UNIQUE (receipt_id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: coin_transfers coin_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transfers
    ADD CONSTRAINT coin_transfers_pkey PRIMARY KEY (id);


--
-- Name: crate_openings crate_openings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crate_openings
    ADD CONSTRAINT crate_openings_pkey PRIMARY KEY (id);


--
-- Name: device_telemetry device_telemetry_idem_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_telemetry
    ADD CONSTRAINT device_telemetry_idem_key_key UNIQUE (idem_key);


--
-- Name: device_telemetry device_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_telemetry
    ADD CONSTRAINT device_telemetry_pkey PRIMARY KEY (id);


--
-- Name: drinks drinks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drinks
    ADD CONSTRAINT drinks_pkey PRIMARY KEY (id);


--
-- Name: drinks drinks_system_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drinks
    ADD CONSTRAINT drinks_system_code_key UNIQUE (system_code);


--
-- Name: health_samples health_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_samples
    ADD CONSTRAINT health_samples_pkey PRIMARY KEY (id);


--
-- Name: health_samples health_samples_target_bucket_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_samples
    ADD CONSTRAINT health_samples_target_bucket_start_key UNIQUE (target, bucket_start);


--
-- Name: item_defs item_defs_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_defs
    ADD CONSTRAINT item_defs_code_key UNIQUE (code);


--
-- Name: item_defs item_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_defs
    ADD CONSTRAINT item_defs_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_idem_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_idem_key_key UNIQUE (idem_key);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: login_links login_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_links
    ADD CONSTRAINT login_links_pkey PRIMARY KEY (token_hash);


--
-- Name: market_listings market_listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_listings
    ADD CONSTRAINT market_listings_pkey PRIMARY KEY (id);


--
-- Name: market_trades market_trades_listing_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_trades
    ADD CONSTRAINT market_trades_listing_id_key UNIQUE (listing_id);


--
-- Name: market_trades market_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_trades
    ADD CONSTRAINT market_trades_pkey PRIMARY KEY (id);


--
-- Name: menu_deployment_targets menu_deployment_targets_deployment_id_kind_point_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_deployment_targets
    ADD CONSTRAINT menu_deployment_targets_deployment_id_kind_point_id_key UNIQUE (deployment_id, kind, point_id);


--
-- Name: menu_deployment_targets menu_deployment_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_deployment_targets
    ADD CONSTRAINT menu_deployment_targets_pkey PRIMARY KEY (id);


--
-- Name: menu_deployments menu_deployments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_deployments
    ADD CONSTRAINT menu_deployments_pkey PRIMARY KEY (id);


--
-- Name: news_broadcasts news_broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_broadcasts
    ADD CONSTRAINT news_broadcasts_pkey PRIMARY KEY (id);


--
-- Name: nickname_words nickname_words_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nickname_words
    ADD CONSTRAINT nickname_words_pkey PRIMARY KEY (id);


--
-- Name: nickname_words nickname_words_word_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nickname_words
    ADD CONSTRAINT nickname_words_word_key UNIQUE (word);


--
-- Name: np_cities np_cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.np_cities
    ADD CONSTRAINT np_cities_pkey PRIMARY KEY (ref);


--
-- Name: np_warehouses np_warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.np_warehouses
    ADD CONSTRAINT np_warehouses_pkey PRIMARY KEY (ref);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);


--
-- Name: payments payments_invoice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_key UNIQUE (invoice_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: plant_stage_transitions plant_stage_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_stage_transitions
    ADD CONSTRAINT plant_stage_transitions_pkey PRIMARY KEY (id);


--
-- Name: plants plants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plants
    ADD CONSTRAINT plants_pkey PRIMARY KEY (id);


--
-- Name: points points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points
    ADD CONSTRAINT points_pkey PRIMARY KEY (id);


--
-- Name: pos_discount_codes pos_discount_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_discount_codes
    ADD CONSTRAINT pos_discount_codes_code_key UNIQUE (code);


--
-- Name: pos_discount_codes pos_discount_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_discount_codes
    ADD CONSTRAINT pos_discount_codes_pkey PRIMARY KEY (id);


--
-- Name: problem_reports problem_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.problem_reports
    ADD CONSTRAINT problem_reports_pkey PRIMARY KEY (id);


--
-- Name: promos promos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promos
    ADD CONSTRAINT promos_pkey PRIMARY KEY (id);


--
-- Name: quiz_drink_responses quiz_drink_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_drink_responses
    ADD CONSTRAINT quiz_drink_responses_pkey PRIMARY KEY (id);


--
-- Name: quiz_drink_responses quiz_drink_responses_receipt_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_drink_responses
    ADD CONSTRAINT quiz_drink_responses_receipt_item_id_key UNIQUE (receipt_item_id);


--
-- Name: quiz_profile_responses quiz_profile_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_profile_responses
    ADD CONSTRAINT quiz_profile_responses_pkey PRIMARY KEY (id);


--
-- Name: quiz_profile_responses quiz_profile_responses_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_profile_responses
    ADD CONSTRAINT quiz_profile_responses_user_id_key UNIQUE (user_id);


--
-- Name: receipt_items receipt_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_items
    ADD CONSTRAINT receipt_items_pkey PRIMARY KEY (id);


--
-- Name: receipts receipts_checkbox_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_checkbox_receipt_id_key UNIQUE (checkbox_receipt_id);


--
-- Name: receipts receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_pkey PRIMARY KEY (id);


--
-- Name: redemption_events redemption_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_events
    ADD CONSTRAINT redemption_events_pkey PRIMARY KEY (id);


--
-- Name: redemptions redemptions_np_ttn_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT redemptions_np_ttn_key UNIQUE (np_ttn);


--
-- Name: redemptions redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT redemptions_pkey PRIMARY KEY (id);


--
-- Name: repost_verifications repost_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repost_verifications
    ADD CONSTRAINT repost_verifications_pkey PRIMARY KEY (id);


--
-- Name: repost_verifications repost_verifications_redirect_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repost_verifications
    ADD CONSTRAINT repost_verifications_redirect_token_key UNIQUE (redirect_token);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_telegram_update_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_telegram_update_id_key UNIQUE (telegram_update_id);


--
-- Name: support_threads support_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_threads
    ADD CONSTRAINT support_threads_pkey PRIMARY KEY (id);


--
-- Name: support_threads support_threads_telegram_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_threads
    ADD CONSTRAINT support_threads_telegram_chat_id_key UNIQUE (telegram_chat_id);


--
-- Name: sync_cursors sync_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_cursors
    ADD CONSTRAINT sync_cursors_pkey PRIMARY KEY (name);


--
-- Name: user_crates user_crates_opening_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crates
    ADD CONSTRAINT user_crates_opening_id_key UNIQUE (opening_id);


--
-- Name: user_crates user_crates_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crates
    ADD CONSTRAINT user_crates_payment_id_key UNIQUE (payment_id);


--
-- Name: user_crates user_crates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crates
    ADD CONSTRAINT user_crates_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_provider_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_provider_subject_key UNIQUE (provider, subject);


--
-- Name: user_items user_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT user_items_pkey PRIMARY KEY (id);


--
-- Name: users users_nickname_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_nickname_key UNIQUE (nickname);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: video_events video_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_events
    ADD CONSTRAINT video_events_pkey PRIMARY KEY (id);


--
-- Name: video_segments video_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_segments
    ADD CONSTRAINT video_segments_pkey PRIMARY KEY (id);


--
-- Name: video_segments video_segments_r2_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_segments
    ADD CONSTRAINT video_segments_r2_key_key UNIQUE (r2_key);


--
-- Name: wardrobe_set_items wardrobe_set_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_set_items
    ADD CONSTRAINT wardrobe_set_items_pkey PRIMARY KEY (id);


--
-- Name: wardrobe_set_items wardrobe_set_items_set_id_slot_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_set_items
    ADD CONSTRAINT wardrobe_set_items_set_id_slot_key UNIQUE (set_id, slot);


--
-- Name: wardrobe_set_items wardrobe_set_items_user_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_set_items
    ADD CONSTRAINT wardrobe_set_items_user_item_id_key UNIQUE (user_item_id);


--
-- Name: wardrobe_sets wardrobe_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_sets
    ADD CONSTRAINT wardrobe_sets_pkey PRIMARY KEY (id);


--
-- Name: webhook_keys webhook_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_keys
    ADD CONSTRAINT webhook_keys_pkey PRIMARY KEY (provider);


--
-- Name: bonus_grants_redeemed_by_redeemed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bonus_grants_redeemed_by_redeemed_at_idx ON public.bonus_grants USING btree (redeemed_by, redeemed_at DESC);


--
-- Name: bonus_grants_status_show_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bonus_grants_status_show_until_idx ON public.bonus_grants USING btree (status, show_until) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text]));


--
-- Name: chat_messages_plant_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_plant_id_created_at_idx ON public.chat_messages USING btree (plant_id, created_at DESC);


--
-- Name: coin_transfers_from_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coin_transfers_from_user_created_at_idx ON public.coin_transfers USING btree (from_user, created_at DESC);


--
-- Name: coin_transfers_to_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coin_transfers_to_user_created_at_idx ON public.coin_transfers USING btree (to_user, created_at DESC);


--
-- Name: crate_openings_user_id_opened_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crate_openings_user_id_opened_at_idx ON public.crate_openings USING btree (user_id, opened_at DESC);


--
-- Name: device_telemetry_point_id_measured_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_telemetry_point_id_measured_at_idx ON public.device_telemetry USING btree (point_id, measured_at DESC);


--
-- Name: drinks_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX drinks_sort_order_idx ON public.drinks USING btree (sort_order) WHERE active;


--
-- Name: health_samples_bucket_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX health_samples_bucket_start_idx ON public.health_samples USING btree (bucket_start DESC);


--
-- Name: item_defs_collection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_defs_collection_idx ON public.item_defs USING btree (collection);


--
-- Name: item_defs_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_defs_tier_idx ON public.item_defs USING btree (tier) WHERE active;


--
-- Name: ledger_entries_ref_type_ref_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_ref_type_ref_id_idx ON public.ledger_entries USING btree (ref_type, ref_id) WHERE (ref_id IS NOT NULL);


--
-- Name: ledger_entries_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_user_id_created_at_idx ON public.ledger_entries USING btree (user_id, created_at DESC);


--
-- Name: login_links_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_links_created_idx ON public.login_links USING btree (created_at);


--
-- Name: login_links_email_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_links_email_created_idx ON public.login_links USING btree (email, created_at);


--
-- Name: login_links_ip_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_links_ip_created_idx ON public.login_links USING btree (ip, created_at);


--
-- Name: market_listings_kind_seller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_listings_kind_seller_id_idx ON public.market_listings USING btree (kind, seller_id) WHERE (status = 'active'::text);


--
-- Name: market_listings_plant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX market_listings_plant_id_idx ON public.market_listings USING btree (plant_id) WHERE ((status = 'active'::text) AND (plant_id IS NOT NULL));


--
-- Name: market_listings_user_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX market_listings_user_item_id_idx ON public.market_listings USING btree (user_item_id) WHERE ((status = 'active'::text) AND (user_item_id IS NOT NULL));


--
-- Name: market_trades_buyer_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_trades_buyer_id_created_at_idx ON public.market_trades USING btree (buyer_id, created_at DESC);


--
-- Name: market_trades_seller_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_trades_seller_id_created_at_idx ON public.market_trades USING btree (seller_id, created_at DESC);


--
-- Name: menu_deployment_targets_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX menu_deployment_targets_status_idx ON public.menu_deployment_targets USING btree (status) WHERE (status = ANY (ARRAY['queued'::text, 'deploying'::text]));


--
-- Name: nickname_words_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nickname_words_kind_idx ON public.nickname_words USING btree (kind) WHERE active;


--
-- Name: np_cities_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX np_cities_name_idx ON public.np_cities USING btree (name);


--
-- Name: np_warehouses_city_ref_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX np_warehouses_city_ref_category_idx ON public.np_warehouses USING btree (city_ref, category);


--
-- Name: outbox_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_id_idx ON public.outbox USING btree (id) WHERE (published_at IS NULL);


--
-- Name: payments_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_status_idx ON public.payments USING btree (status) WHERE (status = ANY (ARRAY['created'::text, 'processing'::text]));


--
-- Name: payments_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_user_id_created_at_idx ON public.payments USING btree (user_id, created_at DESC);


--
-- Name: plant_stage_transitions_plant_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plant_stage_transitions_plant_id_created_at_idx ON public.plant_stage_transitions USING btree (plant_id, created_at DESC);


--
-- Name: plants_owner_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plants_owner_id_created_at_idx ON public.plants USING btree (owner_id, created_at);


--
-- Name: pos_discount_codes_user_id_issued_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_discount_codes_user_id_issued_at_idx ON public.pos_discount_codes USING btree (user_id, issued_at DESC);


--
-- Name: problem_reports_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX problem_reports_status_created_at_idx ON public.problem_reports USING btree (status, created_at DESC);


--
-- Name: promos_archived_at_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promos_archived_at_created_at_idx ON public.promos USING btree (archived_at NULLS FIRST, created_at DESC);


--
-- Name: promos_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX promos_one_current ON public.promos USING btree (is_current) WHERE is_current;


--
-- Name: quiz_drink_responses_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quiz_drink_responses_user_id_created_at_idx ON public.quiz_drink_responses USING btree (user_id, created_at DESC);


--
-- Name: receipt_items_receipt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipt_items_receipt_id_idx ON public.receipt_items USING btree (receipt_id);


--
-- Name: receipt_items_system_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipt_items_system_code_idx ON public.receipt_items USING btree (system_code);


--
-- Name: receipts_fiscal_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipts_fiscal_date_idx ON public.receipts USING btree (fiscal_date DESC);


--
-- Name: receipts_point_id_fiscal_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipts_point_id_fiscal_date_idx ON public.receipts USING btree (point_id, fiscal_date DESC);


--
-- Name: redemption_events_redemption_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redemption_events_redemption_id_created_at_idx ON public.redemption_events USING btree (redemption_id, created_at DESC);


--
-- Name: redemptions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redemptions_status_idx ON public.redemptions USING btree (status) WHERE (status <> ALL (ARRAY['received'::text, 'cancelled'::text, 'returned'::text]));


--
-- Name: redemptions_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redemptions_user_id_created_at_idx ON public.redemptions USING btree (user_id, created_at DESC);


--
-- Name: repost_verifications_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX repost_verifications_user_id_idx ON public.repost_verifications USING btree (user_id) WHERE (verified_at IS NULL);


--
-- Name: repost_verifications_user_id_verified_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX repost_verifications_user_id_verified_at_idx ON public.repost_verifications USING btree (user_id, verified_at DESC);


--
-- Name: support_messages_thread_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_messages_thread_id_created_at_idx ON public.support_messages USING btree (thread_id, created_at);


--
-- Name: support_threads_status_last_user_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_threads_status_last_user_at_idx ON public.support_threads USING btree (status, last_user_at DESC);


--
-- Name: user_crates_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_crates_user_id_idx ON public.user_crates USING btree (user_id) WHERE (opened_at IS NULL);


--
-- Name: user_identities_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_identities_user_id_idx ON public.user_identities USING btree (user_id);


--
-- Name: user_items_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_items_user_id_idx ON public.user_items USING btree (user_id) WHERE ((locked = false) AND (listing_id IS NULL));


--
-- Name: user_items_user_id_item_def_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_items_user_id_item_def_id_idx ON public.user_items USING btree (user_id, item_def_id);


--
-- Name: users_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_deleted_at_idx ON public.users USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: users_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_email_idx ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: video_events_meta_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX video_events_meta_idx ON public.video_events USING gin (meta jsonb_path_ops);


--
-- Name: video_events_point_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX video_events_point_id_started_at_idx ON public.video_events USING btree (point_id, started_at DESC);


--
-- Name: video_segments_point_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX video_segments_point_id_started_at_idx ON public.video_segments USING btree (point_id, started_at DESC);


--
-- Name: video_segments_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX video_segments_started_at_idx ON public.video_segments USING btree (started_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: wardrobe_sets_plant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wardrobe_sets_plant_id_idx ON public.wardrobe_sets USING btree (plant_id);


--
-- Name: bonus_grants bonus_grants_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_grants
    ADD CONSTRAINT bonus_grants_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.points(id);


--
-- Name: bonus_grants bonus_grants_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_grants
    ADD CONSTRAINT bonus_grants_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id) ON DELETE CASCADE;


--
-- Name: bonus_grants bonus_grants_redeemed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_grants
    ADD CONSTRAINT bonus_grants_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES public.users(id);


--
-- Name: chat_messages chat_messages_plant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: coin_transfers coin_transfers_from_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transfers
    ADD CONSTRAINT coin_transfers_from_user_fkey FOREIGN KEY (from_user) REFERENCES public.users(id);


--
-- Name: coin_transfers coin_transfers_to_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transfers
    ADD CONSTRAINT coin_transfers_to_user_fkey FOREIGN KEY (to_user) REFERENCES public.users(id);


--
-- Name: crate_openings crate_openings_result_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crate_openings
    ADD CONSTRAINT crate_openings_result_item_id_fkey FOREIGN KEY (result_item_id) REFERENCES public.user_items(id);


--
-- Name: crate_openings crate_openings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crate_openings
    ADD CONSTRAINT crate_openings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_telemetry device_telemetry_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_telemetry
    ADD CONSTRAINT device_telemetry_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.points(id);


--
-- Name: ledger_entries ledger_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: market_listings market_listings_plant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_listings
    ADD CONSTRAINT market_listings_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;


--
-- Name: market_listings market_listings_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_listings
    ADD CONSTRAINT market_listings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: market_listings market_listings_user_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_listings
    ADD CONSTRAINT market_listings_user_item_id_fkey FOREIGN KEY (user_item_id) REFERENCES public.user_items(id);


--
-- Name: market_trades market_trades_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_trades
    ADD CONSTRAINT market_trades_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id);


--
-- Name: market_trades market_trades_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_trades
    ADD CONSTRAINT market_trades_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id);


--
-- Name: market_trades market_trades_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_trades
    ADD CONSTRAINT market_trades_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id);


--
-- Name: menu_deployment_targets menu_deployment_targets_deployment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_deployment_targets
    ADD CONSTRAINT menu_deployment_targets_deployment_id_fkey FOREIGN KEY (deployment_id) REFERENCES public.menu_deployments(id) ON DELETE CASCADE;


--
-- Name: menu_deployment_targets menu_deployment_targets_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_deployment_targets
    ADD CONSTRAINT menu_deployment_targets_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.points(id);


--
-- Name: menu_deployments menu_deployments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_deployments
    ADD CONSTRAINT menu_deployments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_users(id);


--
-- Name: news_broadcasts news_broadcasts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_broadcasts
    ADD CONSTRAINT news_broadcasts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_users(id);


--
-- Name: np_warehouses np_warehouses_city_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.np_warehouses
    ADD CONSTRAINT np_warehouses_city_ref_fkey FOREIGN KEY (city_ref) REFERENCES public.np_cities(ref) ON DELETE CASCADE;


--
-- Name: payments payments_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES public.ledger_entries(id);


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: plant_stage_transitions plant_stage_transitions_plant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_stage_transitions
    ADD CONSTRAINT plant_stage_transitions_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;


--
-- Name: plants plants_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plants
    ADD CONSTRAINT plants_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id) ON DELETE SET NULL;


--
-- Name: plants plants_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plants
    ADD CONSTRAINT plants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: plants plants_worn_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plants
    ADD CONSTRAINT plants_worn_set_id_fkey FOREIGN KEY (worn_set_id) REFERENCES public.wardrobe_sets(id) ON DELETE SET NULL;


--
-- Name: pos_discount_codes pos_discount_codes_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_discount_codes
    ADD CONSTRAINT pos_discount_codes_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES public.ledger_entries(id);


--
-- Name: pos_discount_codes pos_discount_codes_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_discount_codes
    ADD CONSTRAINT pos_discount_codes_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id);


--
-- Name: pos_discount_codes pos_discount_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_discount_codes
    ADD CONSTRAINT pos_discount_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: problem_reports problem_reports_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.problem_reports
    ADD CONSTRAINT problem_reports_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.points(id);


--
-- Name: problem_reports problem_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.problem_reports
    ADD CONSTRAINT problem_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: promos promos_drink_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promos
    ADD CONSTRAINT promos_drink_code_fkey FOREIGN KEY (drink_code) REFERENCES public.drinks(system_code);


--
-- Name: quiz_drink_responses quiz_drink_responses_receipt_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_drink_responses
    ADD CONSTRAINT quiz_drink_responses_receipt_item_id_fkey FOREIGN KEY (receipt_item_id) REFERENCES public.receipt_items(id);


--
-- Name: quiz_drink_responses quiz_drink_responses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_drink_responses
    ADD CONSTRAINT quiz_drink_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: quiz_profile_responses quiz_profile_responses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_profile_responses
    ADD CONSTRAINT quiz_profile_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: receipt_items receipt_items_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_items
    ADD CONSTRAINT receipt_items_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id) ON DELETE CASCADE;


--
-- Name: receipts receipts_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.points(id);


--
-- Name: redemption_events redemption_events_redemption_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_events
    ADD CONSTRAINT redemption_events_redemption_id_fkey FOREIGN KEY (redemption_id) REFERENCES public.redemptions(id) ON DELETE CASCADE;


--
-- Name: redemptions redemptions_evidence_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT redemptions_evidence_event_id_fkey FOREIGN KEY (evidence_event_id) REFERENCES public.video_events(id) ON DELETE SET NULL;


--
-- Name: redemptions redemptions_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT redemptions_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES public.ledger_entries(id);


--
-- Name: redemptions redemptions_np_warehouse_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT redemptions_np_warehouse_ref_fkey FOREIGN KEY (np_warehouse_ref) REFERENCES public.np_warehouses(ref);


--
-- Name: redemptions redemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: repost_verifications repost_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repost_verifications
    ADD CONSTRAINT repost_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_users(id);


--
-- Name: support_messages support_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.support_threads(id) ON DELETE CASCADE;


--
-- Name: support_threads support_threads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_threads
    ADD CONSTRAINT support_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_crates user_crates_opening_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crates
    ADD CONSTRAINT user_crates_opening_id_fkey FOREIGN KEY (opening_id) REFERENCES public.crate_openings(id);


--
-- Name: user_crates user_crates_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crates
    ADD CONSTRAINT user_crates_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: user_crates user_crates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crates
    ADD CONSTRAINT user_crates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_identities user_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_items user_items_item_def_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT user_items_item_def_id_fkey FOREIGN KEY (item_def_id) REFERENCES public.item_defs(id);


--
-- Name: user_items user_items_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT user_items_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id) ON DELETE SET NULL;


--
-- Name: user_items user_items_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT user_items_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.wardrobe_sets(id) ON DELETE SET NULL;


--
-- Name: user_items user_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT user_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_events video_events_likely_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_events
    ADD CONSTRAINT video_events_likely_receipt_id_fkey FOREIGN KEY (likely_receipt_id) REFERENCES public.receipts(id) ON DELETE SET NULL;


--
-- Name: video_events video_events_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_events
    ADD CONSTRAINT video_events_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.points(id);


--
-- Name: video_events video_events_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_events
    ADD CONSTRAINT video_events_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.video_segments(id) ON DELETE SET NULL;


--
-- Name: video_segments video_segments_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_segments
    ADD CONSTRAINT video_segments_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.points(id);


--
-- Name: wardrobe_set_items wardrobe_set_items_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_set_items
    ADD CONSTRAINT wardrobe_set_items_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.wardrobe_sets(id) ON DELETE CASCADE;


--
-- Name: wardrobe_set_items wardrobe_set_items_user_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_set_items
    ADD CONSTRAINT wardrobe_set_items_user_item_id_fkey FOREIGN KEY (user_item_id) REFERENCES public.user_items(id);


--
-- Name: wardrobe_sets wardrobe_sets_plant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_sets
    ADD CONSTRAINT wardrobe_sets_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260920200000'),
    ('20260920200100'),
    ('20260920200200'),
    ('20260920200300'),
    ('20260920200400'),
    ('20260920200500'),
    ('20260920200600'),
    ('20260920200700'),
    ('20260920200800'),
    ('20260920200900'),
    ('20260920201000'),
    ('20260920210000'),
    ('20260920220000'),
    ('20260920230000'),
    ('20260920240000'),
    ('20260921090000'),
    ('20260921100000'),
    ('20260921120000'),
    ('20260921130000'),
    ('20260921140000'),
    ('20260921150000'),
    ('20260922100000'),
    ('20260922110000'),
    ('20260922120000'),
    ('20260923080000'),
    ('20260923100000'),
    ('20260923110000'),
    ('20260923120000');
