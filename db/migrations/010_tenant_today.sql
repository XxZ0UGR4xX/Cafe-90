-- 010: «hoy» según la zona horaria del restaurante (current_date usa la zona del servidor, UTC: entre las 18:00 y las 24:00 de México ya es «mañana»)
CREATE OR REPLACE FUNCTION tenant_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT (now() AT TIME ZONE timezone)::date FROM restaurants LIMIT 1), current_date)
$$;
GRANT EXECUTE ON FUNCTION tenant_today() TO PUBLIC;
