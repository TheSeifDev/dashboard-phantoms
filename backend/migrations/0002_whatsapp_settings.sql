CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO public.whatsapp_settings (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_settings TO service_role;
