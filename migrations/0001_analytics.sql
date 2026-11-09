-- Analytics: first-party events (final state of platform migrations 0022 and
-- 0087 for this table). Idempotent: safe on a database that already has it.

CREATE TABLE IF NOT EXISTS public.analytics_events (
    id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.analytics_events_id_seq) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    name text NOT NULL,
    path text NOT NULL,
    locale text,
    job_id uuid,
    search_term text,
    search_filters text[],
    referrer_host text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    device text NOT NULL,
    day_visitor text NOT NULL,
    visitor_id uuid,
    country text,
    CONSTRAINT analytics_events_pkey PRIMARY KEY (id),
    CONSTRAINT analytics_events_country_check CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT analytics_events_device_check CHECK ((device = ANY (ARRAY['mobile'::text, 'tablet'::text, 'desktop'::text]))),
    CONSTRAINT analytics_events_name_check CHECK ((name = ANY (ARRAY['page_view'::text, 'job_view'::text, 'search'::text, 'signup'::text, 'apply'::text])))
);

-- Columns added after the first version (0087), for a database made from 0022.
ALTER TABLE public.analytics_events ADD COLUMN IF NOT EXISTS visitor_id uuid;
ALTER TABLE public.analytics_events ADD COLUMN IF NOT EXISTS country text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_events_country_check') THEN
    ALTER TABLE public.analytics_events
      ADD CONSTRAINT analytics_events_country_check CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text)));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS analytics_events_day_visitor_idx ON public.analytics_events USING btree (day_visitor, occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_time_idx ON public.analytics_events USING btree (occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_visitor_idx ON public.analytics_events USING btree (visitor_id, occurred_at) WHERE (visitor_id IS NOT NULL);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.analytics_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events' AND policyname = 'analytics_events_anon_deny') THEN
    CREATE POLICY analytics_events_anon_deny ON public.analytics_events TO anon USING (false) WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events' AND policyname = 'analytics_events_app_rw_all') THEN
    CREATE POLICY analytics_events_app_rw_all ON public.analytics_events TO app_rw USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events' AND policyname = 'analytics_events_authenticated_deny') THEN
    CREATE POLICY analytics_events_authenticated_deny ON public.analytics_events TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

-- Table rights for the app role, as on the platform.
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.analytics_events TO app_rw;
GRANT SELECT,USAGE ON SEQUENCE public.analytics_events_id_seq TO app_rw;
