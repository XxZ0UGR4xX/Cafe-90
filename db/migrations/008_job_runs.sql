-- 008: ejecuciones de tareas diarias (idempotentes y seguras con varias instancias)
CREATE TABLE job_runs (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  job text NOT NULL,
  run_on date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result jsonb,
  PRIMARY KEY (tenant_id, job, run_on)
);
SELECT enable_tenant_rls('job_runs');
